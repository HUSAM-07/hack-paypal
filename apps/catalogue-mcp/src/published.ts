/**
 * Tests that creators publish at /creators, as the public MCP catalogue serves them.
 *
 * The text is untrusted: it is handed to other people's AI agents. So nothing from the stored row
 * is passed on as it is. The products come from our catalogue (matched by UPC), the text is cleaned
 * and capped again, the FTC disclosure is guaranteed, and only the newest few are live at once.
 * Content never reaches ranking, prices, offers or tool descriptions: `creatorContent` is the only
 * place it appears.
 */
import {
  CREATOR_TEXT_LIMITS,
  cleanCreatorText,
  DEFAULT_CREATOR_DISCLOSURE,
  type VerifiedTest,
} from "@pact/protocol";
import { type Category, PRODUCTS } from "./sellers";

/** Published tests live in the catalogue at once, per category. A session's passport has room for four creators. */
export const PUBLISHED_LIVE_PER_CATEGORY = 3;
/** How long the catalogue reuses what it read from the engine. */
export const PUBLISHED_TTL_MS = 3000;

/** The demo's own creators: a published test can never take their place. */
const BUILT_IN_CREATORS = new Set(["housefresh", "airlab", "crumblab", "quietbench"]);

/** A row of the engine's `GET /tests`. */
export interface StoredTestRow {
  test: VerifiedTest;
  pairsWith: string | null;
  source: string;
  publishedAt: string;
  creatorName?: string | null | undefined;
}

/** One creator's live test, and the placebo that goes with it (none: nothing is shown in that group). */
export interface LivePublished {
  creatorId: string;
  category: Category;
  test: VerifiedTest;
  placebo?: VerifiedTest;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,24}$/;

function disclosureOf(raw: string): string {
  const d = cleanCreatorText(raw, CREATOR_TEXT_LIMITS.disclosure);
  return /commission/i.test(d) ? d : DEFAULT_CREATOR_DISCLOSURE;
}

/** The catalogue's own product for a UPC; the stored brand and name are never used. */
const productOf = (upc: string) => PRODUCTS.find((p) => p.upc === upc);

function servableTest(
  t: VerifiedTest,
  name: string,
): { test: VerifiedTest; category: Category } | null {
  if (t.kind !== "test" || !SAFE_ID.test(t.creatorId) || BUILT_IN_CREATORS.has(t.creatorId))
    return null;
  const found = [...new Set(t.skus.map((s) => s.upc))].map(productOf);
  const products = found.filter((p) => p !== undefined);
  // Every product must be one we sell, all in one category, and a test compares at least two.
  if (products.length !== found.length || products.length < 2) return null;
  const category = products[0]?.category;
  if (!category || products.some((p) => p.category !== category) || t.category !== category)
    return null;
  if (t.verdictUpc && !products.some((p) => p.upc === t.verdictUpc)) return null;
  const summary = cleanCreatorText(t.summary, CREATOR_TEXT_LIMITS.summary, true);
  if (!summary) return null;
  const creatorName = cleanCreatorText(name, CREATOR_TEXT_LIMITS.name);
  return {
    category,
    test: {
      id: t.id,
      kind: "test",
      creatorId: t.creatorId,
      ...(creatorName ? { creatorName } : {}),
      category,
      skus: products.map((p) => ({ upc: p.upc, brand: p.brand, name: p.name })),
      ...(t.verdictUpc ? { verdictUpc: t.verdictUpc } : {}),
      summary,
      disclosure: disclosureOf(t.disclosure),
    },
  };
}

function servablePlacebo(p: VerifiedTest, forTest: VerifiedTest): VerifiedTest | null {
  if (p.kind !== "placebo" || p.creatorId !== forTest.creatorId) return null;
  const summary = cleanCreatorText(p.summary, CREATOR_TEXT_LIMITS.placeboSummary, true);
  if (!summary) return null;
  return {
    id: p.id,
    kind: "placebo",
    creatorId: p.creatorId,
    ...(forTest.creatorName ? { creatorName: forTest.creatorName } : {}),
    category: /^[a-z0-9-]{1,40}$/.test(p.category) ? p.category : "other",
    skus: [],
    summary,
    disclosure: forTest.disclosure,
  };
}

/**
 * The live set: each creator's newest servable test (one per creator), the newest creators first,
 * at most `perCategory` per category. Rows that fail any check are skipped, never repaired.
 */
export function liveFromRows(
  rows: StoredTestRow[],
  perCategory = PUBLISHED_LIVE_PER_CATEGORY,
): LivePublished[] {
  const newest = rows
    .filter((r) => r.source === "onboarding")
    .sort(
      (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.test.id.localeCompare(b.test.id),
    );
  const live: LivePublished[] = [];
  const taken = new Set<string>();
  const perCat = new Map<Category, number>();
  for (const r of newest) {
    if (r.pairsWith !== null || taken.has(r.test.creatorId)) continue;
    const s = servableTest(r.test, r.creatorName ?? "");
    if (!s || (perCat.get(s.category) ?? 0) >= perCategory) continue;
    const placebo = newest
      .filter((p) => p.pairsWith === r.test.id)
      .map((p) => servablePlacebo(p.test, s.test))
      .find((p) => p !== null);
    taken.add(s.test.creatorId);
    perCat.set(s.category, (perCat.get(s.category) ?? 0) + 1);
    live.push({
      creatorId: s.test.creatorId,
      category: s.category,
      test: s.test,
      ...(placebo ? { placebo } : {}),
    });
  }
  return live;
}

export interface PublishedTests {
  /** The live published tests for a category. Never throws: if the engine can't be read, the last good set (or none). */
  live(category: Category): Promise<LivePublished[]>;
}

export function createPublishedTests(
  load: () => Promise<StoredTestRow[]>,
  o: { ttlMs?: number; now?: () => number; perCategory?: number } = {},
): PublishedTests {
  const ttl = o.ttlMs ?? PUBLISHED_TTL_MS;
  const now = o.now ?? Date.now;
  let cached: { at: number; live: LivePublished[] } | undefined;
  let inflight: Promise<LivePublished[]> | undefined;

  async function refresh(): Promise<LivePublished[]> {
    try {
      const live = liveFromRows(await load(), o.perCategory);
      cached = { at: now(), live };
      return live;
    } catch {
      // Keep serving the last good set; retry after a short pause rather than on every search.
      cached = { at: now(), live: cached?.live ?? [] };
      return cached.live;
    } finally {
      inflight = undefined;
    }
  }

  return {
    async live(category) {
      let all = cached && now() - cached.at < ttl ? cached.live : undefined;
      if (!all) {
        inflight ??= refresh();
        all = await inflight;
      }
      return all.filter((l) => l.category === category);
    },
  };
}
