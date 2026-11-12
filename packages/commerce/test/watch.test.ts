import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Offer, PriceCheck, Watch } from "../src/contract";
import {
  appendHistory,
  evaluateWatch,
  HISTORY_CAP,
  type HistoryPoint,
  isSuspiciouslyLow,
  nextCheckAt,
  trailingMedian,
} from "../src/watch";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const AT = "2026-11-01T10:00:00.000Z";

const offer = (buyable = true): Offer => ({
  id: "pp_sony_xm6",
  title: "XM6",
  url: "https://northwind-audio.example/p/sony_xm6",
  merchant: {
    name: "Northwind",
    domain: "northwind-audio.example",
    ...(buyable ? { paypalSellerId: "SELLERAUDIO01" } : {}),
  },
  price: usd(39_999),
  highlights: [],
  buyable,
  source: buyable ? "paypalSeller" : "exa",
  seenAt: AT,
});

function watch(over: Partial<Watch> = {}): Watch {
  return {
    id: "wat_1",
    offer: offer(),
    targetPrice: usd(28_000),
    status: "active",
    everyMinutes: 60,
    history: [],
    createdAt: AT,
    ...over,
  };
}

const rule = (over: Partial<NonNullable<Watch["autoBuy"]>> = {}) => ({
  maxUnitPrice: usd(26_000),
  maxTotal: usd(30_000),
  quantity: 1,
  expiresAt: "2026-12-01T00:00:00.000Z",
  mandateId: "man_1",
  ...over,
});

const check = (amountMinor: number, over: Partial<PriceCheck> = {}): PriceCheck => ({
  url: "https://northwind-audio.example/p/sony_xm6",
  price: usd(amountMinor),
  method: "paypalCatalogue",
  checkedAt: AT,
  inStock: true,
  ...over,
});

