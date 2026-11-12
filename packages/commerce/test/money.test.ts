import { toPayPalValue } from "@pact/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyBps,
  detectCurrency,
  findPriceInText,
  parseDecimalMinor,
  parsePrice,
} from "../src/money";

const group = (n: bigint | number, sep: string) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);

describe("parseDecimalMinor", () => {
  it.each([
    ["1,299.99", 129_999],
    ["1.299,99", 129_999],
    ["1 299,99", 129_999],
    ["1 299,99", 129_999],
    ["1299", 129_900],
    ["1,299", 129_900],
    ["279.5", 27_950],
    ["279,5", 27_950],
    [".99", 99],
    ["$399.99", 39_999],
    ["19.9951", 2_000],
    ["0", 0],
  ])("%s → %d (USD)", (raw, minor) => {
    expect(parseDecimalMinor(raw, "USD")).toBe(minor);
  });

  it.each(["", "abc", "-5.00", "1,2,3.4.5", "1.2.3", "12,34,567.00", "1e5"])(
    "rejects %s",
    (raw) => {
      expect(parseDecimalMinor(raw, "USD")).toBeUndefined();
    },
  );

  it("schema.org prices always use '.' as the decimal point", () => {
    expect(parseDecimalMinor("19.990", "USD", { schemaOrg: true })).toBe(1_999);
    expect(parseDecimalMinor("19.995", "USD", { schemaOrg: true })).toBe(2_000);
    // Loose text: one separator + three digits groups, as in "1.299" (EU thousands).
    expect(parseDecimalMinor("19.995", "USD")).toBe(1_999_500);
    expect(parseDecimalMinor("1.299", "USD", { schemaOrg: true })).toBe(130);
    expect(parseDecimalMinor("1,299.00", "USD", { schemaOrg: true })).toBeUndefined();
  });

  it("JSON numbers never go through float arithmetic", () => {
    expect(parseDecimalMinor(279.99, "USD")).toBe(27_999);
    expect(parseDecimalMinor(0.1 + 0.2, "USD")).toBe(30);
    expect(parseDecimalMinor(Number.NaN, "USD")).toBeUndefined();
  });

  it("zero-decimal currencies treat separators as grouping", () => {
    expect(parseDecimalMinor("1,500", "JPY")).toBe(1_500);
    expect(parseDecimalMinor("¥12,000", "JPY")).toBe(12_000);
  });

  it("round-trips any amount written the usual ways (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999_999 }), (minor) => {
        const whole = Math.floor(minor / 100);
        const cents = String(minor % 100).padStart(2, "0");
        expect(parseDecimalMinor(`${whole}.${cents}`, "USD")).toBe(minor);
        expect(parseDecimalMinor(`${group(whole, ",")}.${cents}`, "USD")).toBe(minor);
        expect(parseDecimalMinor(`${group(whole, ".")},${cents}`, "EUR")).toBe(minor);
        expect(
          parseDecimalMinor(toPayPalValue({ amountMinor: minor, currency: "USD" }), "USD", {
            schemaOrg: true,
          }),
        ).toBe(minor);
      }),
    );
  });

  it("always yields a safe non-negative integer or nothing (property)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), (s) => {
        const r = parseDecimalMinor(s, "USD");
        if (r !== undefined) {
          expect(Number.isSafeInteger(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});

describe("parsePrice / detectCurrency / findPriceInText", () => {
  it("reads the currency from the text, else the fallback", () => {
    expect(parsePrice("€19,99")).toEqual({ amountMinor: 1_999, currency: "EUR" });
    expect(parsePrice("£5")).toEqual({ amountMinor: 500, currency: "GBP" });
    expect(parsePrice("CHF 20.00")).toEqual({ amountMinor: 2_000, currency: "CHF" });
    expect(parsePrice("12.50", "usd")).toEqual({ amountMinor: 1_250, currency: "USD" });
    expect(parsePrice("12.50")).toBeUndefined();
    expect(detectCurrency("US$ 10")).toBe("USD");
  });

  it("finds the first marked amount in page text", () => {
    expect(findPriceInText("Was $1,499.00 now on sale")).toEqual({
      amountMinor: 149_900,
      currency: "USD",
    });
    expect(findPriceInText("Ships in 2 days. Price: $279.99 (incl. VAT)")).toEqual({
      amountMinor: 27_999,
      currency: "USD",
    });
    expect(findPriceInText("Prix 1.299,99 € TTC")).toEqual({
      amountMinor: 129_999,
      currency: "EUR",
    });
    expect(findPriceInText("Out of stock in 3 stores")).toBeUndefined();
  });

  it("applyBps rounds half up in integers", () => {
    expect(applyBps(25_999, 825)).toBe(2_145);
    expect(applyBps(100, 50)).toBe(1);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 10_000 }), (a, b) => {
        const r = applyBps(a, b);
        expect(Number.isInteger(r)).toBe(true);
        expect(Math.abs(r * 10_000 - a * b)).toBeLessThanOrEqual(5_000);
      }),
    );
  });
});
