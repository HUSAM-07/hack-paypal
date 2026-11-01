import { describe, expect, it } from "vitest";
import { formatMoney, parseMajor } from "./money";

describe("money formatting", () => {
  it("formats minor units without float drift", () => {
    expect(formatMoney({ amountMinor: 14_634, currency: "USD" })).toBe("$146.34");
    expect(formatMoney({ amountMinor: 45_000, currency: "USD" }, { compact: true })).toBe("$450");
    expect(formatMoney({ amountMinor: 500, currency: "JPY" })).toMatch(/500/);
  });

  it("parses typed amounts to integers or rejects them", () => {
    expect(parseMajor("12.5", "USD")).toEqual({ amountMinor: 1250, currency: "USD" });
    expect(parseMajor("1,200.00", "USD")).toEqual({ amountMinor: 120_000, currency: "USD" });
    expect(parseMajor("0.1", "USD")?.amountMinor).toBe(10);
    expect(parseMajor("1.234", "USD")).toBeNull();
    expect(parseMajor("-5", "USD")).toBeNull();
    expect(parseMajor("12.5", "JPY")).toBeNull();
  });
});
