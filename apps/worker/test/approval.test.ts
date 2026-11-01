import { env } from "cloudflare:workers";
import { ErrorCodes } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { VirtualAuthenticator } from "./helpers/authenticator";
import { api, cookieFrom, devLogin, TestClient } from "./helpers/client";

const testEnv = env as unknown as Env;

async function searchThenBuy(c: TestClient, threadId: string) {
  await c.call("turn/start", { threadId, text: "find me noise-cancelling headphones under $300" });
  await c.turnCompleted(1);
  const { turnId } = await c.call("turn/start", { threadId, text: "buy the first one" });
  return turnId as string;
}

function mandate(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `mnd_${crypto.randomUUID().slice(0, 8)}`,
    userId,
    maxPerCharge: { amountMinor: 50_000, currency: "USD" },
    maxTotal: { amountMinor: 100_000, currency: "USD" },
    period: "none",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("approvals", () => {
  it("pauses on needs_approval and resumes the same turn after approve", async () => {
    const { cookie, userId } = await devLogin("appr1");
    const { client: c, threadId } = await TestClient.open(cookie);
    const turnId = await searchThenBuy(c, threadId);

    const paused = await c.turnCompleted(2);
    expect(paused.params).toMatchObject({ turnId, status: "awaitingApproval" });
    const approval = c.items("approvalRequest", "item/started")[0] as {
      approvalId: string;
      approverId: string;
      stepUp: boolean;
      amount: { amountMinor: number };
      status: string;
    };
    expect(approval).toMatchObject({ approverId: userId, stepUp: false, status: "inProgress" });
    // Amount comes from the product ref (cheapest match), never from model text.
    expect(approval.amount.amountMinor).toBe(7_999);
    expect(c.items("paymentEvent")).toHaveLength(0);

    const res = await c.call("approval/respond", {
      threadId,
      approvalId: approval.approvalId,
      decision: "approve",
    });
    expect(res.accepted).toBe(true);
    const done = await c.turnCompleted(3);
    expect(done.params).toMatchObject({ turnId, status: "completed" });

    const settled = c.items("approvalRequest").at(-1);
    expect(settled).toMatchObject({ decision: "approved", status: "completed" });
    const payment = c.items("paymentEvent")[0] as { kind: string; amount: { amountMinor: number } };
    expect(payment).toMatchObject({ kind: "charged", amount: { amountMinor: 7_999 } });
    const resumed = c.notifications("turn/started").filter((f) => f.params?.turnId === turnId);
    expect(resumed).toHaveLength(2);

    // Settled approvals can't be answered twice.
    const again = await c.request("approval/respond", {
      threadId,
      approvalId: approval.approvalId,
      decision: "approve",
    });
    expect(again.error?.code).toBe(ErrorCodes.invalidParams);
    c.close();
  });

  it("deny resumes the turn without charging", async () => {
    const { cookie } = await devLogin("appr2");
    const { client: c, threadId } = await TestClient.open(cookie);
    await searchThenBuy(c, threadId);
    await c.turnCompleted(2);
    const { approvalId } = c.items("approvalRequest", "item/started")[0] as { approvalId: string };
    await c.call("approval/respond", { threadId, approvalId, decision: "deny" });
    await c.turnCompleted(3);
    expect(c.items("approvalRequest").at(-1)).toMatchObject({ decision: "denied" });
    expect(c.items("paymentEvent")).toHaveLength(0);
    c.close();
  });

  it("only the addressed member can answer in a group thread", async () => {
    const ada = await devLogin("appr3_ada");
    const bo = await devLogin("appr3_bo");
    const { client: a, threadId } = await TestClient.open(ada.cookie, { memberIds: [bo.userId] });
    const b = await TestClient.connect(bo.cookie, threadId);
    await b.call("initialize", { clientInfo: { name: "b", version: "0" }, protocolVersion: 1 });
    await b.call("thread/resume", { threadId });
    await searchThenBuy(a, threadId);
    await a.turnCompleted(2);
    const { approvalId } = a.items("approvalRequest", "item/started")[0] as { approvalId: string };
    const forged = await b.request("approval/respond", {
      threadId,
      approvalId,
      decision: "approve",
    });
    expect(forged.error?.code).toBe(ErrorCodes.forbidden);
    a.close();
    b.close();
  });

  it("a new turn supersedes a pending approval", async () => {
    const { cookie } = await devLogin("appr4");
    const { client: c, threadId } = await TestClient.open(cookie);
    await searchThenBuy(c, threadId);
    await c.turnCompleted(2);
    await c.call("turn/start", { threadId, text: "actually never mind, show me headphones" });
    const done = await c.turnCompleted(3);
    expect(done.params?.status).toBe("completed");
    expect(c.items("approvalRequest").at(-1)).toMatchObject({ decision: "expired" });
    c.close();
  });

  it("step-up approvals need a passkey assertion over the item's challenge", async () => {
    // Register a real passkey through the WebAuthn endpoints.
    const authr = await VirtualAuthenticator.create();
    const optsRes = await api("/api/auth/register/options", {
      method: "POST",
      body: JSON.stringify({ username: "stepup1", displayName: "Step" }),
    });
    const flow = cookieFrom(optsRes, "pact_flow");
    const regOpts = (await optsRes.json()) as Parameters<VirtualAuthenticator["register"]>[0];
    const verify = await api("/api/auth/register/verify", {
      method: "POST",
      cookie: flow,
      body: JSON.stringify({ response: await authr.register(regOpts) }),
    });
    expect(verify.status).toBe(200);
    const cookie = cookieFrom(verify, "pact_session");
    const { userId } = (await verify.json()) as { userId: string };

    // A mandate that covers the spend but demands step-up above $1.
    await testEnv.USER.get(testEnv.USER.idFromName(userId)).putMandate(
      mandate(userId, { stepUpAbove: { amountMinor: 100, currency: "USD" } }),
    );

    const { client: c, threadId } = await TestClient.open(cookie);
    await searchThenBuy(c, threadId);
    await c.turnCompleted(2);
    const approval = c.items("approvalRequest", "item/started")[0] as {
      approvalId: string;
      stepUp: boolean;
      challenge: string;
    };
    expect(approval.stepUp).toBe(true);
    expect(approval.challenge).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const missing = await c.request("approval/respond", {
      threadId,
      approvalId: approval.approvalId,
      decision: "approve",
    });
    expect(missing.error?.code).toBe(ErrorCodes.unauthorized);

    const wrong = await authr.assert("d3JvbmctY2hhbGxlbmdl");
    const bad = await c.request("approval/respond", {
      threadId,
      approvalId: approval.approvalId,
      decision: "approve",
      assertion: wrong,
    });
    expect(bad.error?.code).toBe(ErrorCodes.unauthorized);

    // The options endpoint hands back the same challenge for the browser ceremony.
    const opts = await api("/api/auth/step-up/options", {
      method: "POST",
      cookie,
      body: JSON.stringify({ threadId, approvalId: approval.approvalId }),
    });
    const stepOpts = (await opts.json()) as {
      challenge: string;
      allowCredentials: { id: string }[];
    };
    expect(stepOpts.challenge).toBe(approval.challenge);
    expect(stepOpts.allowCredentials).toHaveLength(1);

    const ok = await c.request("approval/respond", {
      threadId,
      approvalId: approval.approvalId,
      decision: "approve",
      assertion: await authr.assert(approval.challenge),
    });
    expect(ok.result).toEqual({ accepted: true });
    await c.turnCompleted(3);
    expect(c.items("paymentEvent")).toHaveLength(1);
    c.close();
  });
});

describe("policy", () => {
  it("denies a spend the mandate forbids, with no approval and no charge", async () => {
    const { cookie, userId } = await devLogin("policy1");
    await testEnv.USER.get(testEnv.USER.idFromName(userId)).putMandate(
      mandate(userId, { merchantDeny: ["pact-sandbox-store"] }),
    );
    const { client: c, threadId } = await TestClient.open(cookie);
    await searchThenBuy(c, threadId);
    const done = await c.turnCompleted(2);
    expect(done.params?.status).toBe("completed");
    const spend = c.items("toolCall").find((i) => i.name === "requestSpend") as {
      result: { status: string; reasons: string[] };
    };
    expect(spend.result).toEqual({ status: "denied", reasons: ["merchant_denied"] });
    expect(c.items("systemNotice")[0]).toMatchObject({ level: "warning" });
    expect(c.items("approvalRequest", "item/started")).toHaveLength(0);
    expect(c.items("paymentEvent")).toHaveLength(0);
    c.close();
  });

  it("executes immediately inside a mandate and records the ledger", async () => {
    const { cookie, userId } = await devLogin("policy2");
    const user = testEnv.USER.get(testEnv.USER.idFromName(userId));
    const m = mandate(userId);
    await user.putMandate(m);
    const { client: c, threadId } = await TestClient.open(cookie);
    await searchThenBuy(c, threadId);
    const done = await c.turnCompleted(2);
    expect(done.params?.status).toBe("completed");
    expect(c.items("approvalRequest", "item/started")).toHaveLength(0);
    expect(c.items("paymentEvent")).toHaveLength(1);
    expect(await user.ledger()).toEqual([
      expect.objectContaining({ mandateId: m.id, amountMinor: 7_999, currency: "USD" }),
    ]);
    c.close();
  });
});
