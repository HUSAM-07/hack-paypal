import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMockPayPal } from "@pact/paypal";
import { decodePassportBody, UPC_WINIX_A230 } from "@pact/protocol";
import { expect, it } from "vitest";
import { createCatalogueApp } from "../src/index";
import { createPublicMcp, type PublicMcpLimits } from "../src/public";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed tool results
type Json = any;

function setup(limits?: Partial<PublicMcpLimits>) {
  const mock = createMockPayPal();
  const events: string[] = [];
  mock.registerWebhook((d) => void events.push(d.event.event_type));
  const app = createCatalogueApp({ env: { PAYPAL_MODE: "simulated" }, mock });
  const mcp = limits
    ? createPublicMcp({
        catalogue: app.catalogue,
        paypal: undefined as never,
        buyerVaultId: undefined,
        limits,
      })
    : app.publicMcp;
  const fetchMcp = (async (input: string | URL | Request, init?: RequestInit) =>
    mcp.handle(new Request(input, init))) as typeof fetch;
  const connect = async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("https://cited.test/mcp"), { fetch: fetchMcp }),
    );
    return client;
  };
  return { app, mock, events, mcp, connect, fetchMcp };
}

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as Json;

it("an MCP client searches and checks out; the passport is minted per session as mcp_", async () => {
  const { mock, events, connect, mcp } = setup();
  const client = await connect();
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(["search_product", "checkout", "get_order"]);
  expect(tools[0]?.description).toContain("16 CFR 255");

  const found = (await call(client, "search_product", { query: "air purifier", sellerId: "lumen" }))
    .structuredContent;
  expect(found.offers).toHaveLength(6);
  expect(found.passport).toBeUndefined();
  for (const t of found.creatorContent) expect(t.disclosure.length).toBeGreaterThan(0);

  const offer = found.offers.find((o: Json) => o.seller.id === "lumen" && o.upc === UPC_WINIX_A230);
  const bought = (await call(client, "checkout", { offerId: offer.offerId })).structuredContent;
  expect(bought).toMatchObject({ status: "COMPLETED", seller: { id: "lumen" } });
  const body = decodePassportBody(String(bought.customId).split(".")[0] as string);
  expect(body.sessionId).toMatch(/^mcp_[0-9a-f]{16}$/);
  expect(body.storesViewed).toEqual(["lumen"]);
  expect(mock.state.captures.size).toBe(1);
  expect(events).toEqual(["CHECKOUT.ORDER.COMPLETED", "PAYMENT.CAPTURE.COMPLETED"]);

  // Asking again for the same offer returns the same order: no double charge.
  const again = (await call(client, "checkout", { offerId: offer.offerId })).structuredContent;
  expect(again.orderId).toBe(bought.orderId);
  expect(mcp.stats()).toEqual({ sessions: 1, checkouts: 1 });

  // A second MCP session is a second shopping session with its own passport.
  const other = await connect();
  const early = await call(other, "checkout", { offerId: offer.offerId });
  expect(early.content[0].text).toContain("search_first");
  await call(other, "search_product", { query: "purifier" });
  const theirs = (await call(other, "checkout", { offerId: offer.offerId })).structuredContent;
  expect(decodePassportBody(String(theirs.customId).split(".")[0] as string).sessionId).not.toBe(
    body.sessionId,
  );

  // get_order (PayPal Agent Toolkit) reads a session's own orders, and only those.
  const status = (await call(client, "get_order", { orderId: bought.orderId })).structuredContent;
  expect(status).toMatchObject({ orderId: bought.orderId, status: "COMPLETED", sellerId: "lumen" });
  expect(status.customId).toBe(bought.customId);
  const peek = await call(other, "get_order", { orderId: bought.orderId });
  expect(peek.content[0].text).toContain("unknown_order");
});

it("ranks the same offers in every session, whatever the arm", async () => {
  const { connect } = setup();
  const seen = new Map<string, string>();
  for (let i = 0; i < 12; i++) {
    const client = await connect();
    const r = (await call(client, "search_product", { query: "purifier" })).structuredContent;
    const ids = r.offers.map((o: Json) => o.offerId).join(",");
    seen.set(String(r.creatorContent.map((t: Json) => t.kind)), ids);
  }
  expect(new Set(seen.values()).size).toBe(1);
});

it("caps orders per session and refuses forged or oversized input", async () => {
  const { connect, app } = setup();
  const client = await connect();
  await call(client, "search_product", { query: "purifier" });
  const ids = app.catalogue.offers.map((o) => o.offerId);
  const bad = await call(client, "checkout", { offerId: "<script>" });
  expect(bad.isError).toBe(true);
  const unknown = await call(client, "checkout", { offerId: "nope-000000000000" });
  expect(unknown.content[0].text).toContain("unknown_offer");
  for (const id of ids.slice(0, 3)) {
    expect((await call(client, "checkout", { offerId: id })).isError).toBeFalsy();
  }
  const fourth = await call(client, "checkout", { offerId: ids[3] });
  expect(fourth.isError).toBe(true);
  expect(fourth.content[0].text).toContain("limit_reached");
});

it("refuses unknown sessions, GET streams and too many sessions", async () => {
  const { connect, fetchMcp } = setup({ maxSessions: 1 });
  const res = await fetchMcp("https://cited.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": "made-up",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(res.status).toBe(404);
  expect((await fetchMcp("https://cited.test/mcp", { method: "GET" })).status).toBe(405);
  await connect();
  await expect(connect()).rejects.toThrow();
});
