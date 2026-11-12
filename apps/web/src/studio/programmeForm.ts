/**
 * The "Start a programme" flow as plain state: what a brand picked, what it still has to do, and
 * the words it reads before it confirms. No React and no network, so the whole flow is testable.
 * The server checks the same choices again with the engine's own rules (checkProgrammeTerms).
 */
import {
  CURRENCY_NAME,
  commissionOn,
  DEMO_SHOP_PRICES,
  formatCurrency,
  HEADPHONE_SHOP_PRICES,
  PROGRAMME_CATEGORIES,
  PROGRAMME_CURRENCIES,
  PROGRAMME_LIMITS,
  type ProgrammeCategory,
  type ProgrammeCategoryId,
  type ProgrammeCurrency,
  type ProgrammeProduct,
  VACUUM_SHOP_PRICES,
} from "@pact/protocol";

export { PROGRAMME_CURRENCIES };

/** The money word in the words a brand reads: "dollars", "pounds", "euros". */
export const CURRENCY_WORD: Record<ProgrammeCurrency, string> = {
  USD: "dollars",
  GBP: "pounds",
  EUR: "euros",
};
/** A sale of 100.00 in the programme's currency: a round example, never an exchange rate. */
const EXAMPLE_SALE_MINOR = 10_000;

export type Step = "category" | "terms" | "review" | "done";
export const STEPS: { id: Exclude<Step, "done">; label: string }[] = [
  { id: "category", label: "Category" },
  { id: "terms", label: "Terms" },
  { id: "review", label: "Review" },
];

export interface FormState {
  step: Step;
  category: ProgrammeCategoryId | null;
  upc: string | null;
  /** The currency the programme lives in. Its deposit, credits and payouts are all in it. */
  currency: ProgrammeCurrency;
  /** What the brand typed, in that currency: e.g. "500" or "$1,250.50". Parsed only when read. */
  deposit: string;
  /** What the brand typed: percent, e.g. "8" or "12.5". */
  commission: string;
}

export type Action =
  | { type: "category"; category: ProgrammeCategoryId }
  | { type: "product"; upc: string }
  | { type: "currency"; currency: ProgrammeCurrency }
  | { type: "deposit"; value: string }
  | { type: "commission"; value: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "done" }
  | { type: "reset" };

/** Programme ids already running (the brand rows Studio shows), one per product. */
export type Running = ReadonlySet<string>;

export const productsOf = (c: ProgrammeCategory, running: Running) =>
  c.products.map((p) => ({ ...p, taken: running.has(p.brandId) }));

export const freeProducts = (c: ProgrammeCategory, running: Running) =>
  productsOf(c, running).filter((p) => !p.taken);

export const categoryOf = (id: ProgrammeCategoryId | null) =>
  PROGRAMME_CATEGORIES.find((c) => c.id === id) ?? null;

export const productOf = (
  upc: string | null,
): (ProgrammeProduct & { category: ProgrammeCategoryId }) | null => {
  for (const c of PROGRAMME_CATEGORIES) {
    const p = c.products.find((x) => x.upc === upc);
    if (p) return { ...p, category: c.id };
  }
  return null;
};

/** The first category that still has a product to fund, or null when every product has one. */
export const firstOpenCategory = (running: Running): ProgrammeCategoryId | null =>
  PROGRAMME_CATEGORIES.find((c) => freeProducts(c, running).length > 0)?.id ?? null;

export function initialForm(running: Running): FormState {
  const category = firstOpenCategory(running);
  const first =
    categoryOf(category) && freeProducts(categoryOf(category) as ProgrammeCategory, running)[0];
  return {
    step: "category",
    category,
    upc: first ? first.upc : null,
    currency: "USD",
    deposit: String(PROGRAMME_LIMITS.defaultDepositMinor / 100),
    commission: String(PROGRAMME_LIMITS.defaultCommissionBps / 100),
  };
}

/**
 * "$1,250.50", "£1,250.50", "€500" or "500" to integer cents (or pence), without ever going
 * through a float. Null when it is not a plain amount with at most two decimals.
 */
