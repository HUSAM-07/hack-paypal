import { createMockPayPal, createPayPal } from "@pact/paypal";
import { verifyPassport } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { type CatalogueCallEnv, createCatalogueApp } from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON-RPC test responses
type Rpc = any;

const KEY = "test-passport-key";
const FIXED = "trysessionfixed01";

/** A catalogue in `mode`, with PayPal injected (no network) so sandbox mode needs no keys. */
function app(mode: "sandbox" | "simulated") {
  const mock = createMockPayPal();
  return createCatalogueApp({
    env: { PAYPAL_MODE: mode, PASSPORT_SIGNING_KEY: KEY },
    paypal: createPayPal({
      env: "sandbox",
      clientId: "id",
      clientSecret: "secret",
      fetch: mock.fetch,
    }),
    buyerVaultId: mock.vaultWallet({ email: "buyer@agent.example" }).id,
  });
}

/** The session id in the passport a `search_product` call with `sessionId: FIXED` returns. */
async function sessionOf(
  catalogue: ReturnType<typeof app>,
  callEnv?: CatalogueCallEnv,
): Promise<string> {
  const req = new Request("http://catalogue.local/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "search_product", arguments: { query: "air purifier", sessionId: FIXED } },
    }),
  });
  const res = (await (await catalogue.fetch(req, callEnv)).json()) as Rpc;
  const verified = await verifyPassport(res.result.structuredContent.passport, KEY);
  if (!verified.ok) throw new Error("passport did not verify");
  return verified.body.sessionId;
}

describe("who may pick a session id (and so the arm)", () => {
  it("in sandbox, a request from the internet cannot: its sessionId is ignored", async () => {
    expect(await sessionOf(app("sandbox"))).not.toBe(FIXED);
  });

  it("in sandbox, the worker's own trusted caller (/try's lanes) can", async () => {
    expect(await sessionOf(app("sandbox"), { trustedCaller: true })).toBe(FIXED);
  });

  it("simulated mode keeps allowing it for every caller (seeded runs are reproducible)", async () => {
    expect(await sessionOf(app("simulated"))).toBe(FIXED);
  });
});
