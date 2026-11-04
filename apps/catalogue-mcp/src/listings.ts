import {
  airlabWinixTest,
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

/** Lumen is $4 cheaper on Winix: the scripted cross-shop moment. */
const ALL_LISTINGS: Listing[] = [
  { shopId: "northwind", upc: UPC_WINIX_A230, brand: "Winix", name: "A230", price: usd(9999) },
  { shopId: "lumen", upc: UPC_WINIX_A230, brand: "Winix", name: "A230", price: usd(9599) },
  { shopId: "megamart", upc: UPC_WINIX_A230, brand: "Winix", name: "A230", price: usd(10299) },
  {
    shopId: "northwind",
    upc: UPC_LEVOIT_CORE300,
    brand: "Levoit",
    name: "Core 300",
    price: usd(10999),
  },
  {
    shopId: "lumen",
    upc: UPC_LEVOIT_CORE300,
    brand: "Levoit",
    name: "Core 300",
    price: usd(10799),
  },
  {
    shopId: "megamart",
    upc: UPC_LEVOIT_CORE300,
    brand: "Levoit",
    name: "Core 300",
    price: usd(11299),
  },
];

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
