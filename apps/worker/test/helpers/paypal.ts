import { env } from "cloudflare:workers";
import { type FakeFetch, fakeFetch } from "@pact/paypal/testing/fake-fetch";
import * as fx from "@pact/paypal/testing/fixtures";
import type { Money } from "@pact/protocol";
import { expect } from "vitest";
import type { PactView } from "../../src/do/thread";
import type { Env } from "../../src/env";
import { setPayPalTestOverrides } from "../../src/payments/paypal";
import { api, devLogin, TestClient } from "./client";

export const testEnv = env as unknown as Env;

/** Routes every PayPal call in the worker and its DOs to a scripted fake, in sandbox mode. */
export function sandbox(): FakeFetch {
  const fake = fakeFetch();
  setPayPalTestOverrides({ mode: "sandbox", fetch: fake.fetch });
  return fake;
}

export function simulated(): void {
  setPayPalTestOverrides({});
}

export const userDO = (userId: string) => testEnv.USER.get(testEnv.USER.idFromName(userId));
export const threadDO = (threadId: string) =>
  testEnv.THREAD.get(testEnv.THREAD.idFromName(threadId));
export const pactDO = (pactId: string) => testEnv.PACT.get(testEnv.PACT.idFromName(pactId));

let seq = 0;
/** Unique, username-safe tag per call so tests never share users or PayPal ids. */
export function tag(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}${crypto.randomUUID().slice(0, 6)}`.toLowerCase();
}

export interface Member {
  cookie: string;
  userId: string;
}

/**
 * Two members in one thread and a drafted group-purchase pact (fake model: search, then
 * "split it together"). The $79.99 product splits 40.00 / 39.99.
 */
export async function groupPact(prefix: string) {
  const t = tag(prefix);
  const a = await devLogin(`${t}a`, "Ann");
  const b = await devLogin(`${t}b`, "Ben");
  const { client, threadId } = await TestClient.open(a.cookie, { memberIds: [b.userId] });
  await client.call("turn/start", {
    threadId,
    text: "find me noise-cancelling headphones under $300",
  });
  await client.turnCompleted(1);
  await client.call("turn/start", { threadId, text: "let's split it together" });
  await client.turnCompleted(2);
  const draft = client.items("toolCall").find((i) => i.name === "draftPact") as {
    result: { pactRef: string };
  };
  const pactId = draft.result.pactRef;
  const view = (await threadDO(threadId).pactForMember(pactId, a.userId)) as PactView;
  expect(view.shares).toHaveLength(2);
  return { t, a, b, client, threadId, pactId, view };
}

export function shareOf(view: PactView, userId: string): Money {
  const s = view.shares?.find((x) => x.userId === userId)?.share;
  if (!s) throw new Error("no share");
  return s;
}

export function post(path: string, cookie: string, body?: unknown) {
  return api(path, {
    method: "POST",
    cookie,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Commit a member through the real setup-token → payment-token routes. */
export async function linkWallet(
  fake: FakeFetch,
  m: Member,
  ctx: { threadId: string; pactId: string; cap: Money },
  vaultId: string,
): Promise<string> {
  const setupId = `SETUP-${vaultId}`;
  fake.on("POST /v3/vault/setup-tokens", { body: { ...fx.setupToken, id: setupId } });
  fake.on("POST /v3/vault/payment-tokens", {
    body: {
      ...fx.paymentToken,
      id: vaultId,
      customer: { id: `cust-${vaultId}` },
      payment_source: {
        paypal: {
          ...fx.paymentToken.payment_source.paypal,
          email_address: `${vaultId}@example.com`,
        },
      },
    },
  });
  const setup = await post("/api/paypal/setup-token", m.cookie, ctx);
  expect(setup.status).toBe(200);
  const { vaultSetupToken } = (await setup.json()) as { vaultSetupToken: string };
  const res = await post("/api/paypal/payment-token", m.cookie, {
    threadId: ctx.threadId,
    pactId: ctx.pactId,
    vaultSetupToken,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { mandateId: string }).mandateId;
}

export function declined(issue = "INSTRUMENT_DECLINED") {
  return {
    status: 422,
    body: {
      name: "UNPROCESSABLE_ENTITY",
      message: "The requested action could not be performed.",
      debug_id: "dbg123",
      details: [{ issue, description: "The instrument presented was declined." }],
    },
  };
}

/** A vaulted order that comes back COMPLETED with a capture. */
export function completedOrder(orderId: string, captureId: string, value: string) {
  return {
    ...fx.orderCompletedVault,
    id: orderId,
    purchase_units: [
      {
        reference_id: "default",
        amount: { currency_code: "USD", value },
        payments: {
          captures: [{ ...fx.capture, id: captureId, amount: { currency_code: "USD", value } }],
        },
      },
    ],
  };
}

export { fx };
