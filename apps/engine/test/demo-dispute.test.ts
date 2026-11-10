import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { call, e, seedExperiment, WINIX } from "./helpers";

type Json = Record<string, any>;

let seq = 0;
const disputeEvent = (
  type: "CREATED" | "UPDATED" | "RESOLVED",
  disputeId: string,
  captureId: string,
  outcome?: string,
) =>
  app.request(
    "/webhooks/paypal",
    {
      method: "POST",
      body: JSON.stringify({
        id: `WH-D-${++seq}`,
        event_type: `CUSTOMER.DISPUTE.${type}`,
        resource: {
          dispute_id: disputeId,
          status: type === "RESOLVED" ? "RESOLVED" : "OPEN",
          dispute_amount: { currency_code: "USD", value: "95.99" },
          ...(outcome ? { dispute_outcome: { outcome_code: outcome } } : {}),
          disputed_transactions: [{ seller_transaction_id: captureId }],
        },
      }),
    },
    e,
  );

const housefresh = async () => (await call<Json>("GET", "/credits")).json.creators[0];

describe("disputes freeze credits until PayPal decides", () => {
  it("frozen at payout; released and paid next run if the seller wins, voided if the buyer wins", async () => {
    await call("POST", "/brands", {
      brandId: "winix",
      name: "Winix",
      category: "purifier",
      upc: WINIX,
    });
    await call("POST", "/creators", {
      creatorId: "housefresh",
      name: "HouseFresh",
      paypalId: "HOUSEFRESH-PP",
    });
    await call("POST", "/brands/winix/deposits", { amountMinor: 100_000 });
    await seedExperiment();
    await call("POST", "/credits/recompute");

    const [won, lost] = (await housefresh()).credits as Json[];
    await disputeEvent("CREATED", "PP-D-WON", won?.captureId);
    await disputeEvent("CREATED", "PP-D-LOST", lost?.captureId);

    // Open disputes freeze, they do not void.
    let hf = await housefresh();
    expect(hf.credits.filter((c: Json) => c.state === "voided")).toEqual([]);
    expect(hf.credits.find((c: Json) => c.id === won?.id)).toMatchObject({
      state: "pending",
      frozen: true,
    });
    expect(hf.totals.frozen).toBe(won?.amountMinor + lost?.amountMinor);

    // The buyer wins one: that credit voids before any payout.
    await disputeEvent("RESOLVED", "PP-D-LOST", lost?.captureId, "RESOLVED_BUYER_FAVOUR");
    hf = await housefresh();
    expect(hf.credits.find((c: Json) => c.id === lost?.id)).toMatchObject({
      state: "voided",
      voidReason: "dispute",
    });

    // Day 30: everything due is paid except the credit still under dispute.
    await call("POST", "/clock/advance", { to: "2026-12-02T00:00:00.000Z" });
    hf = await housefresh();
    expect(hf.credits.find((c: Json) => c.id === won?.id)).toMatchObject({
      state: "pending",
      frozen: true,
    });
    expect(hf.totals.paid).toBe(39_164 - won?.amountMinor - lost?.amountMinor);

    // A late, out-of-order CREATED never reopens a decided dispute.
    await disputeEvent("RESOLVED", "PP-D-WON", won?.captureId, "RESOLVED_SELLER_FAVOUR");
    await disputeEvent("UPDATED", "PP-D-WON", won?.captureId);
    hf = await housefresh();
    expect(hf.credits.find((c: Json) => c.id === won?.id)).toMatchObject({
      state: "pending",
      frozen: false,
    });

    // The seller won: the next payout run pays the released credit in its own batch.
    const run = (await call<Json>("POST", "/payouts/run")).json;
    expect(run.status).toBe("sent");
    expect(run.items).toMatchObject([{ creatorId: "housefresh", creditIds: [won?.id] }]);
    hf = await housefresh();
    expect(hf.totals).toMatchObject({
      paid: 39_164 - lost?.amountMinor,
      voided: lost?.amountMinor,
      pending: 0,
      frozen: 0,
      held: 0,
    });
    const batches = (await call<Json>("GET", "/payouts")).json.batches;
    expect(batches).toHaveLength(2);
  });
});