export function parseDollars(text: string): number | null {
  const m = /^[$£€]?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const whole = Number((m[1] as string).replaceAll(",", ""));
  const cents = Number(((m[2] ?? "") + "00").slice(0, 2));
  const minor = whole * 100 + cents;
  return Number.isSafeInteger(minor) ? minor : null;
}

/** "8", "12.5" or "8%" to basis points (800, 1250, 800). Null unless 0.01% steps at most. */
export function parsePercent(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?\s*%?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2));
}

export interface Terms {
  depositMinor: number;
  commissionBps: number;
}

export interface TermsProblem {
  deposit: string | null;
  commission: string | null;
}

/** "$500.00", "£500.00", "€500.00": a deposit shown in the programme's own currency. */
export const fmt = (minor: number, currency: ProgrammeCurrency = "USD") =>
  formatCurrency(minor, currency);
const pctText = (bps: number) => `${bps / 100}%`;

type Typed = Pick<FormState, "deposit" | "commission"> & {
  currency?: ProgrammeCurrency | undefined;
};

/** What is wrong with the typed terms, in plain words; null on a field means it is fine. */
export function termsProblems(s: Typed): TermsProblem {
  const currency = s.currency ?? "USD";
  const dep = parseDollars(s.deposit);
  const com = parsePercent(s.commission);
  const {
    minDepositMinor: lo,
    maxDepositMinor: hi,
    minCommissionBps: cLo,
    maxCommissionBps: cHi,
  } = PROGRAMME_LIMITS;
  return {
    deposit:
      dep === null
        ? `Enter an amount in ${CURRENCY_WORD[currency]}, like 500 or 1,250.50.`
        : dep < lo || dep > hi
          ? `Choose between ${fmt(lo, currency)} and ${fmt(hi, currency)}.`
          : null,
    commission:
      com === null
        ? "Enter a percentage, like 8 or 12.5."
        : com < cLo || com > cHi
          ? `Choose between ${pctText(cLo)} and ${pctText(cHi)}.`
          : null,
  };
}

/** The integer terms, or null while anything is invalid. */
export function termsOf(s: Typed): Terms | null {
  const p = termsProblems(s);
  if (p.deposit || p.commission) return null;
  return {
    depositMinor: parseDollars(s.deposit) as number,
    commissionBps: parsePercent(s.commission) as number,
  };
}

/** Whether Continue is allowed on this step. */
export function canContinue(s: FormState, running: Running): boolean {
  if (s.step === "category") {
    const p = productOf(s.upc);
    return !!p && p.category === s.category && !running.has(p.brandId);
  }
  if (s.step === "terms") return termsOf(s) !== null;
  return false;
}

export function reduce(s: FormState, a: Action, running: Running): FormState {
  switch (a.type) {
    case "category": {
      const c = categoryOf(a.category);
      if (!c) return s;
      const first = freeProducts(c, running)[0];
      return { ...s, category: a.category, upc: first ? first.upc : null };
    }
    case "currency":
      return { ...s, currency: a.currency };
    case "product":
      return productOf(a.upc)?.category === s.category &&
        !running.has(productOf(a.upc)?.brandId ?? "")
        ? { ...s, upc: a.upc }
        : s;
    case "deposit":
      return { ...s, deposit: a.value };
    case "commission":
      return { ...s, commission: a.value };
    case "next":
      if (!canContinue(s, running)) return s;
      return { ...s, step: s.step === "category" ? "terms" : "review" };
    case "back":
      return s.step === "review"
        ? { ...s, step: "terms" }
        : s.step === "terms"
          ? { ...s, step: "category" }
          : s;
    case "done":
      return { ...s, step: "done" };
    case "reset":
      return initialForm(running);
  }
}

/** The lowest price any seller lists for a product, in cents: the sale the example uses. */
export function lowestPriceMinor(upc: string): number | null {
  const prices = [
    ...Object.values(DEMO_SHOP_PRICES),
    ...Object.values(VACUUM_SHOP_PRICES),
    ...Object.values(HEADPHONE_SHOP_PRICES),
  ]
    .map((shop) => (shop as Record<string, number>)[upc])
    .filter((x): x is number => typeof x === "number");
  return prices.length ? Math.min(...prices) : null;
}

