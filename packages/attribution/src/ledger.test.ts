import { type AttributedSale, type Credit, HOLD_DAYS, type ProgrammeDeposit } from "@pact/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DemoClock } from "./clock";
import { depositBalance, settleDeposit } from "./deposit";
import { createCredits, markPaid, networkFee, releasePayable } from "./ledger";
import { coalitionValueFrom } from "./shapley";
import { applyVoid } from "./voids";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const WINIX = "100000000001";
const LEVOIT = "100000000002";
const T0 = "2026-11-01T00:00:00.000Z";

const sale = (i: number, over: Partial<AttributedSale> = {}): AttributedSale => ({
  captureId: `cap${String(i).padStart(3, "0")}`,
  orderId: `ord${i}`,
  shopId: "lumen",
  upc: WINIX,
  amount: usd(9599),
  sessionId: `s${i}`,
  arm: "test",
  creatorsSeen: ["housefresh"],
  model: "gpt",
  capturedAt: T0,
  ...over,
});

const deposit = (brandId: string, minor = 100_000): ProgrammeDeposit => ({
  id: `dep-${brandId}`,
  brandId,
  category: "purifiers",
  captureId: `depcap-${brandId}`,
  deposited: usd(minor),
  spent: usd(0),
  returned: usd(0),
});

const solo = () => () => coalitionValueFrom({ "": 0, housefresh: 0.4 });

describe("demo: 102 Winix units", () => {
  const sales = Array.from({ length: 200 }, (_, i) => sale(i));
  const winix = deposit("winix");
  const credits = createCredits({
    sales,
    brands: [{ brandId: "winix", upc: WINIX, units: 102, deposit: winix }],
    coalitionValue: solo(),
  });

  it("creates 102 pending credits worth $783.28 held 30 days", () => {
    expect(credits).toHaveLength(102);
    expect(credits.reduce((a, c) => a + c.amount.amountMinor, 0)).toBe(78_328);
    expect(credits.every((c) => c.state === "pending")).toBe(true);
    expect(credits[0]?.holdUntil).toBe("2026-12-01T00:00:00.000Z");
    expect(HOLD_DAYS).toBe(30);
  });

  it("nothing is payable before day 30, everything on day 30", () => {
    const clock = new DemoClock(T0);
    expect(releasePayable(credits, clock.advanceDays(29))).toEqual([]);
    const [line] = releasePayable(credits, clock.advanceDays(1));
    expect(line?.creatorId).toBe("housefresh");
    expect(line?.gross.amountMinor).toBe(78_328);
    expect(line?.creditIds).toHaveLength(102);
    expect(line?.fee.amountMinor).toBe(1567); // 2% of $783.28, recorded per payout
  });

  it("a disputed sale's credit is frozen: payable only once the dispute is lifted", () => {
    const day30 = "2026-12-01T00:00:00.000Z";
    const frozen = new Set(["cap005"]);
    const [line] = releasePayable(credits, day30, undefined, frozen);
    const disputed = credits.find((c) => c.captureId === "cap005");
    expect(line?.creditIds).toHaveLength(101);
    expect(line?.creditIds).not.toContain(disputed?.id);
    expect(line?.gross.amountMinor).toBe(78_328 - (disputed?.amount.amountMinor ?? 0));
    const paid = markPaid(credits, line?.creditIds ?? [], "batch-1");
    const [next] = releasePayable(paid, day30);
    expect(next?.creditIds).toEqual([disputed?.id]);
  });

  it("pays $783.28 and returns $216.72 of the $1,000 deposit", () => {
    const [line] = releasePayable(credits, "2026-12-01T00:00:00.000Z");
    const paid = markPaid(credits, line?.creditIds ?? [], "batch-1");
    const { deposit: closed, returnedNow } = settleDeposit(winix, paid);
    expect(closed.spent.amountMinor).toBe(78_328);
    expect(returnedNow.amountMinor).toBe(21_672);
    expect(closed.spent.amountMinor + closed.returned.amountMinor).toBe(100_000);
  });

  it("one refund voids exactly one credit; the deposit gets that cent amount back", () => {
    const { credits: after, flags } = applyVoid(credits, { kind: "refund", captureId: "cap005" });
    expect(flags).toEqual([]);
    expect(after.filter((c) => c.state === "voided")).toHaveLength(1);
    expect(after.filter((c) => c.state === "pending")).toHaveLength(101);
    expect(after.find((c) => c.state === "voided")?.voidReason).toBe("refund");
    const [line] = releasePayable(after, "2026-12-01T00:00:00.000Z");
    const paid = markPaid(after, line?.creditIds ?? [], "b");
    const { returnedNow } = settleDeposit(winix, paid);
    expect(returnedNow.amountMinor).toBe(
      100_000 - (78_328 - (after.find((c) => c.state === "voided")?.amount.amountMinor ?? 0)),
    );
  });

  it("Levoit has no lifted units so pays nothing", () => {
    const c = createCredits({
      sales: [...sales, sale(900, { upc: LEVOIT, arm: "test" })],
      brands: [{ brandId: "levoit", upc: LEVOIT, units: 0, deposit: deposit("levoit") }],
      coalitionValue: solo(),
    });
    expect(c).toEqual([]);
  });
});

