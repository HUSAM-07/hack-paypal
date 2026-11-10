/**
 * The engine at volume (scripts/bench-engine.mjs measures it; these pin the behaviour the
 * benchmark's fixes rely on): bulk ledger writes, scoped refund voids, and payout batches that
 * stay inside PayPal's 15,000-items-per-call limit.
 */
import type { Credit } from "@pact/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { applyVoids, BULK_ROWS, loadCredits, persistCredits } from "../src/credits";
import { PAYOUT_BATCH_MAX_ITEMS, runPayouts } from "../src/payouts";
import { getPayPal } from "../src/paypal";
import { e } from "./helpers";

const credit = (i: number, over: Partial<Credit> = {}): Credit => ({
  id: `CAP${String(i).padStart(6, "0")}:cr${i % 7}`,
  captureId: `CAP${String(i).padStart(6, "0")}`,
  creatorId: `cr${i % 7}`,
  brandId: "brand",
  upc: "012345678905",
  amount: { amountMinor: 100 + (i % 50), currency: "USD" },
  state: "pending",
  holdUntil: "2020-01-31T00:00:00.000Z",
  ...over,
});

const rows = async () =>
  (
    await e.DB.prepare(
      "SELECT id, amount_minor, state, void_reason, payout_batch_id, hold_until FROM credits ORDER BY id",
    ).all<Record<string, unknown>>()
  ).results;

beforeEach(async () => {
  await e.DB.batch([
    e.DB.prepare("DELETE FROM credits"),
    e.DB.prepare("DELETE FROM refunds"),
    e.DB.prepare("DELETE FROM sales"),
    e.DB.prepare("DELETE FROM creators"),
    e.DB.prepare("DELETE FROM payout_batches"),
    e.DB.prepare("DELETE FROM review_flags"),
  ]);
});

describe("ledger at volume", () => {
  it("persists more than one bulk statement of credits, then updates only what changed", async () => {
    const n = BULK_ROWS * 2 + 7;
    const created = Array.from({ length: n }, (_, i) => credit(i));
    await persistCredits(e, [], created, "2020-01-01T00:00:00.000Z");
    expect(await loadCredits(e)).toEqual(created);

    const changed = created.map((c, i) =>
      i % 3 === 0
        ? { ...c, state: "voided" as const, voidReason: "refund" as const }
        : i % 3 === 1
          ? { ...c, state: "paid" as const, payoutBatchId: "B1" }
          : c,
    );
    await persistCredits(e, created, changed, "2020-01-02T00:00:00.000Z");
    expect(await loadCredits(e)).toEqual(changed);
    const stored = await rows();
    expect(stored.filter((r) => r.state === "voided")).toHaveLength(Math.ceil(n / 3));
    // Integers stay integers and nulls stay null through json_each.
    expect(stored[2]).toMatchObject({
      amount_minor: 102,
      void_reason: null,
      payout_batch_id: null,
    });
  });

  it("a refund webhook voids exactly its own capture's credits, however big the ledger", async () => {
    const ledger = Array.from({ length: 3_000 }, (_, i) => credit(i));
    await persistCredits(e, [], ledger, "2020-01-01T00:00:00.000Z");
    const target = ledger[1234] as Credit;
    await e.DB.prepare(
      `INSERT INTO sales (capture_id, upc, order_id, shop_id, amount_minor, currency, captured_at)
       VALUES (?, ?, 'O', 'shop', 5000, 'USD', '2020-01-01T00:00:00Z')`,
    )
      .bind(target.captureId, target.upc)
      .run();
    await e.DB.prepare(
      `INSERT INTO refunds (id, capture_id, kind, status, amount_minor, currency, event_id, created_at)
       VALUES ('R1', ?, 'refund', 'COMPLETED', 5000, 'USD', 'WH1', '2020-01-02T00:00:00Z')`,
    )
      .bind(target.captureId)
      .run();

    await applyVoids(e, target.captureId);
    const after = await loadCredits(e);
    const voided = after.filter((c) => c.state === "voided");
    expect(voided.map((c) => c.id)).toEqual([target.id]);
    expect(voided[0]?.voidReason).toBe("refund");
    // Reapplying (a redelivery, or the recompute's full pass) changes nothing.
    await applyVoids(e, target.captureId);
    await applyVoids(e);
    expect(await loadCredits(e)).toEqual(after);
  });
});

describe("payouts at volume", () => {
  it("allows PayPal's documented maximum per batch", () => {
    expect(PAYOUT_BATCH_MAX_ITEMS).toBe(15_000);
  });

  it("splits a run into batches of at most the item limit, each paid once", async () => {
    const creators = 7;
    await e.DB.batch(
      Array.from({ length: creators }, (_, i) =>
        e.DB.prepare("INSERT INTO creators (creator_id, name, paypal_id) VALUES (?, ?, ?)").bind(
          `cr${i}`,
          `Creator ${i}`,
          `PAYERCR${i}`,
        ),
      ),
    );
    const ledger = Array.from({ length: 70 }, (_, i) => credit(i));
    await persistCredits(e, [], ledger, "2020-01-01T00:00:00.000Z");
    const before = getPayPal(e).mock?.state.batches.size ?? 0;

    const run = await runPayouts(e, 3);
    expect(run.status).toBe("sent");
    expect(run.batches.map((b) => b.items)).toEqual([3, 3, 1]);
    expect(new Set(run.batches.map((b) => b.senderBatchId)).size).toBe(3);
    expect(run.senderBatchId).toBe(run.batches[0]?.senderBatchId);
    expect(run.items).toHaveLength(creators);

    const mock = getPayPal(e).mock;
    const sent = [...(mock?.state.batches.values() ?? [])].slice(before);
    expect(sent.map((b) => b.items.length)).toEqual([3, 3, 1]);
    const paidOut = sent.flatMap((b) => b.items).reduce((a, i) => a + i.amount.amountMinor, 0);
    const credited = ledger.reduce((a, c) => a + c.amount.amountMinor, 0);
    expect(paidOut).toBe(credited);
    const stored = await rows();
    expect(stored.every((r) => r.state === "paid")).toBe(true);
    expect(new Set(stored.map((r) => r.payout_batch_id)).size).toBe(3);

    // Nothing is due twice.
    expect((await runPayouts(e, 3)).status).toBe("nothing_due");
  });

  it("keeps a run under the limit in one batch with the same id as before the split", async () => {
    await e.DB.prepare(
      "INSERT INTO creators (creator_id, name, paypal_id) VALUES ('cr0', 'A', 'P0')",
    ).run();
    const ledger = [credit(0), credit(7)];
    await persistCredits(e, [], ledger, "2020-01-01T00:00:00.000Z");
    const run = await runPayouts(e);
    expect(run.batches).toHaveLength(1);
    // sender_batch_id = cited- + sha256(sorted credit ids) — unchanged by the split.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        ledger
          .map((c) => c.id)
          .sort()
          .join(","),
      ),
    );
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(run.senderBatchId).toBe(`cited-${hex.slice(0, 32)}`);
  });
});
