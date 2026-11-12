import { HOLD_REASONS } from "@pact/attribution";
import { describe, expect, it } from "vitest";
import type { RawCredit, RawEngine, RawReviewFlag } from "../src/dashboard";
import { buildTables } from "../src/tables";
import { explainHold, TRUST_REASON, trustRows } from "../src/trust";
import { raw as base } from "./fixture";

const cr = (id: string, over: Partial<RawCredit> = {}): RawCredit => ({
  id: `${id}:housefresh`,
  captureId: id,
  brandId: "winix",
  upc: "W",
  amountMinor: 768,
  currency: "USD",
  state: "pending",
  voidReason: null,
  holdUntil: "2026-12-20T00:00:00Z",
  payoutBatchId: null,
  payoutStatus: null,
  ...over,
});
const flag = (c: RawCredit, reason: string, over: Partial<RawReviewFlag> = {}): RawReviewFlag => ({
  id: `${reason}:${c.id}`,
  creditId: c.id,
  captureId: c.captureId,
  reason,
  detail: null,
  status: "open",
  hold: true,
  createdAt: "2026-11-10T00:00:00Z",
  resolvedAt: null,
  credit: {
    creatorId: "housefresh",
    brandId: "winix",
    amountMinor: c.amountMinor,
    currency: "USD",
    state: c.state,
  },
  ...over,
});

const self = cr("S1", { held: true, holdReasons: ["self_purchase"] });
const both = cr("S2", { held: true, holdReasons: ["repeat_buyer", "velocity"] });
const ring = cr("S3", { held: true, holdReasons: ["refund_ring"] });
const frozen = cr("S4", { frozen: true });
const refunded = cr("S5", { state: "voided", voidReason: "refund" });
const partial = cr("S6", { state: "voided", voidReason: "partial_refund" });
const lost = cr("S7", { state: "voided", voidReason: "dispute" });
const reviewed = cr("S8", { state: "voided", voidReason: "review" });
const released = cr("S9", { state: "paid", payoutBatchId: "B1", payoutStatus: "SUCCESS" });
const plain = cr("S10");

const raw: RawEngine = {
  ...base,
  creators: [
    {
      creatorId: "housefresh",
      name: "HouseFresh",
      totals: { pending: 0, voided: 0, paid: 0 },
      credits: [self, both, ring, frozen, refunded, partial, lost, reviewed, released, plain],
    },
  ],
  reviewFlags: [
    flag(self, "self_purchase", { detail: "the buyer's PayPal account is the creator's" }),
    flag(both, "repeat_buyer", {
      detail: "purchase 3 of this UPC by one buyer in 30 days (limit 2)",
    }),
    flag(both, "velocity", { detail: "9 caused sales in 10 min, limit 5" }),
    flag(ring, "refund_ring", { detail: "buyer refunded 3 of 4 credited sales" }),
    flag(reviewed, "self_purchase", {
      status: "voided",
      detail: "the agent session belongs to the creator",
    }),
    flag(released, "velocity", { status: "released", detail: "7 caused sales in 10 min, limit 5" }),
  ],
};
const ctx = {
  nameOf: () => "HouseFresh",
  brandOf: () => "Winix",
  orderOfCapture: new Map([["S1", "O1"]]),
  saleDateOfOrder: new Map([["O1", "2026-11-09T10:00:00Z"]]),
};
const rows = trustRows(raw, ctx);
const by = (id: string) => rows.find((r) => r.id === `${id}:housefresh`);

