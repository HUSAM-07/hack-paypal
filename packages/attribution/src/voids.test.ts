import type { Credit } from "@pact/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyVoid, apportion } from "./voids";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const credit = (id: string, amount: number, over: Partial<Credit> = {}): Credit => ({
  id,
  captureId: "capA",
  creatorId: id,
  brandId: "winix",
  upc: "100000000001",
  amount: usd(amount),
  state: "pending",
  holdUntil: "2026-12-01T00:00:00.000Z",
  ...over,
});
const total = (cs: Credit[], state: Credit["state"]) =>
  cs.filter((c) => c.state === state).reduce((a, c) => a + c.amount.amountMinor, 0);

describe("applyVoid", () => {
  it("full refund voids all pending credits of that sale only", () => {
    const cs = [credit("a", 500), credit("b", 300), credit("c", 100, { captureId: "capB" })];
    const r = applyVoid(cs, { kind: "refund", captureId: "capA" });
    expect(r.credits.filter((c) => c.state === "voided").map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.credits.find((c) => c.id === "c")?.state).toBe("pending");
    expect(r.credits.find((c) => c.id === "a")?.voidReason).toBe("refund");
  });

  it("dispute voids pending credits with the dispute reason", () => {
    const r = applyVoid([credit("a", 500)], { kind: "dispute", captureId: "capA" });
    expect(r.credits[0]).toMatchObject({ state: "voided", voidReason: "dispute" });
  });

  it("partial refund voids proportionally, conserving cents", () => {
    const cs = [credit("a", 551), credit("b", 249)];
    const r = applyVoid(cs, {
      kind: "partial_refund",
      captureId: "capA",
      saleAmount: usd(10_000),
      refunded: usd(2_500),
    });
    expect(total(r.credits, "voided")).toBe(200); // 25% of 800
    expect(total(r.credits, "pending")).toBe(600);
    expect(r.credits.filter((c) => c.state === "voided")).toHaveLength(2);
    expect(total(r.credits, "voided") + total(r.credits, "pending")).toBe(800);
  });

  it("partial refund is idempotent and cumulative refunds compose", () => {
    const cs = [credit("a", 800)];
    const ev = {
      kind: "partial_refund",
      captureId: "capA",
      saleAmount: usd(10_000),
      refunded: usd(2_500),
    } as const;
    const once = applyVoid(cs, ev).credits;
    expect(applyVoid(once, ev).credits).toEqual(once);
    const twice = applyVoid(once, { ...ev, cumulativeRefunded: usd(5_000) }).credits;
    expect(total(twice, "voided")).toBe(400);
  });

  it("a partial refund covering the whole sale is a full refund", () => {
    const r = applyVoid([credit("a", 800)], {
      kind: "partial_refund",
      captureId: "capA",
      saleAmount: usd(100),
      refunded: usd(100),
    });
    expect(r.credits[0]).toMatchObject({ state: "voided", voidReason: "refund" });
  });

  it("flags paid credits and leaves them untouched", () => {
    const paid = credit("p", 500, { state: "paid", payoutBatchId: "batch-1" });
    const r = applyVoid([paid, credit("a", 300)], { kind: "refund", captureId: "capA" });
    expect(r.flags).toEqual([
      { creditId: "p", captureId: "capA", reason: "refund", payoutBatchId: "batch-1" },
    ]);
    expect(r.credits.find((c) => c.id === "p")).toEqual(paid);
    expect(r.credits.find((c) => c.id === "a")?.state).toBe("voided");
  });

  it("redelivered full refund is a no-op", () => {
    const once = applyVoid([credit("a", 500)], { kind: "refund", captureId: "capA" }).credits;
    expect(applyVoid(once, { kind: "refund", captureId: "capA" }).credits).toEqual(once);
  });
});

describe("properties", () => {
  it("apportion sums exactly and never exceeds a weight", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 6 }),
        fc.nat(1000),
        (w, pct) => {
          const sum = w.reduce((a, x) => a + x, 0);
          const t = Math.floor((sum * pct) / 1000);
          const out = apportion(t, w);
          expect(out.reduce((a, x) => a + x, 0)).toBe(sum === 0 ? 0 : t);
          for (const [i, x] of out.entries()) expect(x).toBeLessThanOrEqual(w[i] ?? 0);
        },
      ),
    );
  });

  it("any sequence of partial refunds conserves pending + voided + paid", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 4 }),
        fc.array(fc.integer({ min: 1, max: 10_000 }), { maxLength: 6 }),
        (amounts, refunds) => {
          const start = amounts.map((a, i) => credit(`c${i}`, a));
          const sum = amounts.reduce((a, x) => a + x, 0);
          let cs = start;
          let cum = 0;
          for (const r of refunds) {
            cum = Math.min(10_000, cum + r);
            cs = applyVoid(cs, {
              kind: "partial_refund",
              captureId: "capA",
              saleAmount: usd(10_000),
              refunded: usd(r),
              cumulativeRefunded: usd(cum),
            }).credits;
            expect(total(cs, "pending") + total(cs, "voided")).toBe(sum);
          }
        },
      ),
    );
  });
});
