import { type Money, UPC_LEVOIT_CORE300, UPC_WINIX_A230 } from "@pact/protocol";

/** The one product + price table. The catalogue MCP imports this so its prices match the shops. */
export const SHOP_IDS = ["northwind", "lumen", "megamart"] as const;
export type ShopId = (typeof SHOP_IDS)[number];

export interface Product {
  upc: string;
  slug: string;
  name: string;
  blurb: string;
}

export interface Shop {
  id: ShopId;
  name: string;
  tagline: string;
  /** Price per UPC, in minor units. */
  prices: Record<string, Money>;
}

const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

export const PRODUCTS: Product[] = [
  {
    upc: UPC_WINIX_A230,
    slug: "winix-a230",
    name: "Winix A230 Air Purifier",
    blurb: "True HEPA with PlasmaWave, rated for rooms up to 360 sq ft.",
  },
  {
    upc: UPC_LEVOIT_CORE300,
    slug: "levoit-core-300",
    name: "Levoit Core 300 Air Purifier",
    blurb: "Compact HEPA purifier for bedrooms and small offices.",
  },
];

export const SHOPS: Record<ShopId, Shop> = {
  northwind: {
    id: "northwind",
    name: "Northwind",
    tagline: "Considered goods for the home",
    prices: { [UPC_WINIX_A230]: usd(9999), [UPC_LEVOIT_CORE300]: usd(9999) },
  },
  // $4 under Northwind on the Winix: where exposed agents end up paying in the demo.
  lumen: {
    id: "lumen",
    name: "Lumen",
    tagline: "Everyday home essentials",
    prices: { [UPC_WINIX_A230]: usd(9599), [UPC_LEVOIT_CORE300]: usd(9799) },
  },
  megamart: {
    id: "megamart",
    name: "MegaMart",
    tagline: "Everything under one roof",
    prices: { [UPC_WINIX_A230]: usd(10499), [UPC_LEVOIT_CORE300]: usd(9499) },
  },
};

export function isShopId(s: string): s is ShopId {
  return (SHOP_IDS as readonly string[]).includes(s);
}

export function productByUpc(upc: string): Product | undefined {
  return PRODUCTS.find((p) => p.upc === upc);
}

export function productBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function priceAt(shop: ShopId, upc: string): Money | undefined {
  return SHOPS[shop].prices[upc];
}

/** What the catalogue MCP lists for a product: one offer per shop. */
export function offersFor(upc: string): { shopId: ShopId; price: Money }[] {
  return SHOP_IDS.flatMap((shopId) => {
    const price = priceAt(shopId, upc);
    return price ? [{ shopId, price }] : [];
  });
}
