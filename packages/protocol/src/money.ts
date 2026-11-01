import { z } from "zod";

/** ISO 4217 code. Sandbox flows are USD-first but nothing below assumes it. */
export const Currency = z.string().regex(/^[A-Z]{3}$/);

/**
 * Money is always integer minor units plus a currency. Never floats, never
 * strings: formatting happens only at the edge (UI, PayPal request bodies).
 */
export const Money = z.object({
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: Currency,
});
export type Money = z.infer<typeof Money>;

export const ZERO_USD: Money = { amountMinor: 0, currency: "USD" };

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

/** PayPal's REST APIs take decimal strings ("12.50"); zero-decimal currencies omit the point. */
const ZERO_DECIMAL = new Set(["JPY", "HUF", "TWD"]);

export function toPayPalValue(m: Money): string {
  if (ZERO_DECIMAL.has(m.currency)) return String(m.amountMinor);
  const whole = Math.floor(m.amountMinor / 100);
  const cents = String(m.amountMinor % 100).padStart(2, "0");
  return `${whole}.${cents}`;
}

export function fromPayPalValue(value: string, currency: string): Money {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`invalid PayPal amount: ${value}`);
  if (ZERO_DECIMAL.has(currency)) return { amountMinor: Number(value), currency };
  const [whole = "0", frac = ""] = value.split(".");
  return { amountMinor: Number(whole) * 100 + Number(frac.padEnd(2, "0")), currency };
}
