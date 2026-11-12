import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Offer } from "../src/contract";
import {
  checkPurchase,
  ledgerEntry,
  mandateForApprovedPurchase,
  mandateForRule,
} from "../src/mandate";
import type { Quote } from "../src/sellers";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const NOW = new Date("2026-11-01T10:00:00.000Z");

const offer = (buyable = true): Offer => ({
  id: "pp_sony_xm6",
  title: "XM6",
  url: "https://northwind-audio.example/p/sony_xm6",
  merchant: {
    name: "Northwind",
    domain: "northwind-audio.example",
    ...(buyable ? { paypalSellerId: "SELLERAUDIO01" } : {}),
  },
  price: usd(25_999),
  highlights: [],
  buyable,
  source: buyable ? "paypalSeller" : "exa",
  seenAt: NOW.toISOString(),
});

const quote = (unit: number, quantity = 1, shipping = 0, tax = 0, inStock = true): Quote => ({
  offerId: "pp_sony_xm6",
  quantity,
  unit: usd(unit),
  shipping: usd(shipping),
  tax: usd(tax),
  total: usd(unit * quantity + shipping + tax),
  inStock,
});

const terms = {
  maxUnitPrice: usd(26_000),
  maxTotal: usd(30_000),
  quantity: 1,
  expiresAt: "2026-12-01T00:00:00.000Z",
};

const run = (q: Quote, over: Partial<Parameters<typeof checkPurchase>[0]> = {}) =>
  checkPurchase({
    intentId: "i1",
    userId: "user_1",
    offer: offer(),
    quote: q,
    mandate: mandateForRule({
      id: "man_1",
      userId: "user_1",
      offer: offer(),
      rule: terms,
      now: NOW,
    }),
    rule: terms,
    ledger: [],
    now: NOW,
    initiatedBy: "schedule",
    ...over,
  });

describe("auto-buy rule → mandate", () => {
  it("is a one-charge, seller-scoped, expiring mandate capped at the total", () => {
    expect(
      mandateForRule({ id: "man_1", userId: "user_1", offer: offer(), rule: terms, now: NOW }),
    ).toMatchObject({
      maxPerCharge: usd(30_000),
      maxTotal: usd(30_000),
      maxCharges: 1,
      merchantAllow: ["SELLERAUDIO01"],
      validUntil: terms.expiresAt,
      status: "active",
    });
    expect(() =>
      mandateForRule({ id: "m", userId: "u", offer: offer(false), rule: terms, now: NOW }),
    ).toThrow();
    expect(() =>
      mandateForApprovedPurchase({
        id: "m",
        userId: "u",
        offer: offer(false),
        total: usd(1),
        now: NOW,
      }),
    ).toThrow();
  });
});

describe("checkPurchase", () => {
  it("allows a purchase inside every limit (unattended)", () => {
    expect(run(quote(25_999, 1, 0, 2_145))).toEqual({ ok: true, mandateId: "man_1" });
  });

  it("counts shipping and tax against the total cap", () => {
    const r = run(quote(25_999, 1, 999, 3_100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain("over_total");
  });

  it.each([
    ["over_unit_price", quote(26_001)],
    ["over_quantity", quote(10_000, 2)],
    ["out_of_stock", quote(20_000, 1, 0, 0, false)],
  ] as const)("denies %s", (reason, q) => {
    const r = run(q);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain(reason);
  });

  it("denies non-PayPal sellers, expired rules, a missing mandate, and a second charge", () => {
    const deny = (r: ReturnType<typeof run>) => (r.ok ? [] : r.reasons);
    expect(deny(run(quote(20_000), { offer: offer(false) }))).toContain("seller_not_paypal");
    expect(deny(run(quote(20_000), { now: new Date("2026-12-02T00:00:00.000Z") }))).toContain(
      "mandate_expired",
    );
    expect(deny(run(quote(20_000), { mandate: undefined }))).toContain("no_mandate");
    expect(
      deny(run(quote(20_000), { ledger: [ledgerEntry("man_1", usd(20_000), NOW)] })),
    ).toContain("over_charge_count");
  });

  it("allow implies every limit held (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60_000 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 0, max: 3_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.boolean(),
        (unit, qty, ship, tax, inStock) => {
          const q = quote(unit, qty, ship, tax, inStock);
          const r = run(q);
          if (r.ok) {
            expect(q.unit.amountMinor).toBeLessThanOrEqual(terms.maxUnitPrice.amountMinor);
            expect(q.total.amountMinor).toBeLessThanOrEqual(terms.maxTotal.amountMinor);
            expect(q.quantity).toBeLessThanOrEqual(terms.quantity);
            expect(q.inStock).toBe(true);
          }
        },
      ),
    );
  });

  it("an approved one-off purchase caps at the total the user saw", () => {
    const mandate = mandateForApprovedPurchase({
      id: "man_2",
      userId: "user_1",
      offer: offer(),
      total: usd(28_144),
      now: NOW,
    });
    expect(
      run(quote(25_999, 1, 0, 2_145), { mandate, rule: undefined, initiatedBy: "user" }),
    ).toEqual({ ok: true, mandateId: "man_2" });
    const pricier = run(quote(26_999, 1, 0, 2_227), {
      mandate,
      rule: undefined,
      initiatedBy: "user",
    });
    expect(pricier.ok).toBe(false);
  });
});
