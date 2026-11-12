import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addMoney,
  currencySymbol,
  formatCurrency,
  fromPayPalValue,
  Item,
  isProgrammeCurrency,
  minorUnits,
  PAYPAL_CURRENCIES,
  PROGRAMME_CURRENCIES,
  toPayPalValue,
} from "./index";

describe("money", () => {
  it("formats PayPal values", () => {
    expect(toPayPalValue({ amountMinor: 1250, currency: "USD" })).toBe("12.50");
    expect(toPayPalValue({ amountMinor: 5, currency: "USD" })).toBe("0.05");
    expect(toPayPalValue({ amountMinor: 500, currency: "JPY" })).toBe("500");
  });

  it("round-trips through PayPal strings", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_00 }), (amountMinor) => {
        const m = { amountMinor, currency: "USD" };
        expect(fromPayPalValue(toPayPalValue(m), "USD")).toEqual(m);
      }),
    );
  });

  it("rejects malformed amounts", () => {
    expect(() => fromPayPalValue("1.234", "USD")).toThrow();
    expect(() => fromPayPalValue("-5", "USD")).toThrow();
  });
});

describe("items", () => {
  it("parses an approval request and rejects unknown types", () => {
    const base = {
      id: "i",
      threadId: "t",
      turnId: "r",
      status: "inProgress",
      createdAt: "2026-11-01T00:00:00Z",
    };
    expect(
      Item.parse({
        ...base,
        type: "approvalRequest",
        approvalId: "a",
        approverId: "u",
        kind: "spend",
        summary: "Buy PS6 share",
        amount: { amountMinor: 15_000, currency: "USD" },
        stepUp: true,
        expiresAt: "2026-11-02T00:00:00Z",
      }).type,
    ).toBe("approvalRequest");
    expect(() => Item.parse({ ...base, type: "evil" })).toThrow();
  });
});

describe("money in pounds and euros", () => {
  it("is cents or pence on the wire: two decimals, exactly", () => {
    for (const currency of ["GBP", "EUR"]) {
      expect(toPayPalValue({ amountMinor: 50, currency })).toBe("0.50");
      expect(toPayPalValue({ amountMinor: 123_456, currency })).toBe("1234.56");
      expect(fromPayPalValue("1234.56", currency)).toEqual({ amountMinor: 123_456, currency });
      expect(fromPayPalValue("0.5", currency)).toEqual({ amountMinor: 50, currency });
      expect(() => fromPayPalValue("1.005", currency)).toThrow();
    }
  });
  it("refuses a decimal point in the zero-decimal currencies", () => {
    expect(fromPayPalValue("500", "JPY")).toEqual({ amountMinor: 500, currency: "JPY" });
    expect(() => fromPayPalValue("500.00", "JPY")).toThrow();
  });
  it("knows PayPal's currencies and the three a programme can run in", () => {
    for (const c of PROGRAMME_CURRENCIES) expect(PAYPAL_CURRENCIES.has(c)).toBe(true);
    expect(PROGRAMME_CURRENCIES).toEqual(["USD", "GBP", "EUR"]);
    expect(isProgrammeCurrency("GBP")).toBe(true);
    expect(isProgrammeCurrency("CHF")).toBe(false);
    expect(isProgrammeCurrency("gbp")).toBe(false);
    expect(PAYPAL_CURRENCIES.has("XYZ")).toBe(false);
  });
  it("formats with the amount's own symbol and never converts", () => {
    expect(formatCurrency(50_000, "USD")).toBe("$500.00");
    expect(formatCurrency(50_000, "GBP")).toBe("£500.00");
    expect(formatCurrency(123_456, "EUR")).toBe("€1,234.56");
    expect(formatCurrency(10_000, "GBP", { cents: false })).toBe("£100");
    expect(formatCurrency(1_000_000, "EUR", { cents: false })).toBe("€10,000");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("CHF")).toBe("CHF ");
    expect(minorUnits("EUR")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
  });
  it("adds only money in the same currency", () => {
    expect(() =>
      addMoney({ amountMinor: 1, currency: "GBP" }, { amountMinor: 1, currency: "EUR" }),
    ).toThrow(/currency mismatch/);
  });
});
