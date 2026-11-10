import {
  airlabWinixTest,
  housefreshPlacebo,
  housefreshWinixTest,
  type Money,
  type VerifiedTest,
} from "@pact/protocol";
import {
  type Payee,
  PRODUCTS,
  SELLER_IDS,
  type Seller,
  type SellerId,
  sellersFromEnv,
} from "./sellers";

/** One product at one seller: what an agent compares and buys. */
export interface Offer {
  offerId: string;
  upc: string;
  brand: string;
  name: string;
  specs: string;
  seller: { id: SellerId; name: string; payee: Payee };
  price: Money;
}

export const offerIdFor = (seller: SellerId, upc: string) => `${seller}-${upc}`;

export function buildOffers(sellers: Record<SellerId, Seller>): Offer[] {
  return PRODUCTS.flatMap((p) =>
    SELLER_IDS.flatMap((id) => {
      const s = sellers[id];
      const price = s.prices[p.upc];
      if (!price) return [];
      return [
        {
          offerId: offerIdFor(id, p.upc),
          upc: p.upc,
          brand: p.brand,
          name: p.name,
          specs: p.specs,
          seller: { id, name: s.name, payee: s.payee },
          price,
        },
      ];
    }),
  );
}

/**
 * Ranking depends only on the query and the offers (price, then seller, then UPC).
 * It never sees the arm, so it cannot differ between arms.
 */
export function searchOffers(query: string, offers: Offer[]): Offer[] {
  const q = query.toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  const generic = /purifier|air|clean|filter|hepa/.test(q);
  const matches = offers.filter(
    (o) => generic || words.some((w) => `${o.brand} ${o.name}`.toLowerCase().includes(w)),
  );
  return [...matches].sort(
    (a, b) =>
      a.price.amountMinor - b.price.amountMinor ||
      a.seller.id.localeCompare(b.seller.id) ||
      a.upc.localeCompare(b.upc),
  );
}

/**
 * The pre-checkout listing view (shop id, UPC, brand, name, price), kept byte-identical for the
 * committed evals in packages/evals, which showed models this shape. Same ranking as offers.
 */
export interface Listing {
  shopId: string;
  upc: string;
  brand: string;
  name: string;
  price: Money;
}

const DEMO_OFFERS = buildOffers(sellersFromEnv());

export function searchListings(query: string): Listing[] {
  return searchOffers(query, DEMO_OFFERS).map((o) => ({
    shopId: o.seller.id,
    upc: o.upc,
    brand: o.brand,
    name: o.name,
    price: o.price,
  }));
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
