import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import type { FakeFetch } from "@pact/paypal/testing/fake-fetch";
import { toPayPalValue } from "@pact/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { PactView } from "../src/do/thread";
import {
  declined,
  fx,
  groupPact,
  linkWallet,
  pactDO,
  sandbox,
  shareOf,
  simulated,
  threadDO,
  userDO,
} from "./helpers/paypal";

afterEach(simulated);

/** Both members commit their share, then holds and captures are scripted per vault. */
async function committedPact(prefix: string, fake: FakeFetch) {
  const g = await groupPact(prefix);
  const vaults = { [g.a.userId]: `V${g.t}a`, [g.b.userId]: `V${g.t}b` };
  for (const m of [g.a, g.b]) {
    await linkWallet(
      fake,
      m,
      { threadId: g.threadId, pactId: g.pactId, cap: shareOf(g.view, m.userId) },
      vaults[m.userId] as string,
    );
  }
  const view = (await threadDO(g.threadId).pactForSettlement(g.pactId)) as PactView;
  expect(view.pact.state).toBe("armed");
  fake.on("POST /v2/checkout/orders", (req) => {
    const body = req.body as {
      payment_source: { paypal: { vault_id: string } };
      purchase_units: { amount: { value: string } }[];
    };
    const v = body.payment_source.paypal.vault_id;
    return {
      body: fx.orderAuthorized(`ORD-${v}`, `AUTH-${v}`, body.purchase_units[0]?.amount.value),
    };
  });
  for (const v of Object.values(vaults)) {
    fake.on(`POST /v2/payments/authorizations/AUTH-${v}/capture`, {
      body: { ...fx.capture, id: `CAP-${v}` },
    });
    fake.on(`POST /v2/payments/authorizations/AUTH-${v}/void`, { status: 204 });
  }
  return { ...g, view, vaults };
}

