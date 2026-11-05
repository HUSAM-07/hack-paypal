import {
  airlabWinixTest,
  DEMO_SHOP_PRICES,
  housefreshPlacebo,
  housefreshWinixTest,
  type Money,
  UPC_LEVOIT_CORE300,
  UPC_WINIX_A230,
  type VerifiedTest,
} from "@pact/protocol";

export interface Listing {
  shopId: string;
  upc: string;
  brand: string;
  name: string;
  price: Money;
}

const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

const BRANDS = [
  { upc: UPC_WINIX_A230, brand: "Winix", name: "A230" } as const,
  { upc: UPC_LEVOIT_CORE300, brand: "Levoit", name: "Core 300" } as const,
];

/** Prices come from the shared demo table, so the catalogue and the shops always agree. */
const ALL_LISTINGS: Listing[] = BRANDS.flatMap((b) =>
  (Object.keys(DEMO_SHOP_PRICES) as (keyof typeof DEMO_SHOP_PRICES)[]).map((shopId) => ({
    shopId,
    ...b,
    price: usd(DEMO_SHOP_PRICES[shopId][b.upc]),
  })),
);

/**
 * Ranking depends only on the query and the listings (price, then shop, then UPC).
 * It never sees the arm, so it cannot differ between arms.
 */
export function searchListings(query: string): Listing[] {
  const q = query.toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  const generic = /purifier|air|clean|filter|hepa/.test(q);
  const matches = ALL_LISTINGS.filter(
    (l) => generic || words.some((w) => `${l.brand} ${l.name}`.toLowerCase().includes(w)),
  );
  return [...matches].sort(
    (a, b) =>
      a.price.amountMinor - b.price.amountMinor ||
      a.shopId.localeCompare(b.shopId) ||
      a.upc.localeCompare(b.upc),
  );
}

/** What the catalogue adds for an arm. Only the test is ever withheld. */
export function creatorContent(
  arm: "test" | "placebo" | "none",
  coExposed: boolean,
): VerifiedTest[] {
  if (arm === "none") return [];
  if (arm === "placebo") return [housefreshPlacebo];
  return coExposed ? [housefreshWinixTest, airlabWinixTest] : [housefreshWinixTest];
}
