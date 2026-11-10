import type { Credit } from "@pact/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_GUARD, evaluateHolds, type GuardSale } from "./guard";
import { releasePayable } from "./ledger";

const WINIX = "100000000001";
const T0 = Date.parse("2026-11-01T00:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const sale = (captureId: string, over: Partial<GuardSale> = {}): GuardSale => ({
  captureId,
  upc: WINIX,
  capturedAt: at(0),
  refunded: false,
  ...over,
});
const credit = (
  captureId: string,
  creatorId = "housefresh",
  over: Partial<Credit> = {},
): Credit => ({
  id: `${captureId}:${creatorId}`,
  captureId,
  creatorId,
  brandId: "winix",
  upc: WINIX,
  amount: { amountMinor: 768, currency: "USD" },
  state: "pending",
  holdUntil: "2026-12-01T00:00:00.000Z",
  ...over,
});
const creators = [
  { creatorId: "housefresh", paypalId: "HOUSEFRESH-PP" },
  { creatorId: "airlab", paypalId: "AIRLAB-PP" },
];
const reasons = (holds: ReturnType<typeof evaluateHolds>) =>
  holds.map((h) => `${h.creditId}:${h.reason}`);

/** The demo's honest traffic: one buyer per agent session, every sale inside a few minutes. */
function honestStudy(n: number) {
  const sales = Array.from({ length: n }, (_, i) =>
    sale(`cap${i}`, { buyerId: `BUYER-${i}`, capturedAt: at(i / 10) }),
  );
  return { sales, credits: sales.map((s) => credit(s.captureId)) };
}

describe("self-purchase", () => {
  it("holds the credit when the buyer's PayPal is the creator's", () => {
    const holds = evaluateHolds({
      sales: [sale("a", { buyerId: "HOUSEFRESH-PP" })],
      credits: [credit("a")],
      creators,
    });
    expect(reasons(holds)).toEqual(["a:housefresh:self_purchase"]);
  });

  it("holds the credit when the creator owns the agent session", () => {
    for (const owner of ["housefresh", "HOUSEFRESH-PP"]) {
      const holds = evaluateHolds({
        sales: [sale("a", { buyerId: "BUYER-1", sessionOwnerId: owner })],
        credits: [credit("a")],
        creators,
      });
      expect(holds.map((h) => h.reason)).toEqual(["self_purchase"]);
    }
  });

  it("only holds the self-dealing creator's share of a co-exposed sale", () => {
    const holds = evaluateHolds({
      sales: [sale("a", { buyerId: "AIRLAB-PP" })],
      credits: [credit("a", "housefresh"), credit("a", "airlab")],
      creators,
    });
    expect(reasons(holds)).toEqual(["a:airlab:self_purchase"]);
  });

  it("is never paid automatically", () => {
    const credits = [credit("a"), credit("b")];
    const holds = evaluateHolds({
      sales: [sale("a", { buyerId: "HOUSEFRESH-PP" }), sale("b", { buyerId: "X" })],
      credits,
      creators,
    });
    const lines = releasePayable(
      credits,
      "2027-01-01T00:00:00.000Z",
      undefined,
      new Set(),
      new Set(holds.map((h) => h.creditId)),
    );
    expect(lines.flatMap((l) => l.creditIds)).toEqual(["b:housefresh"]);
  });
});

describe("repeat buyer", () => {
  it(`credits ${DEFAULT_GUARD.repeatMax} purchases of one UPC by one buyer, holds the rest`, () => {
    const sales = [0, 1, 2, 3].map((d) =>
      sale(`r${d}`, { buyerId: "B", capturedAt: at(d * 24 * 60) }),
    );
    const holds = evaluateHolds({
      sales,
      credits: sales.map((s) => credit(s.captureId)),
      creators,
    });
    expect(reasons(holds)).toEqual(["r2:housefresh:repeat_buyer", "r3:housefresh:repeat_buyer"]);
  });

  it("forgets purchases older than the window, and refunded ones", () => {
    const old = sale("o", { buyerId: "B", capturedAt: at(0) });
    const refunded = sale("v", { buyerId: "B", capturedAt: at(60 * 24 * 31) });
    const recent = [32, 33].map((d) =>
      sale(`n${d}`, { buyerId: "B", capturedAt: at(d * 24 * 60) }),
    );
    const credits = [
      credit("o", "housefresh", { state: "paid" }),
      credit("v", "housefresh", { state: "voided", voidReason: "refund" }),
      ...recent.map((s) => credit(s.captureId)),
    ];
    expect(evaluateHolds({ sales: [old, refunded, ...recent], credits, creators })).toEqual([]);
  });
});