const flat = (n: number, amountMinor: number): HistoryPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    at: `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
    amountMinor,
  }));

describe("evaluateWatch", () => {
  it("does nothing above target, notifies at target, auto-buys within the rule", () => {
    expect(evaluateWatch(watch(), check(30_000))).toEqual({ kind: "none", reason: "aboveTarget" });
    expect(evaluateWatch(watch(), check(28_000))).toEqual({ kind: "notify" });
    expect(evaluateWatch(watch({ autoBuy: rule() }), check(25_999))).toEqual({ kind: "autoBuy" });
    // Under target but over the rule's unit price: notify only.
    expect(evaluateWatch(watch({ autoBuy: rule() }), check(27_000))).toEqual({ kind: "notify" });
  });

  it("never auto-buys without an approved mandate, a PayPal seller, or after expiry", () => {
    expect(
      evaluateWatch(watch({ autoBuy: rule({ mandateId: undefined }) }), check(20_000)).kind,
    ).toBe("notify");
    expect(evaluateWatch(watch({ autoBuy: rule(), offer: offer(false) }), check(20_000)).kind).toBe(
      "notify",
    );
    expect(evaluateWatch(watch({ autoBuy: rule({ expiresAt: AT }) }), check(20_000)).kind).toBe(
      "notify",
    );
  });

  it("pauses for review on anomalies", () => {
    expect(
      evaluateWatch(watch(), check(20_000, { price: { amountMinor: 20_000, currency: "EUR" } }))
        .kind,
    ).toBe("needsReview");
    expect(
      evaluateWatch(
        watch({ lastCheck: check(39_999, { variant: "Black" }) }),
        check(39_999, { variant: "Refurbished" }),
      ).kind,
    ).toBe("needsReview");
    expect(evaluateWatch(watch({ autoBuy: rule() }), check(15_000), flat(5, 39_999)).kind).toBe(
      "needsReview",
    );
    expect(evaluateWatch(watch({ autoBuy: rule() }), check(25_000, { inStock: false })).kind).toBe(
      "needsReview",
    );
    // Out of stock above target is just "not yet".
    expect(evaluateWatch(watch(), check(35_000, { inStock: false })).kind).toBe("none");
  });

  it("is inert for any non-active watch (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "paused",
          "triggered",
          "needsReview",
          "completed",
          "cancelled",
          "expired" as const,
        ),
        fc.integer({ min: 0, max: 1_000_000 }),
        (status, price) => {
          expect(evaluateWatch(watch({ status, autoBuy: rule() }), check(price))).toEqual({
            kind: "none",
            reason: "inactive",
          });
        },
      ),
    );
  });

  it("auto-buy only when every limit holds (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.boolean(),
        fc.boolean(),
        fc.option(fc.boolean(), { nil: undefined }),
        fc.array(fc.integer({ min: 1, max: 100_000 }), { maxLength: 30 }),
        (price, target, maxUnit, buyable, hasMandate, inStock, hist) => {
          const w = watch({
            targetPrice: usd(target),
            offer: offer(buyable),
            autoBuy: rule({
              maxUnitPrice: usd(maxUnit),
              mandateId: hasMandate ? "man_1" : undefined,
            }),
          });
          const history = hist.map((amountMinor, i) => ({
            at: new Date(Date.parse(AT) - (i + 1) * 3_600_000).toISOString(),
            amountMinor,
          }));
          const d = evaluateWatch(
            w,
            check(price, inStock === undefined ? {} : { inStock }),
            history,
          );
          if (d.kind === "autoBuy") {
            expect(price).toBeLessThanOrEqual(target);
            expect(price).toBeLessThanOrEqual(maxUnit);
            expect(buyable && hasMandate).toBe(true);
            expect(inStock).not.toBe(false);
            expect(isSuspiciouslyLow(price, trailingMedian(history))).toBe(false);
          }
          if (d.kind === "notify") expect(price).toBeLessThanOrEqual(target);
          if (price > target) expect(d.kind).toBe("none");
        },
      ),
    );
  });

  it("flags any hit under 40% of the trailing median (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 100_000 }),
        fc.integer({ min: 3, max: 25 }),
        (median, n) => {
          const low = Math.floor((median * 4) / 10) - 1;
          const d = evaluateWatch(
            watch({ targetPrice: usd(median), autoBuy: rule({ maxUnitPrice: usd(median) }) }),
            check(low),
            flat(n, median),
          );
          expect(d.kind).toBe("needsReview");
        },
      ),
    );
  });
});

describe("trailingMedian", () => {
  it("needs three points and uses the lower median", () => {
    expect(trailingMedian(flat(2, 100))).toBeUndefined();
    expect(trailingMedian([...flat(2, 100), { at: AT, amountMinor: 300 }])).toBe(100);
    expect(
      trailingMedian([10, 20, 30, 40].map((amountMinor, i) => ({ at: `${i}`, amountMinor }))),
    ).toBe(20);
  });
});

describe("nextCheckAt", () => {
  it("stays within ±10% of the (backed-off, capped) interval (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 1_440 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        (every, failures, offsetMin, id) => {
          const now = new Date(Date.parse(AT) + offsetMin * 60_000);
          const next = Date.parse(nextCheckAt({ id, everyMinutes: every }, now, failures));
          const base = Math.min(every * 2 ** Math.min(failures, 10), 1_440) * 60_000;
          expect(next - now.getTime()).toBeGreaterThanOrEqual(Math.floor(base * 0.9));
          expect(next - now.getTime()).toBeLessThanOrEqual(Math.ceil(base * 1.1));
          // Deterministic.
          expect(nextCheckAt({ id, everyMinutes: every }, now, failures)).toBe(
            new Date(next).toISOString(),
          );
        },
      ),
    );
  });

  it("backs off on failures", () => {
    const now = new Date(AT);
    const gap = (f: number) =>
      Date.parse(nextCheckAt({ id: "w", everyMinutes: 60 }, now, f)) - now.getTime();
    expect(gap(3)).toBeGreaterThan(gap(0) * 6);
  });
});

describe("appendHistory", () => {
  it("caps length, keeps the newest, replaces a same-instant point (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1e6 }), { maxLength: 600 }),
        fc.integer({ min: 0, max: 1e6 }),
        (xs, last) => {
          const history = xs.map((amountMinor, i) => ({
            at: new Date(i * 60_000).toISOString(),
            amountMinor,
          }));
          const point = { at: new Date(xs.length * 60_000).toISOString(), amountMinor: last };
          const out = appendHistory(history, point);
          expect(out.length).toBeLessThanOrEqual(HISTORY_CAP);
          expect(out[out.length - 1]).toEqual(point);
          const again = appendHistory(out, { ...point, amountMinor: last + 1 });
          expect(again.length).toBe(out.length);
          expect(again[again.length - 1]?.amountMinor).toBe(last + 1);
        },
      ),
    );
  });
});
