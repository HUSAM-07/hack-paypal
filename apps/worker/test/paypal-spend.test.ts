import type { Mandate, SpendIntent } from "@pact/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { WalletView } from "../src/do/user";
import { type PayPalMode, setPayPalTestOverrides } from "../src/payments/paypal";
import { api, devLogin, TestClient } from "./helpers/client";
import { completedOrder, declined, fx, sandbox, simulated, tag, userDO } from "./helpers/paypal";

afterEach(simulated);

function mandate(userId: string, overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: `mnd_${crypto.randomUUID().slice(0, 8)}`,
    userId,
    maxPerCharge: { amountMinor: 50_000, currency: "USD" },
    maxTotal: { amountMinor: 100_000, currency: "USD" },
    period: "none",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-12-31T00:00:00.000Z",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A user with a vaulted wallet behind a global mandate. */
async function fundedUser(prefix: string, overrides: Partial<Mandate> = {}) {
  const t = tag(prefix);
  const u = await devLogin(t);
  const vaultId = `VAULT-${t}`;
  const m = await userDO(u.userId).completeSetup({
    setupTokenId: `SETUP-${t}`,
    userId: u.userId,
    vaultId,
    customerId: `cust-${t}`,
    payerEmail: `${t}@example.com`,
    mandate: mandate(u.userId, overrides),
    label: "Everyday",
  });
  return { ...u, vaultId, mandateId: m.id, email: `${t}@example.com` };
}

function intent(
  userId: string,
  amountMinor: number,
  id = `spend_${crypto.randomUUID().slice(0, 12)}`,
): SpendIntent {
  return {
    id,
    userId,
    amount: { amountMinor, currency: "USD" },
    merchant: "pact-sandbox-store",
    description: "Test spend",
    initiatedBy: "agent",
    at: new Date().toISOString(),
  };
}

async function buy(cookie: string) {
  const { client, threadId } = await TestClient.open(cookie);
  await client.call("turn/start", {
    threadId,
    text: "find me noise-cancelling headphones under $300",
  });
  await client.turnCompleted(1);
  await client.call("turn/start", { threadId, text: "buy the first one" });
  await client.turnCompleted(2);
  const spend = client.items("toolCall").find((i) => i.name === "requestSpend") as {
    result: Record<string, unknown>;
  };
  return { client, threadId, result: spend.result };
}

describe("ThreadDO.executeSpend → chargeMandate", () => {
  it("charges the vaulted wallet off-session with a deterministic request id", async () => {
    const fake = sandbox();
    const u = await fundedUser("charge");
    fake.on("POST /v2/checkout/orders", { body: completedOrder("ORD-S1", "CAP-S1", "79.99") });
    const { client, result } = await buy(u.cookie);

    expect(result).toMatchObject({
      status: "executed",
      authorizedBy: "mandate",
      paymentRef: "CAP-S1",
    });
    expect(result).not.toHaveProperty("simulated");
    const call = fake.last("POST /v2/checkout/orders");
    expect(call.headers.get("PayPal-Request-Id")).toMatch(/^spend:spend_[A-Za-z0-9]{16}$/);
    expect(call.body).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: "79.99" } }],
      payment_source: {
        paypal: {
          vault_id: u.vaultId,
          stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT" },
        },
      },
    });
    expect(client.items("paymentEvent")).toEqual([
      expect.objectContaining({ kind: "charged", userId: u.userId, paypalRef: "CAP-S1" }),
    ]);
    expect(await userDO(u.userId).ledger()).toEqual([
      expect.objectContaining({ mandateId: u.mandateId, amountMinor: 7_999 }),
    ]);
    // The model-visible tool result never carries the vault id either.
    expect(JSON.stringify(client.frames)).not.toContain(u.vaultId);
  });

  it("maps INSTRUMENT_DECLINED to chargeFailed and releases the reservation", async () => {
    const fake = sandbox();
    const u = await fundedUser("decl");
    fake.on("POST /v2/checkout/orders", declined());
    const { client, result } = await buy(u.cookie);

    expect(result).toMatchObject({ status: "failed", reason: "INSTRUMENT_DECLINED" });
    expect(client.items("paymentEvent")).toEqual([
      expect.objectContaining({ kind: "chargeFailed", userId: u.userId }),
    ]);
    expect(await userDO(u.userId).ledger()).toEqual([]);
    const wallet = (await (await api("/api/wallet", { cookie: u.cookie })).json()) as WalletView;
    expect(wallet.activity[0]).toMatchObject({
      kind: "chargeFailed",
      subtitle: "INSTRUMENT_DECLINED",
    });
  });

  it("fails cleanly when the member has no linked wallet", async () => {
    const fake = sandbox();
    const u = await devLogin(tag("nofund"));
    await userDO(u.userId).putMandate(mandate(u.userId));
    const { client, result } = await buy(u.cookie);
    expect(result).toMatchObject({ status: "failed", reason: "no_funding" });
    expect(client.items("paymentEvent")[0]).toMatchObject({ kind: "chargeFailed" });
    expect(fake.to("POST /v2/checkout/orders")).toHaveLength(0);
  });

  it("keeps the simulated path when PAYPAL_MODE=simulated", async () => {
    const u = await devLogin(tag("simspend"));
    await userDO(u.userId).putMandate(mandate(u.userId));
    const { client, result } = await buy(u.cookie);
    expect(result).toMatchObject({ status: "executed", simulated: true });
    expect(client.items("paymentEvent")[0]).toMatchObject({
      kind: "charged",
      paypalRef: expect.stringMatching(/^SIMULATED-spend_/),
    });
  });
});

