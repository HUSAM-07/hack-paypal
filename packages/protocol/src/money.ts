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

/**
 * The currencies PayPal's REST APIs accept for Orders v2 and Payouts (PayPal's currency codes
 * list). The simulated PayPal refuses anything else, like the real one.
 */
export const PAYPAL_CURRENCIES: ReadonlySet<string> = new Set([
  "AUD",
  "BRL",
  "CAD",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "HKD",
  "HUF",
  "ILS",
  "JPY",
  "MYR",
  "MXN",
  "TWD",
  "NZD",
  "NOK",
  "PHP",
  "PLN",
  "GBP",
  "RUB",
  "SGD",
  "SEK",
  "CHF",
  "THB",
  "USD",
]);

/**
 * The currencies a CITED programme can run in: US dollars, pounds and euros. Each programme lives
 * entirely in one of them: its deposit, credits, payouts and statement are never converted.
 * All three have two decimal places, so every amount stays integer cents or pence.
 */
export const PROGRAMME_CURRENCIES = ["USD", "GBP", "EUR"] as const;
export type ProgrammeCurrency = (typeof PROGRAMME_CURRENCIES)[number];
export const isProgrammeCurrency = (c: string): c is ProgrammeCurrency =>
  (PROGRAMME_CURRENCIES as readonly string[]).includes(c);

export const CURRENCY_NAME: Record<ProgrammeCurrency, string> = {
  USD: "US dollars",
  GBP: "British pounds",
  EUR: "Euros",
};

/** "$", "£", "€"; any other currency is its code and a space ("CHF "). */
export const currencySymbol = (currency: string): string =>
  ({ USD: "$", GBP: "£", EUR: "€" })[currency as "USD"] ?? `${currency} `;

/** Digits after the point: 0 for JPY, HUF, TWD, otherwise 2. */
export const minorUnits = (currency: string): number => (ZERO_DECIMAL.has(currency) ? 0 : 2);

/**
 * "$1,250.00", "£1,250.00", "€1,250.00": the symbol of the amount's own currency, en-US grouping.
 * Any other code prints as "CHF 1,250.00". Integer minor units in, text out; never a conversion.
 */
export function formatCurrency(
  amountMinor: number,
  currency: string,
  opts: { cents?: boolean } = {},
): string {
  const digits = minorUnits(currency);
  const shown = opts.cents === false ? 0 : digits;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: shown,
    maximumFractionDigits: shown,
  }).format(amountMinor / 10 ** digits);
}

export function toPayPalValue(m: Money): string {
  if (ZERO_DECIMAL.has(m.currency)) return String(m.amountMinor);
  const whole = Math.floor(m.amountMinor / 100);
  const cents = String(m.amountMinor % 100).padStart(2, "0");
  return `${whole}.${cents}`;
}

export function fromPayPalValue(value: string, currency: string): Money {
  if (ZERO_DECIMAL.has(currency)) {
    // PayPal refuses a decimal point in JPY, HUF and TWD.
    if (!/^\d+$/.test(value)) throw new Error(`invalid PayPal amount: ${value}`);
    return { amountMinor: Number(value), currency };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`invalid PayPal amount: ${value}`);
  const [whole = "0", frac = ""] = value.split(".");
  return { amountMinor: Number(whole) * 100 + Number(frac.padEnd(2, "0")), currency };
}