/**
 * One example: what creators earn on a single sale their test caused. In dollars it uses the
 * catalogue's lowest listed price. The catalogue lists dollar prices only, and nothing is
 * converted, so in pounds or euros it is a round 100.00 sale.
 */
export function exampleLine(
  upc: string | null,
  commissionBps: number,
  currency: ProgrammeCurrency = "USD",
): string | null {
  if (currency !== "USD") {
    const pay = commissionOn({ amountMinor: EXAMPLE_SALE_MINOR, currency }, commissionBps);
    return `A ${fmt(EXAMPLE_SALE_MINOR, currency)} sale that a creator's test caused pays creators ${fmt(pay.amountMinor, currency)}.`;
  }
  const price = upc ? lowestPriceMinor(upc) : null;
  if (price === null) return null;
  const pay = commissionOn({ amountMinor: price, currency: "USD" }, commissionBps);
  return `A sale at ${fmt(price)} that a creator's test caused pays creators ${fmt(pay.amountMinor)}.`;
}

/** Plain promises shown before the brand confirms. The first three are the programme's rules. */
export const PROMISES = [
  "You fund the category, never a verdict: money cannot buy rank or change what a test found.",
  "You pay only for sales a creator's test caused, counted at the 80% lower bound.",
  "Unspent money comes back to you through a PayPal refund.",
] as const;

export interface Review {
  heading: string;
  rows: { label: string; value: string }[];
  promises: readonly string[];
}

export function reviewOf(s: FormState): Review | null {
  const p = productOf(s.upc);
  const t = termsOf(s);
  const c = categoryOf(s.category);
  if (!p || !t || !c) return null;
  return {
    heading: `${p.brand} ${p.product} programme`,
    rows: [
      { label: "Category", value: c.label },
      { label: "Product", value: `${p.brand} ${p.product}` },
      ...(s.currency === "USD"
        ? []
        : [{ label: "Currency", value: `${CURRENCY_NAME[s.currency]} (${s.currency})` }]),
      { label: "Deposit", value: fmt(t.depositMinor, s.currency) },
      { label: "Commission rate", value: pctText(t.commissionBps) },
    ],
    promises: PROMISES,
  };
}

/** What the request to create the programme carries: integers only. */
export function requestOf(s: FormState): {
  category: string;
  upc: string;
  depositMinor: number;
  commissionBps: number;
  /** Only named when it is not dollars: the engine's default. */
  currency?: ProgrammeCurrency;
} | null {
  const p = productOf(s.upc);
  const t = termsOf(s);
  if (!p || !t || p.category !== s.category) return null;
  return {
    category: p.category,
    upc: p.upc,
    ...t,
    ...(s.currency === "USD" ? {} : { currency: s.currency }),
  };
}

/** What a brand reads after confirming. Honest about the hosted demo: it never reaches PayPal. */
export function outcomeMessage(r: {
  private?: boolean | undefined;
  resetsAt?: string | undefined;
  depositMinor: number;
  brand: string;
  currency?: ProgrammeCurrency | undefined;
}): string {
  const usd = (minor: number) => fmt(minor, r.currency ?? "USD");
  if (r.private) {
    const at = r.resetsAt
      ? new Date(r.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
    return `Demo mode: ${r.brand}'s ${usd(r.depositMinor)} programme is started in this browser only. No PayPal order was made and the shared ledger did not change${at ? `; it resets at ${at}` : ""}.`;
  }
  return `${r.brand}'s programme is started: ${usd(r.depositMinor)} deposit captured through PayPal. Unspent money comes back through a refund.`;
}

export const DEMO_NOTE =
  "This hosted demo keeps writes locked. Confirming starts the programme in your browser only: no PayPal order is made and the shared ledger does not change. Run the stack locally to capture a real deposit.";
