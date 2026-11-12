import { describe, expect, it } from "vitest";
import {
  batchesTotal,
  brandAddsUp,
  formatUsd,
  type LedgerSnapshot,
  ledgerChecks,
  paidInLedger,
  paidWithoutBatch,
} from "./ledger-check";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON from the read API
type Json = Record<string, any>;

/** A small coherent ledger: HouseFresh paid $15 in one batch, Winix funded $100, Levoit refunded. */
function snapshot(): LedgerSnapshot {
  const credit = (id: string, cap: string, state: string, extra: Json = {}): Json => ({
    id,
    captureId: cap,
    brandId: "winix",
    amountMinor: 500,
    state,
    payoutBatchId: state === "paid" ? "PP-B1" : null,
    holdUntil: "2026-12-01T00:00:00.000Z",
    frozen: false,
    held: false,
    ...extra,
  });
  const credits = [
    credit("c1:housefresh", "CAP1", "paid"),
    credit("c2:housefresh", "CAP2", "paid"),
    credit("c3:housefresh", "CAP3", "paid"),
    credit("c4:housefresh", "CAP4", "voided"),
    credit("c5:housefresh", "CAP5", "pending", { held: true, holdReasons: ["self_purchase"] }),
  ];
  return {
    credits: {
      creators: [{ creatorId: "housefresh", name: "HouseFresh", totals: { paid: 1500 }, credits }],
    },
    payouts: {
      batches: [
        {
          senderBatchId: "cited-1",
          paypalBatchId: "PP-B1",
          status: "SUCCESS",
          createdAt: "2026-12-01T00:00:00.000Z",
          items: [
            {
              creatorId: "housefresh",
              receiver: "HOUSEFRESH-PP",
              amountMinor: 1500,
              creditIds: ["c1:housefresh", "c2:housefresh", "c3:housefresh"],
            },
          ],
        },
      ],
    },
    deposits: {
      brands: [
        {
          brandId: "winix",
          name: "Winix",
          deposited: 10000,
          spent: 1500,
          returned: 7500,
          reserved: 500,
          available: 500,
          deposits: [{ status: "captured", amountMinor: 10000, captureId: "D1" }],
          refunds: [{ amountMinor: 7500 }],
        },
        {
          brandId: "levoit",
          name: "Levoit",
          deposited: 10000,
          spent: 0,
          returned: 10000,
          reserved: 0,
          available: 0,
          deposits: [{ status: "captured", amountMinor: 10000, captureId: "D2" }],
          refunds: [{ amountMinor: 10000 }],
        },
      ],
    },
    invoices: { statements: [] },
    journeys: {
      journeys: ["CAP1", "CAP2", "CAP3", "CAP4", "CAP5"].map((captureId) => ({
        shapley: [{ captureId }],
      })),
    },
    mock: { captures: [], refunds: [], batches: [], invoices: [] },
  };
}

const byId = (s: LedgerSnapshot) => {
  const r = ledgerChecks(s);
  return { r, get: (id: string) => r.checks.find((c) => c.id === id) };
};

