import { toPayPalValue } from "@pact/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { WalletView } from "../src/do/user";
import { api, devLogin } from "./helpers/client";
import {
  declined,
  fx,
  groupPact,
  linkWallet,
  post,
  sandbox,
  shareOf,
  simulated,
  tag,
  threadDO,
  userDO,
} from "./helpers/paypal";

afterEach(simulated);

describe("auth and modes", () => {
  it("requires a session on every money route", async () => {
    for (const [method, path] of [
      ["GET", "/api/wallet"],
      ["POST", "/api/mandates/mnd_x/revoke"],
      ["GET", "/api/paypal/client-token"],
      ["POST", "/api/paypal/setup-token"],
      ["POST", "/api/paypal/payment-token"],
      ["POST", "/api/paypal/orders"],
      ["POST", "/api/paypal/orders/ABC/capture"],
    ] as const) {
      const res = await api(path, { method });
      expect(res.status, path).toBe(401);
    }
  });

  it("rejects cross-origin POSTs", async () => {
    const { cookie } = await devLogin(tag("origin"));
    const res = await api("/api/mandates/mnd_x/revoke", {
      method: "POST",
      cookie,
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("turns the SDK handshakes off in simulated mode", async () => {
    const { cookie } = await devLogin(tag("sim"));
    const res = await api("/api/paypal/client-token", { cookie });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "paypal_disabled" });
  });
});

describe("wallet and client token", () => {
  it("shows an unlinked wallet for a new user", async () => {
    const { cookie } = await devLogin(tag("wal"));
    const res = await api("/api/wallet", { cookie });
    expect(await res.json()).toEqual({
      funding: { label: "PayPal not linked", linked: false },
      mandates: [],
      activity: [],
    });
  });

  it("mints a browser client token without exposing app credentials", async () => {
    const fake = sandbox();
    fake.on("POST /v1/oauth2/token", { body: fx.clientTokenResponse });
    const { cookie } = await devLogin(tag("ct"));
    const res = await api("/api/paypal/client-token", { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clientToken: fx.clientTokenResponse.access_token });
    expect(fake.last("POST /v1/oauth2/token").body).toMatchObject({
      response_type: "client_token",
    });
  });
});

describe("commit: setup-token → payment-token", () => {
  it("vaults the wallet, issues a pact-scoped mandate and never returns the vault id", async () => {
    const fake = sandbox();
    const { a, threadId, pactId, view } = await groupPact("commit");
    const cap = shareOf(view, a.userId);
    const mandateId = await linkWallet(fake, a, { threadId, pactId, cap }, "VAULTcommitA");

    const setupCall = fake.last("POST /v3/vault/setup-tokens");
    expect(setupCall.headers.get("PayPal-Request-Id")).toMatch(/^setup:req_/);
    const tokenCall = fake.last("POST /v3/vault/payment-tokens");
    expect(tokenCall.headers.get("PayPal-Request-Id")).toBe("vault:SETUP-VAULTcommitA");

    const walletRes = await api("/api/wallet", { cookie: a.cookie });
    const raw = await walletRes.text();
    expect(raw).not.toContain("VAULTcommitA");
    const wallet = JSON.parse(raw);
    expect(wallet.funding).toEqual({ label: "PayPal · V•••@example.com", linked: true });
    expect(wallet.mandates).toHaveLength(1);
    expect(wallet.mandates[0].mandate).toMatchObject({
      id: mandateId,
      pactId,
      maxPerCharge: cap,
      maxTotal: cap,
      maxCharges: 1,
      status: "active",
    });
    expect(wallet.mandates[0].label).toBe(view.pact.title);

    const after = await threadDO(threadId).pactForMember(pactId, a.userId);
    const me = after?.pact.members.find((m) => m.userId === a.userId);
    expect(me).toMatchObject({ status: "committed", mandateId, cap });
    expect(after?.pact.state).toBe("collecting");
  });

  it("is idempotent: replaying the payment-token call returns the same mandate", async () => {
    const fake = sandbox();
    const { a, threadId, pactId, view } = await groupPact("idem");
    const cap = shareOf(view, a.userId);
    const mandateId = await linkWallet(fake, a, { threadId, pactId, cap }, "VAULTidem");
    const before = fake.to("POST /v3/vault/payment-tokens").length;
    const again = await post("/api/paypal/payment-token", a.cookie, {
      threadId,
      pactId,
      vaultSetupToken: "SETUP-VAULTidem",
    });
    expect(await again.json()).toEqual({ mandateId });
    expect(fake.to("POST /v3/vault/payment-tokens")).toHaveLength(before);
  });

  it("validates the cap against the member's share and the pact total", async () => {
    sandbox();
    const { a, threadId, pactId, view } = await groupPact("cap");
    const share = shareOf(view, a.userId);
    const cases = [
      [{ ...share, amountMinor: share.amountMinor - 1 }, "cap_below_share"],
      [{ ...share, amountMinor: view.total.amountMinor + 1 }, "cap_above_total"],
      [{ ...share, currency: "EUR" }, "currency_mismatch"],
    ] as const;
    for (const [cap, error] of cases) {
      const res = await post("/api/paypal/setup-token", a.cookie, { threadId, pactId, cap });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error });
    }
    const float = await post("/api/paypal/setup-token", a.cookie, {
      threadId,
      pactId,
      cap: { amountMinor: 12.5, currency: "USD" },
    });
    expect(float.status).toBe(400);
  });

  it("hides pacts from people outside the thread", async () => {
    sandbox();
    const { threadId, pactId, view } = await groupPact("outsider");
    const outsider = await devLogin(tag("out"));
    const res = await post("/api/paypal/setup-token", outsider.cookie, {
      threadId,
      pactId,
      cap: view.total,
    });
    expect(res.status).toBe(404);
  });

  it("rejects someone else's setup token", async () => {
    const fake = sandbox();
    const { a, b, threadId, pactId, view } = await groupPact("steal");
    fake.on("POST /v3/vault/setup-tokens", { body: { ...fx.setupToken, id: "SETUP-ANN" } });
    const setup = await post("/api/paypal/setup-token", a.cookie, {
      threadId,
      pactId,
      cap: shareOf(view, a.userId),
    });
    expect(setup.status).toBe(200);
    const res = await post("/api/paypal/payment-token", b.cookie, {
      threadId,
      pactId,
      vaultSetupToken: "SETUP-ANN",
    });
    expect(res.status).toBe(404);
    expect(fake.to("POST /v3/vault/payment-tokens")).toHaveLength(0);
  });
});

