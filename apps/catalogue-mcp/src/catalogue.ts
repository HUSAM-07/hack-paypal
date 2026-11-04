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
import { creatorContent, type Listing, searchListings } from "./listings";

export interface CatalogueOptions {
  seed: string;
  passportKey: string;
  clock?: DemoClock;
  schedule?: HoldoutSchedule;
  /** When the housefresh Winix test went live; the schedule's day 0. */
  testPublishedAt?: Date;
}

export interface SearchInput {
  query: string;
  passport?: string | undefined;
  /** Start a new session that is also exposed to a second creator (AirLab). Ignored for existing passports. */
  coExposed?: boolean | undefined;
  /** Shop the agent is browsing, recorded as a store viewed. */
  shopId?: string | undefined;
}

export interface SearchResult {
  listings: Listing[];
  creatorContent: VerifiedTest[];
  passport: string;
}

export const DEV_PASSPORT_KEY = "cited-dev-passport-key";
export const DEFAULT_PUBLISHED_AT = new Date("2026-11-01T00:00:00Z");

export function createCatalogue(opts: CatalogueOptions) {
  const clock = opts.clock ?? new DemoClock();
  const schedule = opts.schedule ?? DEFAULT_SCHEDULE;
  const publishedAt = opts.testPublishedAt ?? DEFAULT_PUBLISHED_AT;

  async function search(input: SearchInput): Promise<SearchResult> {
    const verified = input.passport ? await verifyPassport(input.passport, opts.passportKey) : null;
    let body: PassportBody =
      verified?.ok === true
        ? verified.body
        : newSession(
            crypto.randomUUID().replaceAll("-", "").slice(0, 20),
            input.coExposed ?? false,
          );
    if (input.shopId) body = addStoreViewed(body, input.shopId);
    return {
      listings: searchListings(input.query),
      creatorContent: creatorContent(body.arm, body.creatorsSeen.includes("airlab")),
      passport: await signPassport(body, opts.passportKey),
    };
  }

  function newSession(sessionId: string, coExposed: boolean): PassportBody {
    const arm: Arm = assignArm(opts.seed, sessionId, testDay(publishedAt, clock.now()), schedule);
    const shown = creatorContent(arm, coExposed);
    return {
      v: 1,
      sessionId,
      arm,
      creatorsSeen: [...new Set(shown.map((t) => t.creatorId))],
      storesViewed: [],
    };
  }

  return { search, clock, newSession };
}
export type Catalogue = ReturnType<typeof createCatalogue>;