describe("UserDO.chargeSpend", () => {
  it("replays a settled intent from its record instead of charging twice", async () => {
    const fake = sandbox();
    const u = await fundedUser("replay");
    fake.on("POST /v2/checkout/orders", { body: completedOrder("ORD-R1", "CAP-R1", "10.00") });
    const i = intent(u.userId, 1_000);
    const input = {
      intent: i,
      mandateId: u.mandateId,
      authorizedBy: "mandate",
      threadId: "thr_test0000",
    } as const;
    const first = await userDO(u.userId).chargeSpend(input);
    const second = await userDO(u.userId).chargeSpend(input);
    expect(first).toMatchObject({ status: "charged", paypalRef: "CAP-R1" });
    expect(second).toMatchObject({ status: "charged", paypalRef: "CAP-R1" });
    expect(fake.to("POST /v2/checkout/orders")).toHaveLength(1);
    expect(await userDO(u.userId).ledger()).toHaveLength(1);
  });

  it("retries an unknown outcome with the same PayPal-Request-Id", async () => {
    const fake = sandbox();
    const u = await fundedUser("unknown");
    const outage = { status: 503, body: { name: "SERVICE_UNAVAILABLE", message: "down" } };
    // Three 503s exhaust the client's retries; the fourth attempt succeeds.
    fake.on("POST /v2/checkout/orders", outage, outage, outage, {
      body: completedOrder("ORD-U1", "CAP-U1", "10.00"),
    });
    const i = intent(u.userId, 1_000);
    const input = {
      intent: i,
      mandateId: u.mandateId,
      authorizedBy: "mandate",
      threadId: "thr_test0000",
    } as const;
    const first = await userDO(u.userId).chargeSpend(input);
    expect(first).toMatchObject({ status: "pending", reason: "SERVICE_UNAVAILABLE" });
    // Unknown outcome keeps the reservation so the cap can't be overspent meanwhile.
    expect(await userDO(u.userId).ledger()).toHaveLength(1);

    const second = await userDO(u.userId).chargeSpend(input);
    expect(second).toMatchObject({ status: "charged", paypalRef: "CAP-U1" });
    const ids = new Set(
      fake.to("POST /v2/checkout/orders").map((c) => c.headers.get("PayPal-Request-Id")),
    );
    expect([...ids]).toEqual([`spend:${i.id}`]);
  });

  it("re-runs authorize() atomically so concurrent spends can't overrun a cap", async () => {
    const fake = sandbox();
    const u = await fundedUser("race", { maxTotal: { amountMinor: 10_000, currency: "USD" } });
    let n = 0;
    fake.on("POST /v2/checkout/orders", () => {
      n += 1;
      return { body: completedOrder(`ORD-C${n}`, `CAP-C${n}`, "80.00") };
    });
    const results = await Promise.all(
      [1, 2].map((k) =>
        userDO(u.userId).chargeSpend({
          intent: intent(u.userId, 8_000, `spend_race${k}0000000`),
          mandateId: u.mandateId,
          authorizedBy: "mandate",
          threadId: "thr_test0000",
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual(["charged", "failed"]);
    expect(results.find((r) => r.status === "failed")?.reason).toBe("policy:over_total");
    expect(fake.to("POST /v2/checkout/orders")).toHaveLength(1);
  });
});

describe("P2P send via Payouts", () => {
  it("pays out only after the sender's charge succeeded, once", async () => {
    const fake = sandbox();
    const u = await fundedUser("p2p");
    fake.on("POST /v2/checkout/orders", { body: completedOrder("ORD-P1", "CAP-P1", "12.50") });
    fake.on("POST /v1/payments/payouts", { status: 201, body: fx.payoutBatchCreated });
    const user = userDO(u.userId);
    const payout = {
      userId: u.userId,
      receiver: "friend@example.com",
      amount: { amountMinor: 1_250, currency: "USD" },
      note: "Dinner",
      title: "Dinner split",
    };

    const early = await user.sendPayout({ ...payout, chargeId: "spend_notcharged0000" });
    expect(early).toMatchObject({ status: "failed", reason: "sender_not_charged" });
    expect(fake.to("POST /v1/payments/payouts")).toHaveLength(0);

    const i = intent(u.userId, 1_250);
    await user.chargeSpend({
      intent: i,
      mandateId: u.mandateId,
      authorizedBy: "mandate",
      threadId: "thr_test0000",
    });
    const sent = await user.sendPayout({ ...payout, chargeId: i.id });
    expect(sent).toMatchObject({
      status: "sent",
      paypalRef: fx.payoutBatchCreated.batch_header.payout_batch_id,
    });
    const call = fake.last("POST /v1/payments/payouts");
    expect(call.headers.get("PayPal-Request-Id")).toBe(`p2p:${i.id}`);
    expect(call.body).toMatchObject({
      sender_batch_header: { sender_batch_id: `p2p:${i.id}` },
      items: [{ receiver: "friend@example.com", amount: { currency: "USD", value: "12.50" } }],
    });

    const again = await user.sendPayout({ ...payout, chargeId: i.id });
    expect(again.status).toBe("sent");
    expect(fake.to("POST /v1/payments/payouts")).toHaveLength(1);
    const wallet = await user.wallet();
    expect(wallet.activity.map((a) => a.kind).sort()).toEqual(["charged", "payoutSent"]);
  });
});

describe("misconfiguration", () => {
  it("fails a spend cleanly, releasing the reservation, when PayPal isn't configured", async () => {
    sandbox();
    const u = await fundedUser("nocreds");
    // Same PayPalNotConfigured path as missing credentials.
    setPayPalTestOverrides({ mode: "bogus" as PayPalMode });
    const user = userDO(u.userId);
    const res = await user.chargeSpend({
      intent: intent(u.userId, 1_000),
      mandateId: u.mandateId,
      authorizedBy: "mandate",
      threadId: "thr_test0000",
    });
    expect(res).toMatchObject({ status: "failed", reason: "paypal_unavailable" });
    expect(await user.ledger()).toEqual([]);
  });
});
