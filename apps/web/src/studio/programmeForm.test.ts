import { describe, expect, it } from "vitest";
import {
  canContinue,
  exampleLine,
  type FormState,
  firstOpenCategory,
  initialForm,
  outcomeMessage,
  PROMISES,
  parseDollars,
  parsePercent,
  reduce,
  requestOf,
  reviewOf,
  termsOf,
  termsProblems,
} from "./programmeForm";

const DEMO = new Set(["winix", "levoit"]); // the purifier programme that already runs
const none = new Set<string>();
const run = (s: FormState, running: Set<string>, ...actions: Parameters<typeof reduce>[1][]) =>
  actions.reduce((acc, a) => reduce(acc, a, running), s);

describe("typed amounts become integers without floats", () => {
  it("reads dollars to cents", () => {
    expect(parseDollars("500")).toBe(50_000);
    expect(parseDollars("$1,250.50")).toBe(125_050);
    expect(parseDollars("19.9")).toBe(1_990);
    expect(parseDollars("0.07")).toBe(7);
    expect(parseDollars("1.005")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("five")).toBeNull();
    expect(parseDollars("")).toBeNull();
  });
  it("reads a percentage to basis points", () => {
    expect(parsePercent("8")).toBe(800);
    expect(parsePercent("12.5%")).toBe(1_250);
    expect(parsePercent("0.75")).toBe(75);
    expect(parsePercent("8.123")).toBeNull();
    expect(parsePercent("abc")).toBeNull();
  });
});

describe("terms", () => {
  it("accepts the limits and refuses outside them, with plain words", () => {
    expect(termsOf({ deposit: "500", commission: "8" })).toEqual({
      depositMinor: 50_000,
      commissionBps: 800,
    });
    expect(termsOf({ deposit: "100", commission: "1" })).not.toBeNull();
    expect(termsOf({ deposit: "10,000", commission: "20" })).not.toBeNull();
    expect(termsProblems({ deposit: "99", commission: "8" }).deposit).toMatch(/between \$100\.00/);
    expect(termsProblems({ deposit: "10000.01", commission: "8" }).deposit).toMatch(/between/);
    expect(termsProblems({ deposit: "500", commission: "21" }).commission).toMatch(/between 1%/);
    expect(termsProblems({ deposit: "500", commission: "8" })).toEqual({
      deposit: null,
      commission: null,
    });
  });
});

describe("the flow", () => {
  it("starts on the first category that still has a product to fund", () => {
    expect(firstOpenCategory(none)).toBe("purifier");
    expect(firstOpenCategory(DEMO)).toBe("robot-vacuum");
    const s = initialForm(DEMO);
    expect(s).toMatchObject({ step: "category", category: "robot-vacuum", upc: "100000000006" });
    expect(s.deposit).toBe("500");
    expect(s.commission).toBe("8");
  });

  it("will not pick a product that already has a programme", () => {
    const s = initialForm(none);
    expect(run(s, DEMO, { type: "product", upc: "100000000001" }).upc).toBe(s.upc);
    // Switching to a category whose products are all taken leaves nothing to continue with.
    const onPurifiers = run(initialForm(DEMO), DEMO, { type: "category", category: "purifier" });
    expect(onPurifiers.upc).toBeNull();
    expect(canContinue(onPurifiers, DEMO)).toBe(false);
  });

  it("moves category, terms, review, and only forward when the step is valid", () => {
    let s = initialForm(DEMO);
    expect(canContinue(s, DEMO)).toBe(true);
    s = run(s, DEMO, { type: "next" });
    expect(s.step).toBe("terms");
    s = run(s, DEMO, { type: "deposit", value: "abc" });
    expect(canContinue(s, DEMO)).toBe(false);
    expect(run(s, DEMO, { type: "next" }).step).toBe("terms");
    s = run(
      s,
      DEMO,
      { type: "deposit", value: "750" },
      { type: "commission", value: "12" },
      { type: "next" },
    );
    expect(s.step).toBe("review");
    expect(run(s, DEMO, { type: "back" }).step).toBe("terms");
    expect(run(s, DEMO, { type: "next" }).step).toBe("review");
  });

  it("builds the request from integers and nothing else", () => {
    const s = run(
      initialForm(DEMO),
      DEMO,
      { type: "deposit", value: "$1,250.50" },
      { type: "commission", value: "12.5" },
    );
    expect(requestOf(s)).toEqual({
      category: "robot-vacuum",
      upc: "100000000006",
      depositMinor: 125_050,
      commissionBps: 1_250,
    });
    expect(requestOf(run(s, DEMO, { type: "deposit", value: "1" }))).toBeNull();
  });

  it("resets to a fresh form", () => {
    const s = run(initialForm(DEMO), DEMO, { type: "deposit", value: "900" }, { type: "done" });
    expect(run(s, DEMO, { type: "reset" })).toEqual(initialForm(DEMO));
  });
});

