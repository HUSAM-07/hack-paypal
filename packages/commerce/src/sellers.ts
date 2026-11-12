/**
 * PayPal sellers: the only offers that can be bought (and auto-bought) in the shop.
 *
 * v1 is `paypalSellerSource()`: a seeded set of sandbox sellers and products. The fixture text
 * is ours (no scraped copy or reviews).
 *
 * ── CITED integration seam (documented, not wired) ──
 * Swap this source for one backed by `apps/catalogue-mcp`:
 *  - `search()` → `search_product`. The catalogue's ranking is identical across CITED arms; it
 *    only adds or withholds a creator test, so this source must keep the order it returns and
 *    never re-rank.
 *  - `quote()` → the catalogue's live offer (the authoritative price for PayPal sellers).
 *  - checkout → `checkout`: the catalogue issues the signed Agent Affiliate Passport, and the
 *    order carries it in `purchase_units[].custom_id` (≤127 chars). Today `custom_id` holds our
 *    order id; the `customId` hook in `checkout.ts` (`CheckoutOptions.customIdFor`) is where the
 *    passport goes.
 * Nothing else changes: offers stay `source: "paypalSeller"`, `buyable: true`.
 */
import type { Money } from "@pact/protocol";
import type { Offer } from "./contract";
import { applyBps } from "./money";

export interface Quote {
  offerId: string;
  quantity: number;
  unit: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  inStock: boolean;
  variant?: string;
}

export interface OfferSource {
  readonly name: string;
  /** In the source's own order; callers must not re-rank (CITED: ranking identical across arms). */
  search(q: { query: string; maxPrice?: Money | undefined }, at: Date): Promise<Offer[]>;
  get(offerId: string, at: Date): Promise<Offer | undefined>;
  /** Live, authoritative price for `quantity` units: unit, shipping, tax, total. */
  quote(offerId: string, quantity: number, at: Date): Promise<Quote | undefined>;
}

export interface SeedSeller {
  paypalSellerId: string;
  name: string;
  domain: string;
  shipping: Money;
  /** Sales tax in basis points of the item subtotal. */
  taxBps: number;
}

export interface SeedProduct {
  id: string;
  sellerId: string;
  title: string;
  brand: string;
  variant: string;
  price: Money;
  listPrice?: Money;
  inStock: boolean;
  tags: string[];
  highlights: string[];
}

const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

export const SEED_SELLERS: SeedSeller[] = [
  {
    paypalSellerId: "SELLERAUDIO01",
    name: "Northwind Audio",
    domain: "northwind-audio.example",
    shipping: usd(0),
    taxBps: 825,
  },
  {
    paypalSellerId: "SELLERHOME01",
    name: "Harbor Home",
    domain: "harbor-home.example",
    shipping: usd(999),
    taxBps: 700,
  },
  {
    paypalSellerId: "SELLERGEAR01",
    name: "Kestrel Gear",
    domain: "kestrel-gear.example",
    shipping: usd(499),
    taxBps: 600,
  },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    id: "pp_sony_xm6",
    sellerId: "SELLERAUDIO01",
    title: "Sony WH-1000XM6 Wireless Noise Cancelling Headphones",
    brand: "Sony",
    variant: "Black",
    price: usd(39_999),
    inStock: true,
    tags: ["headphones", "noise cancelling", "anc", "wireless", "xm6", "over-ear"],
    highlights: ["Ships free from Northwind Audio", "30-day returns"],
  },
  {
    id: "pp_bose_qcu",
    sellerId: "SELLERAUDIO01",
    title: "Bose QuietComfort Ultra Headphones",
    brand: "Bose",
    variant: "White Smoke",
    price: usd(37_900),
    listPrice: usd(42_900),
    inStock: true,
    tags: ["headphones", "noise cancelling", "anc", "wireless", "over-ear"],
    highlights: ["Ships free from Northwind Audio"],
  },
  {
    id: "pp_sony_wf1000xm5",
    sellerId: "SELLERAUDIO01",
    title: "Sony WF-1000XM5 Noise Cancelling Earbuds",
    brand: "Sony",
    variant: "Black",
    price: usd(27_999),
    inStock: true,
    tags: ["earbuds", "noise cancelling", "anc", "wireless", "in-ear"],
    highlights: ["Ships free from Northwind Audio"],
  },
  {
    id: "pp_roborock_q7",
    sellerId: "SELLERHOME01",
    title: "Roborock Q7 Max Robot Vacuum and Mop",
    brand: "Roborock",
    variant: "Black",
    price: usd(29_999),
    listPrice: usd(34_999),
    inStock: true,
    tags: ["vacuum", "robot vacuum", "mop", "cleaning"],
    highlights: ["Flat-rate shipping from Harbor Home"],
  },
  {
    id: "pp_dyson_v15",
    sellerId: "SELLERHOME01",
    title: "Dyson V15 Detect Cordless Vacuum",
    brand: "Dyson",
    variant: "Nickel",
    price: usd(64_999),
    inStock: true,
    tags: ["vacuum", "cordless vacuum", "stick vacuum", "cleaning"],
    highlights: ["Flat-rate shipping from Harbor Home"],
  },
  {
    id: "pp_breville_bambino",
    sellerId: "SELLERHOME01",
    title: "Breville Bambino Plus Espresso Machine",
    brand: "Breville",
    variant: "Brushed Stainless Steel",
    price: usd(49_995),
    inStock: false,
    tags: ["espresso", "coffee", "espresso machine", "kitchen"],
    highlights: ["Restock expected soon"],
  },
  {
    id: "pp_anker_737",
    sellerId: "SELLERGEAR01",
    title: "Anker 737 Power Bank 24,000mAh",
    brand: "Anker",
    variant: "Black",
    price: usd(10_999),
    inStock: true,
    tags: ["power bank", "battery", "charger", "usb-c", "travel"],
    highlights: ["Ships from Kestrel Gear"],
  },
  {
    id: "pp_hydroflask_32",
    sellerId: "SELLERGEAR01",
    title: "Hydro Flask 32 oz Wide Mouth Bottle",
    brand: "Hydro Flask",
    variant: "Pacific",
    price: usd(4_495),
    inStock: true,
    tags: ["water bottle", "bottle", "insulated", "travel", "outdoor"],
    highlights: ["Ships from Kestrel Gear"],
  },
];

