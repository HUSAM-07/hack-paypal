import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  formatMoney,
  minorToDecimalString,
  moneyToInput,
  parseMajorToMinor,
  percentOff,
} from "../src/money";

describe("money", () => {
  it("uses the currency's minor-unit exponent", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("BHD")).toBe(3);
  });

  it("formats from integer minor units without float drift", () => {
    expect(formatMoney({ amountMinor: 29999, currency: "USD" }, { locale: "en-US" })).toBe(
      "$299.99",
    );
    expect(formatMoney({ amountMinor: 10, currency: "USD" }, { locale: "en-US" })).toBe("$0.10");
    expect(formatMoney({ amountMinor: 1500, currency: "JPY" }, { locale: "en-US" })).toBe("¥1,500");
    expect(formatMoney({ amountMinor: 1234, currency: "BHD" }, { locale: "en-US" })).toMatch(
      /^BHD\s1\.234$/,
    );
    // 0.1 + 0.2 style amounts stay exact
    expect(formatMoney({ amountMinor: 30, currency: "USD" }, { locale: "en-US" })).toBe("$0.30");
    expect(
      formatMoney({ amountMinor: 900719925474099, currency: "USD" }, { locale: "en-US" }),
    ).toBe("$9,007,199,254,740.99");
  });

  it("trims zero cents only when asked and only when they are zero", () => {
    expect(
      formatMoney(
        { amountMinor: 27900, currency: "USD" },
        { locale: "en-US", trimZeroCents: true },
      ),
    ).toBe("$279");
    expect(
      formatMoney(
        { amountMinor: 27950, currency: "USD" },
        { locale: "en-US", trimZeroCents: true },
      ),
    ).toBe("$279.50");
  });

  it("builds exact decimal strings", () => {
    expect(minorToDecimalString(5, 2)).toBe("0.05");
    expect(minorToDecimalString(-5, 2)).toBe("-0.05");
    expect(minorToDecimalString(123456, 3)).toBe("123.456");
    expect(minorToDecimalString(42, 0)).toBe("42");
  });

  it("parses typed amounts into minor units with string arithmetic", () => {
    expect(parseMajorToMinor("279", "USD")).toBe(27900);
    expect(parseMajorToMinor("279.9", "USD")).toBe(27990);
    expect(parseMajorToMinor("1,279.99", "USD")).toBe(127999);
    expect(parseMajorToMinor("0.29", "USD")).toBe(29);
    expect(parseMajorToMinor("279.999", "USD")).toBeUndefined();
    expect(parseMajorToMinor("12.5", "JPY")).toBeUndefined();
    expect(parseMajorToMinor("-3", "USD")).toBeUndefined();
    expect(parseMajorToMinor("abc", "USD")).toBeUndefined();
    expect(moneyToInput({ amountMinor: 27900, currency: "USD" })).toBe("279");
    expect(moneyToInput({ amountMinor: 27950, currency: "USD" })).toBe("279.50");
  });

  it("computes whole-percent discounts", () => {
    expect(
      percentOff({ amountMinor: 29999, currency: "USD" }, { amountMinor: 39999, currency: "USD" }),
    ).toBe(25);
    expect(
      percentOff({ amountMinor: 100, currency: "USD" }, { amountMinor: 100, currency: "USD" }),
    ).toBeUndefined();
    expect(
      percentOff({ amountMinor: 1, currency: "USD" }, { amountMinor: 2, currency: "EUR" }),
    ).toBeUndefined();
  });
});
