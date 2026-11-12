/**
 * Prices arrive as text from untrusted pages ("$1,299.99", "1.299,99 €", "279.5", 279.99).
 * Everything here is string arithmetic: no float ever becomes an amount.
 */
import { type Money, minorUnits } from "@pact/protocol";

const SYMBOLS: Record<string, string> = {
  $: "USD",
  US$: "USD",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  C$: "CAD",
  A$: "AUD",
};

const ISO = /\b([A-Z]{3})\b/;

/** The currency a price string names, if any ("€19,99" → EUR, "CHF 20" → CHF). */
export function detectCurrency(text: string): string | undefined {
  const t = text.trim();
  for (const sym of ["US$", "C$", "A$"]) if (t.includes(sym)) return SYMBOLS[sym];
  for (const ch of ["$", "£", "€", "¥"]) if (t.includes(ch)) return SYMBOLS[ch];
  return ISO.exec(t.toUpperCase())?.[1];
}

/**
 * A decimal price string to integer minor units of `currency`, or undefined when it isn't a
 * single clear amount. Handles `1,299.99`, `1.299,99`, `1 299,99`, `1299`, `.99`.
 * Extra fraction digits round half-up ("19.9951" → 2000 cents).
 *
 * `schemaOrg: true` is for structured data (JSON-LD `price`, JSON numbers): there `.` is always
 * the decimal point and nothing groups, so "19.990" is 19.99, not 19,990.
 */
export function parseDecimalMinor(
  raw: string | number,
  currency: string,
  opts: { schemaOrg?: boolean } = {},
): number | undefined {
  // A JSON number: String() gives the shortest round-trip decimal ("279.99"), never 279.98999….
  let s = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : raw;
  if (/e/i.test(s)) return undefined;
  const digits = minorUnits(currency);
  if (opts.schemaOrg || typeof raw === "number") {
    s = s.trim();
    if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return undefined;
    const [w = "", f = ""] = s.split(".");
    return toMinor(w === "" ? "0" : w, f, digits);
  }
  s = s.replace(/[\s  ']/g, "").replace(/[^\d.,-]/g, "");
  if (s === "" || s.includes("-")) return undefined;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let whole: string;
  let frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    // Both separators: the later one is the decimal point.
    const dec = lastDot > lastComma ? "." : ",";
    const grp = dec === "." ? "," : ".";
    const [w, f = ""] = s.split(dec) as [string, string?];
    if (s.split(dec).length !== 2 || f.includes(grp)) return undefined;
    if (!validGrouping(w, grp)) return undefined;
    whole = w.replaceAll(grp, "");
    frac = f;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1] ?? "";
    // One separator followed by exactly three digits is grouping ("1,299", "1.299"),
    // unless the currency has no minor units, where any separator groups.
    const grouping =
      digits === 0 || parts.length > 2 || (tail.length === 3 && (parts[0] ?? "") !== "");
    if (grouping) {
      if (!validGrouping(s, sep)) return undefined;
      whole = s.replaceAll(sep, "");
    } else {
      whole = parts[0] ?? "";
      frac = tail;
    }
  } else {
    whole = s;
  }
  if (whole === "") whole = "0";
  return toMinor(whole, frac, digits);
}

function toMinor(whole: string, frac: string, digits: number): number | undefined {
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac)) return undefined;
  if (whole.length > 13) return undefined;
  const kept = frac.slice(0, digits).padEnd(digits, "0");
  const dropped = frac.slice(digits);
  let minor = Number(whole) * 10 ** digits + (digits > 0 ? Number(kept) : 0);
  if (dropped !== "" && Number(dropped[0]) >= 5) minor += 1;
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function validGrouping(s: string, sep: string): boolean {
  const groups = s.split(sep);
  if (groups.length === 1) return true;
  const [head, ...rest] = groups;
  return head !== undefined && /^\d{1,3}$/.test(head) && rest.every((g) => /^\d{3}$/.test(g));
}

/** "$1,299.99" → {129999, USD}. `fallbackCurrency` applies when the text names none. */
export function parsePrice(
  raw: string | number,
  fallbackCurrency?: string,
  opts: { schemaOrg?: boolean } = {},
): Money | undefined {
  const currency =
    (typeof raw === "string" ? detectCurrency(raw) : undefined) ?? fallbackCurrency?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return undefined;
  const amountMinor = parseDecimalMinor(raw, currency, opts);
  return amountMinor === undefined ? undefined : { amountMinor, currency };
}

const NUM = String.raw`(?:\d{1,3}(?:[,.  ]\d{3})+|\d+)(?:[.,]\d{1,2})?`;
const PRICE_IN_TEXT = new RegExp(
  String.raw`(?:US\$|C\$|A\$|[$£€¥])\s?${NUM}|${NUM}\s?(?:[$£€]|USD\b|EUR\b|GBP\b)`,
  "g",
);

/** The first currency-marked amount in free text (page text, highlights). Heuristic. */
export function findPriceInText(text: string, fallbackCurrency?: string): Money | undefined {
  for (const m of text.matchAll(PRICE_IN_TEXT)) {
    const p = parsePrice(m[0], fallbackCurrency);
    if (p && p.amountMinor > 0) return p;
  }
  return undefined;
}

/** Round-half-up `amount * bps / 10000` in integers (tax, percentages). */
export function applyBps(amountMinor: number, bps: number): number {
  return Math.floor((amountMinor * bps + 5_000) / 10_000);
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

export function sumMoney(currency: string, ...parts: (Money | undefined)[]): Money {
  let amountMinor = 0;
  for (const p of parts) {
    if (!p) continue;
    if (p.currency !== currency) throw new Error(`currency mismatch: ${p.currency} vs ${currency}`);
    amountMinor += p.amountMinor;
  }
  return { amountMinor, currency };
}