export interface SeededSellerSource extends OfferSource {
  /** Demo / test control: the seller changes its price (the "price drop" beat). */
  setPrice(offerId: string, price: Money): void;
  setStock(offerId: string, inStock: boolean): void;
  setVariant(offerId: string, variant: string): void;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

export function paypalSellerSource(
  seed: { sellers?: SeedSeller[]; products?: SeedProduct[] } = {},
): SeededSellerSource {
  const sellers = new Map((seed.sellers ?? SEED_SELLERS).map((s) => [s.paypalSellerId, s]));
  const products = new Map(
    (seed.products ?? SEED_PRODUCTS).map((p) => [p.id, { ...p, tags: [...p.tags] }]),
  );

  function toOffer(p: SeedProduct, at: Date): Offer {
    const s = sellers.get(p.sellerId);
    if (!s) throw new Error(`seed product ${p.id} names unknown seller ${p.sellerId}`);
    const offer: Offer = {
      id: p.id,
      title: p.title,
      brand: p.brand,
      url: `https://${s.domain}/p/${p.id.replace(/^pp_/, "")}`,
      merchant: { name: s.name, domain: s.domain, paypalSellerId: s.paypalSellerId },
      price: p.price,
      shipping: s.shipping,
      inStock: p.inStock,
      highlights: p.highlights.slice(0, 5),
      buyable: true,
      source: "paypalSeller",
      seenAt: at.toISOString(),
    };
    if (p.listPrice && p.listPrice.amountMinor > p.price.amountMinor) offer.listPrice = p.listPrice;
    return offer;
  }

  const product = (id: string) => {
    const p = products.get(id);
    if (!p) throw new Error(`unknown seeded offer ${id}`);
    return p;
  };

  return {
    name: "paypalSellers",
    async search(q, at) {
      const terms = words(q.query);
      const scored = [...products.values()]
        .map((p) => {
          const hay = new Set(words([p.title, p.brand, ...p.tags].join(" ")));
          return { p, score: terms.filter((t) => hay.has(t)).length };
        })
        .filter((x) => x.score > 0)
        .filter(
          (x) =>
            !q.maxPrice ||
            (x.p.price.currency === q.maxPrice.currency &&
              x.p.price.amountMinor <= q.maxPrice.amountMinor),
        )
        // Stable, deterministic order: relevance, then seed order.
        .sort((a, b) => b.score - a.score);
      return scored.map((x) => toOffer(x.p, at));
    },
    async get(offerId, at) {
      const p = products.get(offerId);
      return p ? toOffer(p, at) : undefined;
    },
    async quote(offerId, quantity, _at) {
      const p = products.get(offerId);
      const s = p && sellers.get(p.sellerId);
      if (!p || !s) return undefined;
      const subtotal = p.price.amountMinor * quantity;
      const tax = applyBps(subtotal, s.taxBps);
      const currency = p.price.currency;
      return {
        offerId,
        quantity,
        unit: p.price,
        shipping: s.shipping,
        tax: { amountMinor: tax, currency },
        total: { amountMinor: subtotal + s.shipping.amountMinor + tax, currency },
        inStock: p.inStock,
        variant: p.variant,
      };
    },
    setPrice(offerId, price) {
      product(offerId).price = price;
    },
    setStock(offerId, inStock) {
      product(offerId).inStock = inStock;
    },
    setVariant(offerId, variant) {
      product(offerId).variant = variant;
    },
  };
}