describe("the words before confirming", () => {
  const s = run(initialForm(DEMO), DEMO, { type: "commission", value: "12" });
  it("states the three promises plainly", () => {
    expect(PROMISES.join(" ")).toMatch(/fund the category, never a verdict/);
    expect(PROMISES.join(" ")).toMatch(/only for sales a creator's test caused.*80% lower bound/);
    expect(PROMISES.join(" ")).toMatch(/PayPal refund/);
    const r = reviewOf(s);
    expect(r?.promises).toEqual(PROMISES);
    expect(r?.rows).toEqual([
      { label: "Category", value: "Robot vacuums" },
      { label: "Product", value: "Roborock Q7 Max" },
      { label: "Deposit", value: "$500.00" },
      { label: "Commission rate", value: "12%" },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/\barm\b/i);
  });
  it("gives a worked example from the catalogue's lowest price", () => {
    // $295.99 at Lumen, 12% rounded down to the cent: $35.51.
    expect(exampleLine("100000000006", 1_200)).toBe(
      "A sale at $295.99 that a creator's test caused pays creators $35.51.",
    );
    expect(exampleLine(null, 800)).toBeNull();
  });
  it("is honest that the hosted demo makes no PayPal order", () => {
    const priv = outcomeMessage({ private: true, depositMinor: 50_000, brand: "Roborock" });
    expect(priv).toMatch(/^Demo mode/);
    expect(priv).toMatch(/No PayPal order was made/);
    const real = outcomeMessage({ depositMinor: 50_000, brand: "Roborock" });
    expect(real).toMatch(/\$500\.00 deposit captured through PayPal/);
  });
});

describe("a programme in pounds or euros", () => {
  const gbp = (deposit = "500") =>
    run(
      initialForm(DEMO),
      DEMO,
      { type: "currency", currency: "GBP" },
      { type: "deposit", value: deposit },
    );
  it("starts in dollars, as it always did", () => {
    expect(initialForm(DEMO).currency).toBe("USD");
  });
  it("reads the currency symbol and states the limits in that currency", () => {
    expect(parseDollars("£1,250.50")).toBe(125_050);
    expect(parseDollars("€500")).toBe(50_000);
    expect(termsProblems({ deposit: "99", commission: "8", currency: "GBP" }).deposit).toMatch(
      /between £100\.00 and £10,000\.00/,
    );
    expect(termsProblems({ deposit: "x", commission: "8", currency: "EUR" }).deposit).toMatch(
      /in euros/,
    );
  });
  it("names the currency in the request only when it is not dollars", () => {
    expect(requestOf(gbp("750"))).toEqual({
      category: "robot-vacuum",
      upc: "100000000006",
      depositMinor: 75_000,
      commissionBps: 800,
      currency: "GBP",
    });
    expect(requestOf(run(gbp(), DEMO, { type: "currency", currency: "USD" }))).not.toHaveProperty(
      "currency",
    );
  });
  it("shows the deposit in the programme's own currency, with a Currency row", () => {
    expect(reviewOf(gbp())?.rows).toEqual([
      { label: "Category", value: "Robot vacuums" },
      { label: "Product", value: "Roborock Q7 Max" },
      { label: "Currency", value: "British pounds (GBP)" },
      { label: "Deposit", value: "£500.00" },
      { label: "Commission rate", value: "8%" },
    ]);
  });
  it("gives a round example and no converted price", () => {
    expect(exampleLine("100000000006", 1_200, "GBP")).toBe(
      "A £100.00 sale that a creator's test caused pays creators £12.00.",
    );
    expect(exampleLine("100000000006", 800, "EUR")).toBe(
      "A €100.00 sale that a creator's test caused pays creators €8.00.",
    );
  });
  it("says the deposit was captured in pounds", () => {
    expect(outcomeMessage({ depositMinor: 50_000, brand: "Roborock", currency: "GBP" })).toMatch(
      /£500\.00 deposit captured through PayPal/,
    );
    expect(
      outcomeMessage({ private: true, depositMinor: 50_000, brand: "Roborock", currency: "EUR" }),
    ).toMatch(/€500\.00 programme is started in this browser only/);
  });
});
