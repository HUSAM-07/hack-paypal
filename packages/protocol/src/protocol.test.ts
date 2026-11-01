import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromPayPalValue, Item, toPayPalValue } from "./index";

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