describe("createCredits", () => {
  it("only credits exposed-arm sales of the brand's own SKU", () => {
    const sales = [sale(1), sale(2, { arm: "placebo" }), sale(3, { upc: LEVOIT })];
    const c = createCredits({
      sales,
      brands: [{ brandId: "winix", upc: WINIX, units: 5, deposit: deposit("winix") }],
      coalitionValue: solo(),
    });
    expect(c.map((x) => x.captureId)).toEqual(["cap001"]);
  });

  it("splits a sale across co-exposed creators by Shapley and sums to the commission", () => {
    const c = createCredits({
      sales: [sale(1, { amount: usd(10_000), creatorsSeen: ["a", "b"] })],
      brands: [{ brandId: "winix", upc: WINIX, units: 1, deposit: deposit("winix") }],
      coalitionValue: () => coalitionValueFrom({ "": 0, a: 0.3, b: 0.1, "a+b": 0.35 }),
    });
    expect(c.find((x) => x.creatorId === "a")?.amount.amountMinor).toBe(629);
    expect(c.find((x) => x.creatorId === "b")?.amount.amountMinor).toBe(171);
    expect(c.reduce((a, x) => a + x.amount.amountMinor, 0)).toBe(800);
  });

  it("never credits beyond the deposit, and is idempotent on re-run", () => {
    const sales = Array.from({ length: 50 }, (_, i) => sale(i));
    const dep = deposit("winix", 1000);
    const first = createCredits({
      sales,
      brands: [{ brandId: "winix", upc: WINIX, units: 50, deposit: dep }],
      coalitionValue: solo(),
    });
    expect(first.reduce((a, c) => a + c.amount.amountMinor, 0)).toBe(1000);
    const again = createCredits({
      sales,
      brands: [{ brandId: "winix", upc: WINIX, units: 50, deposit: dep }],
      coalitionValue: solo(),
      existing: first,
    });
    expect(again).toEqual([]);
  });
});

describe("clock and fee", () => {
  it("only moves forward", () => {
    const c = new DemoClock(T0);
    expect(() => c.advanceDays(-1)).toThrow();
    expect(c.advanceDays(30).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("fee rounds to the nearest cent and is configurable", () => {
    expect(networkFee(usd(78_328)).amountMinor).toBe(1567);
    expect(networkFee(usd(78_328), 0).amountMinor).toBe(0);
    expect(networkFee(usd(78_328), 349).amountMinor).toBe(2734);
  });
});

describe("property: balances always reconcile", () => {
  it("deposited = spent + returned (+ reserved) after any refunds and payouts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 100, max: 50_000 }),
        fc.array(fc.integer({ min: 0, max: 119 }), { maxLength: 30 }),
        fc.integer({ min: 0, max: 60 }),
        (units, price, refunds, day) => {
          const sales = Array.from({ length: 120 }, (_, i) => sale(i, { amount: usd(price) }));
          const dep = deposit("winix", 100_000);
          let credits: Credit[] = createCredits({
            sales,
            brands: [{ brandId: "winix", upc: WINIX, units, deposit: dep }],
            coalitionValue: solo(),
          });
          for (const r of refunds)
            credits = applyVoid(credits, {
              kind: "refund",
              captureId: `cap${String(r).padStart(3, "0")}`,
            }).credits;
          const now = new DemoClock(T0).advanceDays(day);
          for (const line of releasePayable(credits, now))
            credits = markPaid(credits, line.creditIds, `b-${line.creatorId}`);
          const b = depositBalance(dep, credits);
          const { deposit: closed } = settleDeposit(dep, credits);
          expect(b.reserved.amountMinor + b.spent.amountMinor + b.available.amountMinor).toBe(
            100_000,
          );
          expect(
            closed.spent.amountMinor + closed.returned.amountMinor + b.reserved.amountMinor,
          ).toBe(100_000);
          expect(b.available.amountMinor).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
