import { createExecutionContext, SELF } from "cloudflare:test";
import { env as rawEnv } from "cloudflare:workers";
import { createEngineApprover } from "@cited/studio";
import { describe, expect, it } from "vitest";
import { citedEnv, citedWriteDenied, internalEngineFetch } from "../src/cited";
import type { Env } from "../src/env";
import worker from "../src/index";

const env = rawEnv as unknown as Env;
const ORIGIN = "https://example.com";
const TOKEN = "test-cited-token";
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const bearer = { authorization: `Bearer ${TOKEN}` };

/** The test bindings with some settings changed; undefined removes one. */
function withEnv(patch: Partial<Record<keyof Env, string | undefined>>): Env {
  const out: Record<string, unknown> = { ...env };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as unknown as Env;
}

describe("CITED engine mounted at /api/cited", () => {
  it("answers health with its own PayPal mode", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/cited/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, app: "engine", paypalMode: "simulated" });
  });

  it("reaches the engine's tables in the shared database", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/cited/api/clock`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("now");
  });

  it("leaves Pact's routes alone", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/health`);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("CITED writes are locked on the deployed worker", () => {
  const writes: [string, unknown][] = [
    ["/api/cited/api/clock/advance", { days: 30 }],
    ["/api/cited/api/payouts/run", {}],
    ["/api/cited/api/cycle/close", {}],
    ["/api/cited/api/credits/recompute", {}],
    ["/api/cited/api/approvals/x/approve", { brandId: "winix", amountMinor: 100 }],
    ["/api/cited/api/brands", { brandId: "x" }],
    ["/api/cited/api/brands/winix/deposits", { amountMinor: 100 }],
    ["/api/cited/api/sessions", {}],
    ["/catalogue/sellers/lumen/refunds", { captureId: "CAP-1" }],
    ["/catalogue/mock/disputes", { captureId: "CAP-1" }],
    ["/catalogue/mock/disputes/D-1/resolve", {}],
    ["/catalogue/demo/advance-days", { days: 30 }],
  ];

  it("refuses every write without the token, and a wrong one", async () => {
    for (const [path, body] of writes) {
      const anon = await SELF.fetch(`${ORIGIN}${path}`, json(body));
      expect([path, anon.status]).toEqual([path, 401]);
      const wrong = await SELF.fetch(`${ORIGIN}${path}`, json(body, { authorization: "Bearer x" }));
      expect([path, wrong.status]).toEqual([path, 401]);
    }
  });

  it("refuses them with 503 when no token is configured, instead of opening up", async () => {
    const unset = withEnv({ CITED_API_TOKEN: undefined });
    for (const [path, body] of writes) {
      const res = await worker.request(path, json(body), unset, createExecutionContext());
      expect([path, res.status]).toEqual([path, 503]);
    }
    const read = await worker.request("/api/cited/api/clock", {}, unset, createExecutionContext());
    expect(read.status).toBe(200);
  });

  it("opens keylessly only on the explicit opt-in, and never while a token is set", () => {
    const post = new Request(`${ORIGIN}/api/cited/api/payouts/run`, { method: "POST" });
    const none = withEnv({ CITED_API_TOKEN: undefined, CITED_OPEN_API: undefined });
    const optIn = withEnv({ CITED_API_TOKEN: undefined, CITED_OPEN_API: "1" });
    const tokenAndOptIn = withEnv({ CITED_OPEN_API: "1" });
    expect(citedWriteDenied(none, post)?.status).toBe(503);
    expect(
      citedWriteDenied(withEnv({ CITED_API_TOKEN: undefined, CITED_OPEN_API: "true" }), post)
        ?.status,
    ).toBe(503);
    expect(citedWriteDenied(optIn, post)).toBeNull();
    expect(citedEnv(optIn).ENGINE_OPEN_API).toBe("1");
    expect(citedWriteDenied(tokenAndOptIn, post)?.status).toBe(401);
    expect(citedEnv(tokenAndOptIn).ENGINE_OPEN_API).toBeUndefined();
    expect(citedEnv(none).ENGINE_OPEN_API).toBeUndefined();
    expect(citedEnv(env, "internal")).toMatchObject({ ENGINE_OPEN_API: "1" });
  });

  it("accepts writes with the token", async () => {
    const res = await SELF.fetch(
      `${ORIGIN}/api/cited/api/brands`,
      json(
        { brandId: "lockbrand", name: "Lock Brand", category: "purifier", upc: "012345678929" },
        bearer,
      ),
    );
    expect(res.status).toBe(201);
    const recompute = await SELF.fetch(`${ORIGIN}/api/cited/api/credits/recompute`, {
      method: "POST",
      headers: bearer,
    });
    expect(recompute.status).toBe(200);
  });

  it("keeps reads, webhooks' signature check and the read-only catalogue public", async () => {
    for (const path of [
      "/api/cited/api/brands",
      "/api/cited/api/lift",
      "/api/cited/api/credits",
      "/api/cited/api/payouts",
      "/api/cited/api/journeys",
      "/catalogue/offers",
      "/catalogue/mock/state",
      "/studio/api/data",
    ]) {
      expect([path, (await SELF.fetch(`${ORIGIN}${path}`)).status]).toEqual([path, 200]);
    }
    // An unsigned webhook is rejected by its signature check, not by the API token.
    const hook = await SELF.fetch(`${ORIGIN}/api/cited/webhooks/paypal`, json({}));
    expect(hook.status).not.toBe(401);
    expect(hook.status).not.toBe(503);
  });

  it("lets Studio's server-side approval reach the engine with no token on the request", async () => {
    await SELF.fetch(
      `${ORIGIN}/api/cited/api/brands`,
      json(
        { brandId: "approvebrand", name: "Approve", category: "purifier", upc: "012345678936" },
        bearer,
      ),
    );
    const approve = createEngineApprover({
      baseUrl: "https://engine.internal",
      fetch: internalEngineFetch(env, createExecutionContext()),
    });
    const deposit = await approve({
      approvalId: "analyst-lock-1",
      brandId: "approvebrand",
      amountMinor: 50_000,
    });
    expect(deposit).toMatchObject({ status: "captured", amountMinor: 50_000 });
  });
});
