import {
  DEMO_SHOP_PRICES,
  HEADPHONE_SHOP_PRICES,
  type Money,
  UPC_BOSE_QC,
  UPC_LEVOIT_CORE300,
  UPC_ROBOROCK_Q7MAX,
  UPC_ROOMBA_J5,
  UPC_SONY_XM5,
  UPC_WINIX_A230,
  VACUUM_SHOP_PRICES,
} from "@pact/protocol";

/**
 * The merchants whose catalogues are synced to PayPal (our mock of Store Sync). Agents never
 * visit their websites: they read offers here and pay the seller's PayPal account directly.
 */
export const SELLER_IDS = ["northwind", "lumen", "megamart"] as const;
export type SellerId = (typeof SELLER_IDS)[number];

/** Where an order's money goes: the seller's PayPal account, as Orders v2 `payee`. */
export interface Payee {
  merchant_id?: string;
  email_address?: string;
}

export interface Seller {
  id: SellerId;
  name: string;
  /** The commerce platform the merchant syncs its catalogue from. */
  platform: string;
  payee: Payee;
  /** Price per UPC. The two products of a category cost the same at a given seller (price-matched studies). */
  prices: Record<string, Money>;
}

/** The catalogue's categories. A search is answered from one category, never a mix. */
export type Category = "air-purifier" | "robot-vacuum" | "headphones";

export interface Product {
  category: Category;
  upc: string;
  brand: string;
  name: string;
  specs: string;
}

export const PRODUCTS: Product[] = [
  {
    category: "air-purifier",
    upc: UPC_WINIX_A230,
    brand: "Winix",
    name: "A230",
    specs: "True HEPA with PlasmaWave, rated for rooms up to 360 sq ft",
  },
  {
    category: "air-purifier",
    upc: UPC_LEVOIT_CORE300,
    brand: "Levoit",
    name: "Core 300",
    specs: "Compact HEPA purifier for bedrooms and small offices",
  },
  {
    category: "robot-vacuum",
    upc: UPC_ROBOROCK_Q7MAX,
    brand: "Roborock",
    name: "Q7 Max",
    specs: "Robot vacuum and mop with laser navigation, for hard floors and low-pile rugs",
  },
  {
    category: "robot-vacuum",
    upc: UPC_ROOMBA_J5,
    brand: "iRobot",
    name: "Roomba Combo j5",
    specs: "Robot vacuum and mop with camera navigation, for hard floors and low-pile rugs",
  },
  // Listed in this order on purpose: the rival has the lower UPC, so at equal price and seller it
  // is listed first and the creator's tested pick (Bose) is not.
  {
    category: "headphones",
    upc: UPC_SONY_XM5,
    brand: "Sony",
    name: "WH-1000XM5",
    specs:
      "Over-ear wireless headphones with active noise cancelling and a built-in microphone for calls",
  },
  {
    category: "headphones",
    upc: UPC_BOSE_QC,
    brand: "Bose",
    name: "QuietComfort Headphones",
    specs:
      "Over-ear wireless headphones with active noise cancelling and a built-in microphone for calls",
  },
];

const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

const BASE: Record<SellerId, { name: string; platform: string; mockMerchantId: string }> = {
  northwind: { name: "Northwind", platform: "Shopify", mockMerchantId: "SIMNORTHWIND1" },
  // $4 under Northwind: where exposed agents end up paying in the demo.
  lumen: { name: "Lumen", platform: "WooCommerce", mockMerchantId: "SIMLUMEN00001" },
  megamart: { name: "MegaMart", platform: "BigCommerce", mockMerchantId: "SIMMEGAMART01" },
};

type Env = Record<string, string | undefined>;

/** `CITED_SELLER_<ID>_PAYEE`: a PayPal merchant id, or the account's email if it has an `@`. */
export function payeeFromEnv(id: SellerId, env: Env): Payee {
  const v = env[`CITED_SELLER_${id.toUpperCase()}_PAYEE`]?.trim();
  if (!v) return { merchant_id: BASE[id].mockMerchantId };
  return v.includes("@") ? { email_address: v } : { merchant_id: v };
}

export function sellersFromEnv(env: Env = {}): Record<SellerId, Seller> {
  const out = {} as Record<SellerId, Seller>;
  for (const id of SELLER_IDS) {
    out[id] = {
      id,
      name: BASE[id].name,
      platform: BASE[id].platform,
      payee: payeeFromEnv(id, env),
      prices: Object.fromEntries(
        Object.entries({
          ...DEMO_SHOP_PRICES[id],
          ...VACUUM_SHOP_PRICES[id],
          ...HEADPHONE_SHOP_PRICES[id],
        }).map(([upc, minor]) => [upc, usd(minor)]),
      ),
    };
  }
  return out;
}

export function isSellerId(s: string): s is SellerId {
  return (SELLER_IDS as readonly string[]).includes(s);
}

export const productByUpc = (upc: string) => PRODUCTS.find((p) => p.upc === upc);