describe("trust reasons", () => {
  it("has plain words for every code the guard can emit, and none of the jargon", () => {
    for (const code of HOLD_REASONS) expect(TRUST_REASON[code]).toBeTruthy();
    for (const text of Object.values(TRUST_REASON))
      expect(text).not.toMatch(/upc|arm|capture|ledger/i);
    expect(TRUST_REASON.self_purchase).toBe("Creator bought through their own PayPal");
    expect(TRUST_REASON.repeat_buyer).toBe("Same buyer bought repeatedly");
    expect(TRUST_REASON.velocity).toBe("Sudden spike in sales");
    expect(TRUST_REASON.refund_ring).toBe("Buyer refunds often");
  });

  it("says the guard's detail lines for a shop owner, and never shows an unknown one raw", () => {
    expect(explainHold("self_purchase", "the agent session belongs to the creator")).toMatch(
      /shopping agent/,
    );
    expect(
      explainHold("repeat_buyer", "purchase 3 of this UPC by one buyer in 30 days (limit 2)"),
    ).toBe(
      "This is purchase 3 of the same product by one buyer within 30 days (up to 2 is normal).",
    );
    expect(explainHold("velocity", "9 caused sales in 10 min, limit 5")).toBe(
      "9 sales credited to one creator in 10 minutes (more than 5 is unusual).",
    );
    expect(explainHold("refund_ring", "buyer refunded 3 of 4 credited sales")).toBe(
      "This buyer refunded 3 of their 4 credited purchases.",
    );
    expect(explainHold("velocity", "something new the engine says")).not.toMatch(/something new/);
  });
});

describe("trustRows", () => {
  it("lists exactly the credits that are held, frozen, voided or released, and skips the rest", () => {
    expect(rows.map((r) => r.statusKey).sort()).toEqual([
      "frozen",
      "held",
      "held",
      "held",
      "released",
      "voided",
      "voided",
      "voided",
      "voided",
    ]);
    expect(by("S10")).toBeUndefined();
  });

  it("holds: plain reason, amount, creator, sale date and the ids the buttons act on", () => {
    expect(by("S1")).toMatchObject({
      statusKey: "held",
      status: "Waiting for a reviewer",
      reason: "Creator bought through their own PayPal",
      amount: 7.68,
      creator: "HouseFresh",
      date: "2026-11-09",
      flagIds: "self_purchase:S1:housefresh",
    });
    expect(by("S2")).toMatchObject({
      reason: "Same buyer bought repeatedly; Sudden spike in sales",
      reasonCodes: "repeat_buyer,velocity",
    });
    expect(String(by("S2")?.flagIds).split(",")).toHaveLength(2);
    expect(by("S3")?.reason).toBe("Buyer refunds often");
  });

  it("frozen and voided credits carry the reason PayPal or the ledger gave", () => {
    expect(by("S4")).toMatchObject({
      statusKey: "frozen",
      reason: "Open dispute: frozen until PayPal decides",
      flagIds: "",
    });
    expect(by("S5")?.reason).toBe("Refund voided this credit");
    expect(by("S6")?.reasonCodes).toBe("partial_refund");
    expect(by("S7")?.reasonCodes).toBe("dispute");
    expect(by("S8")).toMatchObject({ statusKey: "voided", reasonCodes: "self_purchase" });
    expect(String(by("S8")?.why)).toMatch(/^A reviewer voided it\./);
    expect(by("S5")?.flagIds).toBe("");
  });

  it("a released hold keeps its reason and offers no buttons", () => {
    expect(by("S9")).toMatchObject({ statusKey: "released", reasonCodes: "velocity", flagIds: "" });
  });

  it("puts what needs a person first", () => {
    expect(rows[0]?.statusKey).toBe("held");
    expect(rows.at(-1)?.statusKey).toBe("released");
  });

  it("feeds Studio as the trust table, in dollars, and stays empty with nothing stopped", () => {
    expect(buildTables(raw).tables.trust).toHaveLength(9);
    expect(buildTables(base).tables.trust).toEqual(
      trustRows(base, { ...ctx, orderOfCapture: new Map(), saleDateOfOrder: new Map() }),
    );
    expect(
      buildTables({ ...base, creators: base.creators.map((c) => ({ ...c, credits: [] })) }).tables
        .trust,
    ).toEqual([]);
  });
});
