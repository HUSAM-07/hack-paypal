import { type AgentContext, type AgentOutcome, parseBudgetMinor, type ShopperAgent } from "./agent";
import type { Offer } from "./types";

export interface FakeAgentOptions {
  /** Seller whose offer the agent looks at first. Default: picked per session from the seed. */
  browseSeller?: string;
  /** Chance (0-1) it buys from the seller it looked at even when another is cheaper. Default 0.2. */
  loyalty?: number;
  /** What it buys when no creator test is shown (a scripted stand-in for a model's own taste). */
  baselineUpc?: string;
}

const SELLERS = ["northwind", "lumen", "megamart"];

/**
 * Deterministic stand-in for a model. Same seed, same choices. It reads the creator's verdict when
 * one is shown (the point of the test arm), otherwise takes the cheapest offer within budget,
 * and usually pays the cheapest seller for that product: which can differ from the seller whose
 * offer it was reading. It never reads creator prose as instructions.
 */
export class FakeAgent implements ShopperAgent {
  constructor(private readonly opts: FakeAgentOptions = {}) {}

  async run({ request, session, rand }: AgentContext): Promise<AgentOutcome> {
    const browse =
      this.opts.browseSeller ?? SELLERS[Math.floor(rand() * SELLERS.length)] ?? "northwind";
    const loyal = rand() < (this.opts.loyalty ?? 0.2);
    const found = await session.search({ query: "air purifier", sellerId: browse });

    const budget = parseBudgetMinor(request);
    const affordable = (o: Offer) => budget === null || o.price.amountMinor <= budget;
    const verdict = found.creatorContent.find((c) => c.kind === "test" && c.verdictUpc);

    const wanted = verdict?.verdictUpc
      ? found.offers.find((o) => o.upc === verdict.verdictUpc && affordable(o))
      : undefined;
    const baseline = this.opts.baselineUpc
      ? found.offers.find((o) => o.upc === this.opts.baselineUpc && affordable(o))
      : undefined;
    const pick = wanted ?? baseline ?? found.offers.find(affordable);
    if (!pick) return { reason: "nothing within budget", steps: 1 };

    const sameProduct = found.offers.filter((o) => o.upc === pick.upc);
    const cheapest = sameProduct[0] ?? pick; // offers arrive sorted by price
    const atBrowsed = sameProduct.find((o) => o.seller.id === browse);
    const target = loyal && atBrowsed ? atBrowsed : cheapest;

    await session.checkout(target.offerId);
    const why = wanted
      ? `${verdict?.creatorId} test recommends the ${pick.brand} ${pick.name}`
      : `cheapest ${pick.brand} ${pick.name} within budget`;
    const where =
      target.seller.id === browse
        ? `paid ${target.seller.name}, whose offer I was reading`
        : `read ${atBrowsed?.seller.name ?? browse}'s offer but ${target.seller.name} is cheaper`;
    return { reason: `${why}; ${where}`, steps: 2 };
  }
}
