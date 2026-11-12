import {
  airlabWinixTest,
  crumblabPlacebo,
  crumblabRoborockTest,
  housefreshPlacebo,
  housefreshWinixTest,
  type Money,
  quietbenchBoseTest,
  quietbenchPlacebo,
  type VerifiedTest,
} from "@pact/protocol";
import {
  type Category,
  type Payee,
  PRODUCTS,
  productByUpc,
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
 * Which category a query is about. A query that asks for a robot vacuum or for headphones is
 * answered from that category; anything else is the purifier search it always was.
 */
const VACUUM_QUERY = /\b(vacuums?|robots?|robotic|roomba|roborock|irobot|mops?|sweepers?)\b/;
const HEADPHONE_QUERY =
  /\b(headphones?|earphones?|earbuds?|headsets?|noise[- ]?cancell?ing|anc|over-ear|sony|bose|wh-1000xm5|quietcomfort)\b/;
export const categoryOfQuery = (query: string): Category => {
  const q = query.toLowerCase();
  if (VACUUM_QUERY.test(q)) return "robot-vacuum";
  return HEADPHONE_QUERY.test(q) ? "headphones" : "air-purifier";
};

/**
 * Ranking depends only on the query and the offers (price, then seller, then UPC).
 * It never sees the arm, so it cannot differ between arms. A query is answered from one
 * category, so adding a category cannot change what an existing search returns.
 */
export function searchOffers(query: string, offers: Offer[]): Offer[] {
  const q = query.toLowerCase();
  const category = categoryOfQuery(q);
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  const generic =
    category === "air-purifier"
      ? /purifier|air|clean|filter|hepa/.test(q)
      : category === "robot-vacuum"
        ? /\b(vacuums?|robots?|robotic|mops?|sweepers?)\b/.test(q)
        : /\b(headphones?|earphones?|earbuds?|headsets?|noise|cancell?ing|anc|over-ear)\b/.test(q);
  const matches = offers.filter(
    (o) =>
      productByUpc(o.upc)?.category === category &&
      (generic || words.some((w) => `${o.brand} ${o.name}`.toLowerCase().includes(w))),
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
  category: Category = "air-purifier",
): VerifiedTest[] {
  if (arm === "none") return [];
  if (category === "robot-vacuum")
    return [arm === "placebo" ? crumblabPlacebo : crumblabRoborockTest];
  if (category === "headphones")
    return [arm === "placebo" ? quietbenchPlacebo : quietbenchBoseTest];
  if (arm === "placebo") return [housefreshPlacebo];
  return coExposed ? [housefreshWinixTest, airlabWinixTest] : [housefreshWinixTest];
}