describe("PactDO group settlement", () => {
  it("authorizes every share, then captures them all", async () => {
    const fake = sandbox();
    const p = await committedPact("settle", fake);
    const res = await pactDO(p.pactId).settle({
      threadId: p.threadId,
      pactId: p.pactId,
      runId: "run1",
    });
    expect(res).toEqual({ status: "captured", failures: [] });

    const auths = fake.to("POST /v2/checkout/orders");
    expect(auths).toHaveLength(2);
    for (const call of auths) {
      expect(call.body).toMatchObject({
        intent: "AUTHORIZE",
        purchase_units: [{ custom_id: p.pactId }],
      });
      expect(call.headers.get("PayPal-Request-Id")).toMatch(
        new RegExp(`^pact:${p.pactId}:run1:usr_[A-Za-z0-9]+:authorize$`),
      );
    }
    const values = auths.map(
      (c) =>
        (c.body as { purchase_units: { amount: { value: string } }[] }).purchase_units[0]?.amount
          .value,
    );
    expect(values.sort()).toEqual(
      [shareOf(p.view, p.a.userId), shareOf(p.view, p.b.userId)].map(toPayPalValue).sort(),
    );

    await p.client.waitFor(() => p.client.items("paymentEvent").length >= 2);
    expect(
      p.client
        .items("paymentEvent")
        .map((e) => e.paypalRef)
        .sort(),
    ).toEqual(
      Object.values(p.vaults)
        .map((v) => `CAP-${v}`)
        .sort(),
    );
    const done = (await threadDO(p.threadId).pactForSettlement(p.pactId)) as PactView;
    expect(done.pact.state).toBe("done");
    expect(done.pact.members.every((m) => m.status === "charged")).toBe(true);
    expect(await userDO(p.a.userId).ledger()).toHaveLength(1);

    // Same run again: answered from storage, no new PayPal calls.
    const again = await pactDO(p.pactId).settle({
      threadId: p.threadId,
      pactId: p.pactId,
      runId: "run1",
    });
    expect(again.status).toBe("captured");
    expect(fake.to("POST /v2/checkout/orders")).toHaveLength(2);
  });

  it("voids every hold when one member's authorization is declined", async () => {
    const fake = sandbox();
    const p = await committedPact("voidall", fake);
    const bad = p.vaults[p.b.userId] as string;
    const good = p.vaults[p.a.userId] as string;
    fake.on("POST /v2/checkout/orders", (req) => {
      const v = (req.body as { payment_source: { paypal: { vault_id: string } } }).payment_source
        .paypal.vault_id;
      return v === bad
        ? declined()
        : { body: fx.orderAuthorized(`ORD-${v}`, `AUTH-${v}`, "40.00") };
    });
    const res = await pactDO(p.pactId).settle({
      threadId: p.threadId,
      pactId: p.pactId,
      runId: "run1",
    });
    expect(res.status).toBe("failed");
    expect(res.failures).toEqual([{ userId: p.b.userId, reason: "UNPROCESSABLE_ENTITY" }]);
    expect(fake.to(`POST /v2/payments/authorizations/AUTH-${good}/void`)).toHaveLength(1);
    expect(fake.calls.some((c) => c.key.endsWith("/capture"))).toBe(false);
    for (const m of [p.a, p.b]) expect(await userDO(m.userId).ledger()).toEqual([]);
    const after = (await threadDO(p.threadId).pactForSettlement(p.pactId)) as PactView;
    expect(after.pact.state).toBe("failed");
  });

  it("holds until captured, and the deadline alarm voids them", async () => {
    const fake = sandbox();
    const p = await committedPact("deadline", fake);
    const stub = pactDO(p.pactId);
    const held = await stub.settle({
      threadId: p.threadId,
      pactId: p.pactId,
      runId: "run1",
      capture: false,
    });
    expect(held.status).toBe("held");
    const alarm = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThan(Date.now());
    // Inside the 3-day honor period.
    expect(alarm).toBeLessThan(Date.now() + 3 * 86_400_000);

    await runInDurableObject(stub, async (_i, state) => {
      const run = (await state.storage.get("run")) as { deadline: number };
      await state.storage.put("run", { ...run, deadline: Date.now() - 1 });
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.status()).toEqual({
      status: "voided",
      failures: [{ userId: "", reason: "deadline" }],
    });
    expect(fake.calls.filter((c) => c.key.endsWith("/void"))).toHaveLength(2);
    expect(fake.calls.some((c) => c.key.endsWith("/capture"))).toBe(false);
  });

  it("refunds captured shares when another capture fails", async () => {
    const fake = sandbox();
    const p = await committedPact("unwind", fake);
    const bad = p.vaults[p.b.userId] as string;
    const good = p.vaults[p.a.userId] as string;
    fake.on(
      `POST /v2/payments/authorizations/AUTH-${bad}/capture`,
      declined("AUTHORIZATION_EXPIRED"),
    );
    fake.on(`POST /v2/payments/captures/CAP-${good}/refund`, { status: 201, body: fx.refund });
    const res = await pactDO(p.pactId).settle({
      threadId: p.threadId,
      pactId: p.pactId,
      runId: "run1",
    });
    expect(res.status).toBe("failed");
    expect(fake.to(`POST /v2/payments/captures/CAP-${good}/refund`)).toHaveLength(1);
    for (const m of [p.a, p.b]) expect(await userDO(m.userId).ledger()).toEqual([]);
  });

  it("refuses unattended settlement for a member without a mandate", async () => {
    const fake = sandbox();
    const g = await groupPact("nomandate");
    const res = await pactDO(g.pactId).settle({
      threadId: g.threadId,
      pactId: g.pactId,
      runId: "run1",
    });
    expect(res.status).toBe("failed");
    expect(res.failures.map((f) => f.reason)).toEqual(["policy:no_mandate", "policy:no_mandate"]);
    expect(fake.to("POST /v2/checkout/orders")).toHaveLength(0);
  });

  it("pays the payee out after a payout pact is captured", async () => {
    const fake = sandbox();
    const p = await committedPact("payout", fake);
    await runInDurableObject(threadDO(p.threadId), (_i, state) => {
      const row = state.storage.sql
        .exec<{ json: string }>("SELECT json FROM refs WHERE id = ?", p.pactId)
        .one();
      const data = JSON.parse(row.json);
      data.pact.action = { kind: "payout", payeeEmail: "landlord@example.com", amount: data.total };
      state.storage.sql.exec(
        "UPDATE refs SET json = ? WHERE id = ?",
        JSON.stringify(data),
        p.pactId,
      );
    });
    fake.on("POST /v1/payments/payouts", { status: 201, body: fx.payoutBatchCreated });
    const res = await pactDO(p.pactId).settle({
      threadId: p.threadId,
      pactId: p.pactId,
      runId: "run1",
    });
    expect(res.status).toBe("captured");
    const payout = fake.last("POST /v1/payments/payouts");
    expect(payout.headers.get("PayPal-Request-Id")).toBe(`pact:${p.pactId}:run1:payout`);
    expect(payout.body).toMatchObject({
      items: [{ receiver: "landlord@example.com", amount: { value: toPayPalValue(p.view.total) } }],
    });
  });

  it("settles instantly with simulated refs in simulated mode", async () => {
    const fake = sandbox();
    const p = await committedPact("simset", fake);
    simulated();
    const res = await pactDO(p.pactId).settle({
      threadId: p.threadId,
      pactId: p.pactId,
      runId: "run1",
    });
    expect(res.status).toBe("captured");
    await p.client.waitFor(() => p.client.items("paymentEvent").length >= 2);
    expect(p.client.items("paymentEvent")[0]?.paypalRef).toMatch(/^SIMULATED-set_/);
  });
});
