import {
  type Arm,
  addStoreViewed,
  DEFAULT_SCHEDULE,
  type HoldoutSchedule,
  type PassportBody,
  signPassport,
  type VerifiedTest,
  verifyPassport,
} from "@pact/protocol";
import { assignArm } from "./arms";
import { DemoClock, testDay } from "./clock";
import { buildOffers, categoryOfQuery, creatorContent, type Offer, searchOffers } from "./offers";
import { type Category, isSellerId, type Seller, type SellerId, sellersFromEnv } from "./sellers";

export interface CatalogueOptions {
  seed: string;
  passportKey: string;
  /** Honour a caller-chosen sessionId. Simulated demos only: a real caller could otherwise pick its arm. */
  allowSessionId?: boolean;
  clock?: DemoClock;
  schedule?: HoldoutSchedule;
  /** When the housefresh Winix test went live; the schedule's day 0. */
  testPublishedAt?: Date;
  /** The synced merchants and their PayPal payees. Default: the demo sellers with mock payees. */
  sellers?: Record<SellerId, Seller>;
}

export interface SearchInput {
  query: string;
  passport?: string | undefined;
  /** Start a new session that is also exposed to a second creator (AirLab). Ignored for existing passports. */
  coExposed?: boolean | undefined;
  /** Demo only: pick the session id (so a seeded run is reproducible). Ignored unless allowed. */
  sessionId?: string | undefined;
  /** Seller whose offer the agent is looking at, recorded in the passport as a store viewed. */
  sellerId?: string | undefined;
}

export interface SearchResult {
  offers: Offer[];
  creatorContent: VerifiedTest[];
  passport: string;
}

export const DEV_PASSPORT_KEY = "cited-dev-passport-key";
export const DEFAULT_PUBLISHED_AT = new Date("2026-11-01T00:00:00Z");

export function createCatalogue(opts: CatalogueOptions) {
  const clock = opts.clock ?? new DemoClock();
  const schedule = opts.schedule ?? DEFAULT_SCHEDULE;
  const publishedAt = opts.testPublishedAt ?? DEFAULT_PUBLISHED_AT;
  const sellers = opts.sellers ?? sellersFromEnv();
  const offers = buildOffers(sellers);

  async function search(input: SearchInput): Promise<SearchResult> {
    const category = categoryOfQuery(input.query);
    const verified = input.passport ? await verifyPassport(input.passport, opts.passportKey) : null;
    let body: PassportBody =
      verified?.ok === true
        ? verified.body
        : newSession(
            (opts.allowSessionId && input.sessionId) ||
              crypto.randomUUID().replaceAll("-", "").slice(0, 20),
            input.coExposed ?? false,
            category,
          );
    if (input.sellerId && isSellerId(input.sellerId)) body = addStoreViewed(body, input.sellerId);
    const shown = creatorContent(body.arm, body.creatorsSeen.includes("airlab"), category);
    // A session keeps its arm across categories; the passport must also name the creator it was
    // shown in this one, or that creator's test could not be credited. Nothing changes when the
    // creators are already recorded (every purifier search).
    const creatorsSeen = [...new Set([...body.creatorsSeen, ...shown.map((t) => t.creatorId)])];
    if (creatorsSeen.length !== body.creatorsSeen.length) body = { ...body, creatorsSeen };
    return {
      offers: searchOffers(input.query, offers),
      creatorContent: shown,
      passport: await signPassport(body, opts.passportKey),
    };
  }

  function newSession(
    sessionId: string,
    coExposed: boolean,
    category: Category = "air-purifier",
  ): PassportBody {
    const arm: Arm = assignArm(opts.seed, sessionId, testDay(publishedAt, clock.now()), schedule);
    const shown = creatorContent(arm, coExposed, category);
    return {
      v: 1,
      sessionId,
      arm,
      creatorsSeen: [...new Set(shown.map((t) => t.creatorId))],
      storesViewed: [],
    };
  }

  const offer = (offerId: string) => offers.find((o) => o.offerId === offerId);

  return { search, clock, newSession, sellers, offers, offer, passportKey: opts.passportKey };
}
export type Catalogue = ReturnType<typeof createCatalogue>;
