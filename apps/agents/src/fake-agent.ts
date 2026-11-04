import { type AgentContext, type AgentOutcome, parseBudgetMinor, type ShopperAgent } from "./agent";
import type { Listing } from "./types";

export interface FakeAgentOptions {
  /** Shop the agent browses first. Default: picked per session from the seed. */
  browseShop?: string;
  /** Chance (0-1) it buys at the shop it browsed even when another shop is cheaper. Default 0.2. */
  loyalty?: number;
}

const SHOPS = ["northwind", "lumen", "megamart"];

/**
 * Deterministic stand-in for a model. Same seed, same choices. It reads the creator's verdict when
 * one is shown (the point of the test arm), otherwise takes the cheapest listing within budget,
 * and usually pays at the cheapest shop for that product: which can differ from where it browsed.
 * It never reads creator prose as instructions.
 */
export class FakeAgent implements ShopperAgent {
  constructor(private readonly opts: FakeAgentOptions = {}) {}

  async run({ request, session, rand }: AgentContext): Promise<AgentOutcome> {
    const browse = this.opts.browseShop ?? SHOPS[Math.floor(rand() * SHOPS.length)] ?? "northwind";
    const loyal = rand() < (this.opts.loyalty ?? 0.2);
    const found = await session.search({ query: "air purifier", shopId: browse });

    const budget = parseBudgetMinor(request);
    const affordable = (l: Listing) => budget === null || l.price.amountMinor <= budget;
    const verdict = found.creatorContent.find((c) => c.kind === "test" && c.verdictUpc);

    const wanted = verdict?.verdictUpc
      ? found.listings.find((l) => l.upc === verdict.verdictUpc && affordable(l))
      : undefined;
    const pick = wanted ?? found.listings.find(affordable);
    if (!pick) return { reason: "nothing within budget", steps: 1 };

    const sameProduct = found.listings.filter((l) => l.upc === pick.upc);
    const cheapest = sameProduct[0] ?? pick; // listings arrive sorted by price
    const atBrowsed = sameProduct.find((l) => l.shopId === browse);
    const target = loyal && atBrowsed ? atBrowsed : cheapest;

    await session.checkout(target.shopId, target.upc);
    const why = wanted
      ? `${verdict?.creatorId} test recommends the ${pick.brand} ${pick.name}`
      : `cheapest ${pick.brand} ${pick.name} within budget`;
    const where =
      target.shopId === browse
        ? `bought at ${target.shopId}, where I was browsing`
        : `browsed ${browse} but ${target.shopId} is cheaper`;
    return { reason: `${why}; ${where}`, steps: 2 };
  }
}
