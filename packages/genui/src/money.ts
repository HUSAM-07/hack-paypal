import type { Money } from "@shop/agent-protocol";

/**
 * Money display. The only way the kit turns `Money {amountMinor, currency}` into text.
 * The minor-unit exponent comes from Intl (JPY 0, USD 2, KWD 3), and the amount is handed to
 * Intl as a decimal string built from integers, so no float ever touches a price.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, locale: string | undefined, compact: boolean) {
  const key = `${locale ?? ""}|${currency}|${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      ...(compact ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    });
    formatters.set(key, f);
  }
  return f;
}

/** ISO 4217 minor-unit exponent for a currency (USD 2, JPY 0, BHD 3). */
export function currencyExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Exact decimal string for integer minor units, e.g. (123456, 2) → "1234.56", (-5, 2) → "-0.05". */
export function minorToDecimalString(amountMinor: number, exponent: number): string {
  if (!Number.isSafeInteger(amountMinor))
    throw new RangeError("amountMinor must be a safe integer");
  const neg = amountMinor < 0;
  const digits = String(Math.abs(amountMinor));
  if (exponent === 0) return (neg ? "-" : "") + digits;
  const padded = digits.padStart(exponent + 1, "0");
  const whole = padded.slice(0, -exponent);
  const frac = padded.slice(-exponent);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export type FormatMoneyOptions = {
  locale?: string;
  /** Drop the minor units when they are zero ("$279" instead of "$279.00"). */
  trimZeroCents?: boolean;
};

export function formatMoney(money: Money, opts: FormatMoneyOptions = {}): string {
  const exp = currencyExponent(money.currency);
  const trim = opts.trimZeroCents === true && money.amountMinor % 10 ** exp === 0;
  const f = formatter(money.currency, opts.locale, trim);
  // Intl.NumberFormat formats decimal strings exactly (ES2023 Intl.NumberFormat v3).
  return f.format(minorToDecimalString(money.amountMinor, exp) as unknown as number);
}

/** Signed difference `a - b` in the same currency, or undefined across currencies. */
export function diffMoney(a: Money, b: Money): Money | undefined {
  if (a.currency !== b.currency) return undefined;
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

/** Whole-number percentage that `price` sits below `ref` (e.g. a "-12%" chip), or undefined. */
export function percentOff(price: Money, ref: Money): number | undefined {
  if (price.currency !== ref.currency || ref.amountMinor <= 0) return undefined;
  if (price.amountMinor >= ref.amountMinor) return undefined;
  return Math.round(((ref.amountMinor - price.amountMinor) * 100) / ref.amountMinor);
}

/**
 * Parse what a person typed in major units ("279", "279.9", "1,279.99") into minor units,
 * using string arithmetic only. Returns undefined for anything that isn't a plain amount or
 * has more decimals than the currency allows.
 */
export function parseMajorToMinor(input: string, currency: string): number | undefined {
  const exp = currencyExponent(currency);
  const s = input.trim().replace(/[,\s]/g, "");
  const m = /^(\d{1,12})(?:\.(\d*))?$/.exec(s);
  if (!m) return undefined;
  const frac = m[2] ?? "";
  if (frac.length > exp) return undefined;
  const minor = Number(`${m[1]}${frac.padEnd(exp, "0")}`);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

/** The editable major-unit text for a Money value ("279.99"; "279" for whole amounts). */
export function moneyToInput(money: Money): string {
  const exp = currencyExponent(money.currency);
  const s = minorToDecimalString(money.amountMinor, exp);
  return s.endsWith(`.${"0".repeat(exp)}`) ? s.slice(0, -(exp + 1)) : s;
}
