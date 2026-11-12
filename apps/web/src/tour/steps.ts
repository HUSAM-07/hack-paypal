/**
 * The judge tour: the stops, and the URL and storage rules that keep it going across pages.
 * Pure on purpose (no DOM): tour.ts draws the bar, this file decides where it is and where
 * Back and Next go. The stop lives in the URL (`?tour=N`) so a stop can be linked, reloaded
 * and walked back to; sessionStorage only covers pages that rewrite their own query string.
 */
export interface TourStop {
  /** The page, without a trailing slash (the landing is "/"). */
  path: string;
  /** The page's own query, without `tour`. */
  query?: string;
  hash?: string;
  /** What this stop is, in two or three words (the bar's visible label). */
  label: string;
  /** One or two plain sentences. Numbers exactly as the page shows them. */
  caption: string;
}

export const TOUR_PARAM = "tour";
export const TOUR_STORAGE_KEY = "cited-tour";

export const TOUR_STOPS: readonly TourStop[] = [
  {
    path: "/",
    hash: "problem",
    label: "The problem",
    caption:
      "AI shopping agents read a creator's review and buy on it, but never click an affiliate link, so the creator earns nothing.",
  },
  {
    path: "/console",
    query: "clean=1",
    label: "Two agents",
    caption:
      "Two agents get the same request. The one shown the creator's test buys the Winix; the one held out buys the Levoit.",
  },
  {
    path: "/console/payout",
    query: "clean=1",
    label: "The payout",
    caption:
      "Day 30: HouseFresh is paid $383.96 through PayPal Payouts. The same payout also ran on the real PayPal sandbox; its batch id is under the card.",
  },
  {
    path: "/proof",
    hash: "result",
    label: "The eval",
    caption:
      "Agents shown the creator's test bought the tested pick 57/57 times; agents shown a placebo from the same creator, 3/54. That is +94 points, and CITED pays on the cautious 80% lower bound, +90.3 points.",
  },
  {
    path: "/studio",
    query: "view=first",
    label: "Brand dashboard",
    caption:
      "The brand's view: 51 of the 57 sales by agents shown the test were caused by it, and only those are paid. Try the Analyst question “Should we raise the purifier cap?” and the commission what-if.",
  },
  {
    path: "/studio",
    query: "page=trust",
    label: "Trust page",
    caption:
      "Every credit that was held, frozen or voided, and why: $7.68 held for review, $7.68 voided by a refund. Nothing is paid until a person or PayPal decides.",
  },
  {
    path: "/proof",
    hash: "vacuums",
    label: "Second category",
    caption:
      "The same study on robot vacuums: 57/57 against 45/54, +16.7 points (80% lower bound +11.7 points). Smaller, and Sonnet showed no lift; the page says so.",
  },
  {
    path: "/mcp",
    label: "Your own agent",
    caption:
      "Connect your own agent with one command and ask it to buy an air purifier. Its sale appears on this page, kept out of the study numbers.",
  },
];

const clean = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path || "/");

/** Where stop `n` (1-based) lives, with the tour parameter on it. */
export function stopHref(n: number, stops: readonly TourStop[] = TOUR_STOPS): string {
  const s = stops[n - 1];
  if (!s) throw new RangeError(`no tour stop ${n}`);
  const q = [s.query, `${TOUR_PARAM}=${n}`].filter(Boolean).join("&");
  return `${s.path}?${q}${s.hash ? `#${s.hash}` : ""}`;
}

/** A stop number from text, or null for anything that is not a whole number inside the tour. */
export function parseStop(
  value: string | null | undefined,
  count = TOUR_STOPS.length,
): number | null {
  if (!value || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= count ? n : null;
}

/**
 * The stop to show on this page, or null: no bar. The URL decides. Failing that, a stop kept in
 * sessionStorage counts only on that stop's own page, for pages that drop the query string.
 */
export function resolveStop(
  where: { pathname: string; search: string },
  stored: string | null,
  stops: readonly TourStop[] = TOUR_STOPS,
): number | null {
  const fromUrl = parseStop(new URLSearchParams(where.search).get(TOUR_PARAM), stops.length);
  if (fromUrl) return fromUrl;
  const n = parseStop(stored, stops.length);
  return n && clean(stops[n - 1]?.path ?? "") === clean(where.pathname) ? n : null;
}

/** This page's address with the tour parameter removed (what Exit leaves behind). */
export function withoutTour(where: { pathname: string; search: string; hash: string }): string {
  const q = new URLSearchParams(where.search);
  q.delete(TOUR_PARAM);
  const rest = q.toString();
  return `${where.pathname}${rest ? `?${rest}` : ""}${where.hash}`;
}

/** Back and Next: the neighbouring stop, or null past either end (Next on the last stop finishes). */
export function neighbour(n: number, dir: -1 | 1, count = TOUR_STOPS.length): number | null {
  const m = n + dir;
  return m >= 1 && m <= count ? m : null;
}
