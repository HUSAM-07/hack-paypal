import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { AGENT_TOOLKIT_VERSION, createMockPayPal, createPayPal } from "@pact/paypal";
import { UPC_WINIX_A230 } from "@pact/protocol";
import { expect, it } from "vitest";
import { createCatalogueApp } from "../src/index";

/** Every PayPal call the platform makes, tagged by whether the Agent Toolkit sent it. */
function setup() {
  const mock = createMockPayPal();
  const calls: string[] = [];
  const paypal = createPayPal({
    env: "sandbox",
    clientId: "mock-client-id",
    clientSecret: "mock-client-secret",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname !== "/v1/oauth2/token") {
        const viaToolkit = new Headers(init?.headers)
          .get("user-agent")
          ?.startsWith("PayPal Agent Toolkit");
        const path = url.pathname.replace(/\/[A-Z0-9-]{10,}/g, "/:id");
        calls.push(`${viaToolkit ? "toolkit" : "client"} ${init?.method ?? "GET"} ${path}`);
      }
      return mock.fetch(input, init);
    },
  });
  const buyerVaultId = mock.vaultWallet().id;
  const app = createCatalogueApp({ env: { PAYPAL_MODE: "simulated" }, paypal, buyerVaultId });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { calls, post };
}

it("checks out with our Orders v2 call, then reads back and refunds with the Agent Toolkit", async () => {
  const { calls, post } = setup();
  const res = await post("/checkout", { offerId: `lumen-${UPC_WINIX_A230}` });
  expect(res.status).toBe(201);
  const bought = (await res.json()) as { captureId: string; status: string };
  expect(bought.status).toBe("COMPLETED");
  expect(calls).toEqual([
    // create_order has no payee / custom_id / upc / vaulted payment_source: our client.
    "client POST /v2/checkout/orders",
    "toolkit GET /v2/checkout/orders/:id",
  ]);
  expect((await post("/sellers/lumen/refunds", { captureId: bought.captureId })).status).toBe(200);
  expect(calls.at(-1)).toBe("toolkit POST /v2/payments/captures/:id/refund");
});

it("runs the Agent Toolkit version the bridge was written against", () => {
  // The package has no "./package.json" export: read it next to its resolved entry.
  const entry = createRequire(import.meta.url).resolve("@paypal/agent-toolkit/mcp");
  const pkg = JSON.parse(readFileSync(join(dirname(entry), "..", "package.json"), "utf8")) as {
    version: string;
  };
  expect(pkg.version).toBe(AGENT_TOOLKIT_VERSION);
});