describe("ledger checks", () => {
  it("passes a coherent ledger, with both numbers on every compared check", () => {
    const { r } = byId(snapshot());
    expect(r.counts.fail).toBe(0);
    expect(r.counts.pass).toBeGreaterThanOrEqual(10);
    for (const c of r.checks) {
      expect(c.status).toBe("pass");
      expect(c.left?.value).toBeTruthy();
      expect(c.right?.value).toBeTruthy();
      expect(c.plain).not.toMatch(/\barm\b/i);
    }
  });

  it("fails when the ledger paid more than PayPal's batches", () => {
    const s = snapshot();
    s.credits.creators[0].totals.paid = 1600;
    const { get } = byId(s);
    expect(get("paid-equals-batches")).toMatchObject({
      status: "fail",
      left: { value: "$16.00" },
      right: { value: "$15.00" },
    });
    expect(get("creator-housefresh")?.status).toBe("fail");
  });

  it("fails when a paid credit has no batch, or names a batch that does not exist", () => {
    const s = snapshot();
    s.credits.creators[0].credits[0].payoutBatchId = null;
    expect(byId(s).get("paid-have-batch")?.status).toBe("fail");
    const t = snapshot();
    t.credits.creators[0].credits[0].payoutBatchId = "NOPE";
    expect(byId(t).get("paid-have-batch")?.status).toBe("fail");
  });

  it("fails when a brand's deposit does not add up", () => {
    const s = snapshot();
    s.deposits.brands[0].available = 600;
    expect(byId(s).get("brand-winix")?.status).toBe("fail");
  });

  it("fails when Levoit paid anything or did not get everything back", () => {
    const s = snapshot();
    s.deposits.brands[1].returned = 9000;
    s.deposits.brands[1].available = 1000;
    expect(byId(s).get("levoit-zero")?.status).toBe("fail");
  });

  it("fails when a credit was paid before its hold ended", () => {
    const s = snapshot();
    s.credits.creators[0].credits[0].holdUntil = "2026-12-02T00:00:00.000Z";
    expect(byId(s).get("no-pay-in-hold")).toMatchObject({ status: "fail", right: { value: "1" } });
  });

  it("fails when a voided, held or frozen credit is in a batch", () => {
    const s = snapshot();
    s.payouts.batches[0].items[0].creditIds.push("c5:housefresh");
    expect(byId(s).get("withheld-not-paid")?.status).toBe("fail");
    const t = snapshot();
    t.credits.creators[0].credits[3].payoutBatchId = "PP-B1";
    expect(byId(t).get("withheld-not-paid")?.status).toBe("fail");
  });

  it("fails when a payout item is not the sum of its credits, or a batch did not succeed", () => {
    const s = snapshot();
    s.payouts.batches[0].items[0].creditIds.pop();
    expect(byId(s).get("items-equal-credits")?.status).toBe("fail");
    const t = snapshot();
    t.payouts.batches[0].status = "PENDING";
    expect(byId(t).get("batches-succeeded")?.status).toBe("fail");
  });

  it("fails when a credited sale was never recorded, and skips when one read cannot tell", () => {
    const s = snapshot();
    s.journeys?.journeys.pop();
    expect(byId(s).get("sales-recorded")?.status).toBe("fail");
    const t = snapshot();
    t.journeysLimit = 5;
    expect(byId(t).get("sales-recorded")?.status).toBe("skip");
  });

  it("checks a statement against the batches and refunds it cites", () => {
    const s = snapshot();
    s.deposits.brands[0].refunds = [{ refundId: "R1", amountMinor: 7500 }];
    s.invoices = {
      statements: [
        {
          brandId: "winix",
          invoiceId: "INV-1",
          creditedMinor: 2000,
          voidedMinor: 500,
          paidMinor: 1500,
          returnedMinor: 7500,
          invoiceTotalMinor: 1500,
          invoiceDueMinor: 0,
          payoutBatchIds: ["PP-B1"],
          refundIds: ["R1"],
          creditIds: ["c1:housefresh", "c2:housefresh", "c3:housefresh", "c4:housefresh"],
        },
      ],
    };
    expect(byId(s).get("statement-winix")?.status).toBe("pass");
    s.invoices.statements[0].invoiceDueMinor = 100;
    expect(byId(s).get("statement-winix")?.status).toBe("fail");
    s.invoices.statements[0].invoiceDueMinor = 0;
    s.invoices.statements[0].paidMinor = 1000;
    expect(byId(s).get("statement-winix")?.status).toBe("fail");
  });

  it("adds the comparison with PayPal's own record only when it holds something", () => {
    const quiet = byId(snapshot());
    expect(quiet.get("mock-batches")).toBeUndefined();
    expect(quiet.r.notRun[0]?.title).toMatch(/PayPal's own record/);

    const s = snapshot();
    s.mock = {
      captures: [
        { id: "D1", amount: { amountMinor: 10000 } },
        { id: "D2", amount: { amountMinor: 10000 } },
      ],
      batches: [{ items: [{ amount: { amountMinor: 1500 } }] }],
    };
    const loud = byId(s);
    expect(loud.get("mock-batches")?.status).toBe("pass");
    expect(loud.get("mock-deposit-winix")?.status).toBe("pass");
    expect(loud.r.notRun.some((x) => /own record of captures/.test(x.title))).toBe(false);
    s.mock.batches[0].items[0].amount.amountMinor = 1400;
    expect(byId(s).get("mock-batches")?.status).toBe("fail");
  });

  it("an empty ledger passes with nothing to compare and never throws", () => {
    const r = ledgerChecks({ deposits: {}, credits: {}, payouts: {} });
    expect(r.counts.fail).toBe(0);
  });
});

describe("shared helpers", () => {
  it("sums what the demo compares", () => {
    expect(paidInLedger([{ totals: { paid: 5 } }, { totals: { paid: 7 } }])).toBe(12);
    expect(
      batchesTotal([{ items: [{ amountMinor: 3 }] }, { items: [{ amount: { amountMinor: 4 } }] }]),
    ).toBe(7);
    expect(brandAddsUp({ spent: 1, returned: 2, reserved: 3, available: 4, deposited: 10 })).toBe(
      true,
    );
    expect(brandAddsUp({ spent: 1, returned: 2, reserved: 3, available: 4, deposited: 11 })).toBe(
      false,
    );
    expect(
      paidWithoutBatch([{ state: "paid" }, { state: "paid", payoutBatchId: "x" }]),
    ).toHaveLength(1);
    expect(formatUsd(39164)).toBe("$391.64");
  });
});