describe("velocity", () => {
  it("holds a burst far above the floor", () => {
    const { sales, credits } = honestStudy(DEFAULT_GUARD.velocityFloor + 5);
    const holds = evaluateHolds({ sales, credits, creators });
    expect(holds).toHaveLength(5);
    expect(new Set(holds.map((h) => h.reason))).toEqual(new Set(["velocity"]));
  });

  it("scales with a creator's own baseline", () => {
    // 500 sales a day for a week (≈ 21/hour), then 150 more in half an hour: under 10× baseline.
    const base = Array.from({ length: 3500 }, (_, i) =>
      sale(`b${i}`, { buyerId: `B${i}`, capturedAt: at((i * 7 * 24 * 60) / 3500) }),
    );
    const burst = Array.from({ length: 150 }, (_, i) =>
      sale(`x${i}`, { buyerId: `X${i}`, capturedAt: at(7 * 24 * 60 + 1 + i / 5) }),
    );
    const all = [...base, ...burst];
    const holds = evaluateHolds({
      sales: all,
      credits: all.map((s) => credit(s.captureId)),
      creators,
    });
    expect(holds.filter((h) => h.reason === "velocity")).toEqual([]);
  });
});

describe("refund ring", () => {
  it("holds a buyer's remaining credits once most of their credited sales were refunded", () => {
    const sales = [
      sale("a", { buyerId: "R", refunded: true, capturedAt: at(0) }),
      sale("b", { buyerId: "R", refunded: true, capturedAt: at(60 * 24 * 40) }),
      sale("c", { buyerId: "R", upc: "200000000002", capturedAt: at(60 * 24 * 80) }),
    ];
    const credits = [
      credit("a", "housefresh", { state: "voided", voidReason: "refund" }),
      credit("b", "housefresh", { state: "voided", voidReason: "refund" }),
      credit("c"),
    ];
    expect(reasons(evaluateHolds({ sales, credits, creators }))).toEqual([
      "c:housefresh:refund_ring",
    ]);
  });

  it("ignores a buyer with too few credited sales to judge", () => {
    const sales = [sale("a", { buyerId: "R", refunded: true }), sale("b", { buyerId: "R" })];
    const credits = [
      credit("a", "housefresh", { state: "voided", voidReason: "refund" }),
      credit("b"),
    ];
    expect(evaluateHolds({ sales, credits, creators })).toEqual([]);
  });
});

describe("properties", () => {
  it("never fires on the demo's honest traffic (up to the 62 credited sales, and well past them)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: DEFAULT_GUARD.velocityFloor }), (n) => {
        const { sales, credits } = honestStudy(n);
        // One refund, like the demo's.
        if (sales[0]) sales[0] = { ...sales[0], refunded: true };
        return evaluateHolds({ sales, credits, creators }).length === 0;
      }),
    );
  });

  const arbLedger = fc
    .array(
      fc.record({
        buyer: fc.constantFrom("B1", "B2", "HOUSEFRESH-PP", "AIRLAB-PP", undefined),
        creator: fc.constantFrom("housefresh", "airlab"),
        upc: fc.constantFrom(WINIX, "200000000002"),
        minute: fc.integer({ min: 0, max: 60 * 24 * 90 }),
        state: fc.constantFrom<Credit["state"]>("pending", "paid", "voided"),
        refunded: fc.boolean(),
      }),
      { maxLength: 40 },
    )
    .map((rows) => {
      const sales = rows.map((r, i) =>
        sale(`c${i}`, {
          buyerId: r.buyer,
          upc: r.upc,
          capturedAt: at(r.minute),
          refunded: r.refunded,
        }),
      );
      const credits = rows.map((r, i) =>
        credit(`c${i}`, r.creator, {
          upc: r.upc,
          state: r.state,
          ...(r.state === "voided" ? { voidReason: "refund" as const } : {}),
        }),
      );
      return { sales, credits };
    });

  it("holds only pending credits, at most once per reason, and is deterministic", () => {
    fc.assert(
      fc.property(arbLedger, ({ sales, credits }) => {
        const holds = evaluateHolds({ sales, credits, creators });
        const pending = new Set(credits.filter((c) => c.state === "pending").map((c) => c.id));
        const keys = holds.map((h) => `${h.creditId}|${h.reason}`);
        return (
          holds.every((h) => pending.has(h.creditId)) &&
          new Set(keys).size === keys.length &&
          JSON.stringify(evaluateHolds({ sales: [...sales].reverse(), credits, creators })) ===
            JSON.stringify(holds)
        );
      }),
    );
  });

  it("every self-dealt pending credit is held, and held credits never reach a payout", () => {
    fc.assert(
      fc.property(arbLedger, ({ sales, credits }) => {
        const holds = evaluateHolds({ sales, credits, creators });
        const held = new Set(holds.map((h) => h.creditId));
        const buyerOf = new Map(sales.map((s) => [s.captureId, s.buyerId]));
        const selfDealt = credits.filter(
          (c) =>
            c.state === "pending" && buyerOf.get(c.captureId) === `${c.creatorId.toUpperCase()}-PP`,
        );
        const paid = releasePayable(
          credits,
          "2030-01-01T00:00:00.000Z",
          0,
          new Set(),
          held,
        ).flatMap((l) => l.creditIds);
        return selfDealt.every((c) => held.has(c.id)) && paid.every((id) => !held.has(id));
      }),
    );
  });
});
