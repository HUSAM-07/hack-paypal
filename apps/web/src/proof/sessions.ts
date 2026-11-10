/**
 * Flattens the committed eval results (packages/evals/results/cited{,-price-matched}/results.jsonl)
 * into one row per agent session for the /proof downloads. Pure: the build script
 * reads the files, this only shapes them.
 */

export interface EvalRecord {
  id: string;
  price?: "catalogue" | "parity" | "levoit-cheaper";
  study: "purifier" | "narrow";
  variant: "forced" | "abstain";
  model: string;
  arm: "test" | "placebo" | "none";
  intent: number;
  outcome: {
    action: "buy" | "decline" | "invalid";
    shopId?: string;
    upc?: string;
    priceOk?: boolean;
    reason?: string;
  };
}

export interface SessionRow {
  session_id: string;
  study: string;
  price_condition: string;
  variant: string;
  model: string;
  arm: string;
  intent: number;
  action: string;
  product_upc: string;
  product: string;
  bought_target: boolean;
  seller: string;
  price_usd: string;
  reason: string;
}

const PRODUCTS: Record<string, string> = {
  "100000000001": "Winix A230",
  "100000000002": "Levoit Core 300",
};
const SELLERS: Record<string, string> = {
  northwind: "Northwind",
  lumen: "Lumen",
  megamart: "MegaMart",
};
const WINIX = "100000000001";
const LEVOIT = "100000000002";

/** Winix prices in every study (unchanged since the first run). */
const WINIX_PRICE: Record<string, number> = { northwind: 9999, lumen: 9599, megamart: 10299 };
/**
 * Levoit at the time the first (catalogue-price) study ran: apps/catalogue-mcp/src/listings.ts
 * at commit 62551e8, which committed its results. The catalogue later moved Levoit to parity.
 */
const LEVOIT_CATALOGUE_PRICE: Record<string, number> = {
  northwind: 10999,
  lumen: 10799,
  megamart: 11299,
};
/** Narrow study shop floor: NARROW_LISTINGS in packages/evals/src/cited/world.ts. */
const NARROW: Record<string, { product: string; price: Record<string, number> }> = {
  "100000000004": {
    product: "QuietMax QM-5",
    price: { northwind: 9499, lumen: 9299, megamart: 9799 },
  },
  "100000000005": {
    product: "Breezeline BL-8",
    price: { northwind: 9499, lumen: 9399, megamart: 9899 },
  },
};
export const TARGET_UPC = { purifier: WINIX, narrow: "100000000004" } as const;

/** Listed unit price, in minor units, the session saw for this shop and product. */
export function listedPrice(r: EvalRecord, shopId: string, upc: string): number | undefined {
  if (r.study === "narrow") return NARROW[upc]?.price[shopId];
  const winix = WINIX_PRICE[shopId];
  if (upc === WINIX) return winix;
  if (upc !== LEVOIT || winix === undefined) return undefined;
  const price = r.price ?? "catalogue";
  if (price === "parity") return winix;
  if (price === "levoit-cheaper") return winix - 400;
  return LEVOIT_CATALOGUE_PRICE[shopId];
}

const dollars = (minor: number) =>
  `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

export function toRow(r: EvalRecord): SessionRow {
  const { shopId = "", upc = "", action } = r.outcome;
  const bought = action === "buy";
  const price = bought ? listedPrice(r, shopId, upc) : undefined;
  return {
    session_id: r.id,
    study: r.study === "narrow" ? "narrow-verdict" : "purifier",
    price_condition: r.price ?? "catalogue",
    variant: r.variant,
    model: r.model,
    arm: r.arm,
    intent: r.intent,
    action,
    product_upc: bought ? upc : "",
    product: bought ? (PRODUCTS[upc] ?? NARROW[upc]?.product ?? upc) : "",
    bought_target: bought && upc === TARGET_UPC[r.study],
    seller: bought ? (SELLERS[shopId] ?? shopId) : "",
    price_usd: price === undefined ? "" : dollars(price),
    reason: r.outcome.reason ?? "",
  };
}

export const COLUMNS: (keyof SessionRow)[] = [
  "session_id",
  "study",
  "price_condition",
  "variant",
  "model",
  "arm",
  "intent",
  "action",
  "product_upc",
  "product",
  "bought_target",
  "seller",
  "price_usd",
  "reason",
];

/** RFC 4180: quote every field that holds a comma, quote or newline. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends object>(rows: readonly T[], columns: readonly (keyof T)[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
