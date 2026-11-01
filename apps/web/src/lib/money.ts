import type { Money } from "@pact/protocol";

const digitsCache = new Map<string, number>();

function fractionDigits(currency: string): number {
  let d = digitsCache.get(currency);
  if (d === undefined) {
    d =
      new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    digitsCache.set(currency, d);
  }
  return d;
}

/**
 * The single place minor units become a display string. Division happens only here,
 * for formatting; arithmetic everywhere else stays in integer minor units.
 */
export function formatMoney(m: Money, opts: { compact?: boolean; signed?: boolean } = {}): string {
  const digits = fractionDigits(m.currency);
  const major = m.amountMinor / 10 ** digits;
  const whole = m.amountMinor % 10 ** digits === 0;
  const s = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: opts.compact && whole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(major);
  return opts.signed ? `+${s}` : s;
}

export function currencySymbol(currency: string): string {
  const part = new Intl.NumberFormat(undefined, { style: "currency", currency })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? currency;
}

/** Parse a user-typed major-unit string ("12.5") into minor units without floats. */
export function parseMajor(input: string, currency: string): Money | null {
  const digits = fractionDigits(currency);
  const clean = input.replace(/[,\s]/g, "");
  const re = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{0,${digits}})?$`);
  if (!re.test(clean)) return null;
  const [whole = "0", frac = ""] = clean.split(".");
  const amountMinor = Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(amountMinor) ? { amountMinor, currency } : null;
}

export function percentOf(part: Money, whole: Money): number {
  if (whole.amountMinor === 0) return 0;
  return Math.min(100, Math.round((part.amountMinor / whole.amountMinor) * 100));
}