describe("mandate revocation", () => {
  it("revokes your own mandate and 404s on anyone else's", async () => {
    const fake = sandbox();
    const { a, b, threadId, pactId, view } = await groupPact("revoke");
    const mandateId = await linkWallet(
      fake,
      a,
      { threadId, pactId, cap: shareOf(view, a.userId) },
      "VAULTrevoke",
    );
    const theirs = await post(`/api/mandates/${mandateId}/revoke`, b.cookie);
    expect(theirs.status).toBe(404);
    expect((await userDO(a.userId).listMandates())[0]?.status).toBe("active");

    const mine = await post(`/api/mandates/${mandateId}/revoke`, a.cookie);
    expect(await mine.json()).toEqual({ ok: true });
    expect((await userDO(a.userId).listMandates())[0]?.status).toBe("revoked");
  });
});

describe("one-time share orders", () => {
  it("creates an order for the server-computed share and captures it", async () => {
    const fake = sandbox();
    const { b, client, threadId, pactId, view } = await groupPact("order");
    const share = shareOf(view, b.userId);
    fake.on("POST /v2/checkout/orders", { body: { ...fx.orderCreated, id: "ORDER-B1" } });
    const res = await post("/api/paypal/orders", b.cookie, { threadId, pactId, amount: 1 });
    expect(await res.json()).toEqual({ orderId: "ORDER-B1" });
    const created = fake.last("POST /v2/checkout/orders");
    expect(created.body).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [
        { amount: { currency_code: "USD", value: toPayPalValue(share) }, custom_id: pactId },
      ],
    });
    expect(created.headers.get("PayPal-Request-Id")).toBe(
      `order:${pactId}:${b.userId}:${share.amountMinor}`,
    );

    fake.on("POST /v2/checkout/orders/ORDER-B1/capture", {
      body: { ...fx.orderCompletedVault, id: "ORDER-B1" },
    });
    const cap = await post("/api/paypal/orders/ORDER-B1/capture", b.cookie);
    expect(await cap.json()).toEqual({ status: "COMPLETED" });
    expect(
      fake.last("POST /v2/checkout/orders/ORDER-B1/capture").headers.get("PayPal-Request-Id"),
    ).toBe("capture:ORDER-B1");

    await client.waitFor((f) => (f.params?.item as { type?: string })?.type === "paymentEvent");
    expect(client.items("paymentEvent")).toEqual([
      expect.objectContaining({
        kind: "charged",
        userId: b.userId,
        pactId,
        amount: share,
        paypalRef: fx.capture.id,
      }),
    ]);
    const after = await threadDO(threadId).pactForMember(pactId, b.userId);
    expect(after?.pact.members.find((m) => m.userId === b.userId)?.status).toBe("charged");

    // A second capture is answered from our records, not PayPal.
    const again = await post("/api/paypal/orders/ORDER-B1/capture", b.cookie);
    expect(await again.json()).toEqual({ status: "COMPLETED" });
    expect(fake.to("POST /v2/checkout/orders/ORDER-B1/capture")).toHaveLength(1);

    const paid = await post("/api/paypal/orders", b.cookie, { threadId, pactId });
    expect(paid.status).toBe(409);
    const wallet = (await (await api("/api/wallet", { cookie: b.cookie })).json()) as WalletView;
    expect(wallet.activity).toEqual([
      expect.objectContaining({ kind: "charged", amount: share, direction: "out" }),
    ]);
  });

  it("reports INSTRUMENT_DECLINED so the buyer can pick another funding source", async () => {
    const fake = sandbox();
    const { a, client, threadId, pactId } = await groupPact("decline");
    fake.on("POST /v2/checkout/orders", { body: { ...fx.orderCreated, id: "ORDER-D1" } });
    await post("/api/paypal/orders", a.cookie, { threadId, pactId });
    fake.on("POST /v2/checkout/orders/ORDER-D1/capture", declined(), {
      body: { ...fx.orderCompletedVault, id: "ORDER-D1" },
    });
    const first = await post("/api/paypal/orders/ORDER-D1/capture", a.cookie);
    expect(await first.json()).toEqual({ status: "DECLINED", reason: "INSTRUMENT_DECLINED" });
    await client.waitFor((f) => (f.params?.item as { type?: string })?.type === "paymentEvent");
    expect(client.items("paymentEvent")[0]).toMatchObject({
      kind: "chargeFailed",
      userId: a.userId,
    });

    const retry = await post("/api/paypal/orders/ORDER-D1/capture", a.cookie);
    expect(await retry.json()).toEqual({ status: "COMPLETED" });
  });

  it("rejects capturing someone else's order", async () => {
    const fake = sandbox();
    const { a, b, threadId, pactId } = await groupPact("theft");
    fake.on("POST /v2/checkout/orders", { body: { ...fx.orderCreated, id: "ORDER-A9" } });
    await post("/api/paypal/orders", a.cookie, { threadId, pactId });
    const res = await post("/api/paypal/orders/ORDER-A9/capture", b.cookie);
    expect(res.status).toBe(404);
    expect(fake.to("POST /v2/checkout/orders/ORDER-A9/capture")).toHaveLength(0);
  });

  it("surfaces other PayPal errors without leaking bodies", async () => {
    const fake = sandbox();
    const { a, threadId, pactId } = await groupPact("err");
    fake.on("POST /v2/checkout/orders", {
      status: 500,
      body: { name: "INTERNAL_SERVER_ERROR", message: "boom", debug_id: "d" },
    });
    const res = await post("/api/paypal/orders", a.cookie, { threadId, pactId });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});
