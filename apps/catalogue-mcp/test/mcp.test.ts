import { createMockPayPal } from "@pact/paypal";
import { UPC_WINIX_A230, verifyPassport } from "@pact/protocol";
import { expect, it } from "vitest";
import { createCatalogueApp } from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON-RPC test responses
type Rpc = any;

function setup() {
  const mock = createMockPayPal();
  const events: string[] = [];
  mock.registerWebhook((d) => void events.push(d.event.event_type));
  const app = createCatalogueApp({ env: { PAYPAL_MODE: "simulated" }, mock });
  let id = 0;
  const rpc = async (method: string, params?: unknown) =>
    (await (
      await app.request("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      })
    ).json()) as Rpc;
  const call = async (name: string, args: unknown) =>
    (await rpc("tools/call", { name, arguments: args })).result;
  return { app, mock, events, rpc, call };
}

it("serves search_product and checkout over streamable HTTP", async () => {
  const { rpc, call } = setup();
  const list = await rpc("tools/list");
  expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
    "search_product",
    "checkout",
  ]);
  const out = (await call("search_product", { query: "air purifier" })).structuredContent;
  expect(out.offers.length).toBe(6);
  expect((await verifyPassport(out.passport, "cited-dev-passport-key")).ok).toBe(true);
});

it("checks out through PayPal: seller as payee, passport in custom_id, buyer's vaulted wallet", async () => {
  const { mock, events, call } = setup();
  const found = (await call("search_product", { query: "air purifier", sellerId: "northwind" }))
    .structuredContent;
  const offer = found.offers.find((o: Rpc) => o.seller.id === "lumen" && o.upc === UPC_WINIX_A230);
  const bought = (
    await call("checkout", { offerId: offer.offerId, passport: found.passport, clientRef: "c1" })
  ).structuredContent;
  expect(bought).toMatchObject({
    status: "COMPLETED",
    upc: UPC_WINIX_A230,
    seller: { id: "lumen", name: "Lumen" },
    total: { amountMinor: 9599, currency: "USD" },
    customId: found.passport,
  });
  const order = mock.state.orders.get(bought.orderId);
  expect(order?.vaultId).toBeTruthy();
  const unit = order?.units[0] as Rpc;
  expect(unit.payee).toEqual(offer.seller.payee);
  expect(unit.reference_id).toBe("lumen");
  expect(unit.items[0].upc).toEqual({ type: "UPC-A", code: UPC_WINIX_A230 });
  expect(mock.state.captures.get(bought.captureId)?.customId).toBe(found.passport);
  expect(events).toEqual(["CHECKOUT.ORDER.COMPLETED", "PAYMENT.CAPTURE.COMPLETED"]);

  // A retry with the same clientRef pays nothing twice.
  const again = (
    await call("checkout", { offerId: offer.offerId, passport: found.passport, clientRef: "c1" })
  ).structuredContent;
  expect(again.orderId).toBe(bought.orderId);
  expect(mock.state.captures.size).toBe(1);
});

it("refuses forged passports and unknown offers", async () => {
  const { call } = setup();
  const forged = await call("checkout", {
    offerId: `lumen-${UPC_WINIX_A230}`,
    passport: "v1|abc|test||.AAAAAAAAAAAAAAAA",
  });
  expect(forged.isError).toBe(true);
  expect((await call("checkout", { offerId: "nope" })).isError).toBe(true);
});

it("lets only the seller refund its sale, emitting the refund webhook", async () => {
  const { app, mock, events } = setup();
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const bought = (await (
    await post("/checkout", { offerId: `lumen-${UPC_WINIX_A230}` })
  ).json()) as Rpc;
  const captureId = bought.captureId;
  expect((await post("/sellers/northwind/refunds", { captureId })).status).toBe(403);
  expect((await post("/sellers/lumen/refunds", { captureId })).status).toBe(200);
  expect(events.at(-1)).toBe("PAYMENT.CAPTURE.REFUNDED");
  expect(mock.state.captures.get(captureId)?.refunded).toBe(9599);
  const state = (await (await app.request("/mock/state")).json()) as Rpc;
  expect(state.captures[0]).toMatchObject({ refunded: 9599, vaulted: true });
});

it("simulates a buyer's dispute and PayPal's decision as signed dispute webhooks", async () => {
  const { app, events } = setup();
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const bought = (await (
    await post("/checkout", { offerId: `lumen-${UPC_WINIX_A230}` })
  ).json()) as Rpc;
  expect((await post("/mock/disputes", { captureId: "nope" })).status).toBe(404);
  const opened = (await (
    await post("/mock/disputes", { captureId: bought.captureId })
  ).json()) as Rpc;
  expect(opened).toMatchObject({ captureId: bought.captureId, status: "OPEN" });
  expect(events.at(-1)).toBe("CUSTOMER.DISPUTE.CREATED");
  const path = `/mock/disputes/${opened.disputeId}/resolve`;
  expect((await post(path, { favour: "maybe" })).status).toBe(400);
  const resolved = (await (await post(path, { favour: "seller" })).json()) as Rpc;
  expect(resolved).toMatchObject({ status: "RESOLVED", outcome: "RESOLVED_SELLER_FAVOUR" });
  expect(events.at(-1)).toBe("CUSTOMER.DISPUTE.RESOLVED");
  const state = (await (await app.request("/mock/state")).json()) as Rpc;
  expect(state.disputes).toEqual([
    {
      id: opened.disputeId,
      captureId: bought.captureId,
      status: "RESOLVED",
      outcome: "RESOLVED_SELLER_FAVOUR",
    },
  ]);
});

it("needs a linked buyer wallet outside simulated mode", async () => {
  const app = createCatalogueApp({
    env: {
      PAYPAL_MODE: "sandbox",
      PAYPAL_CLIENT_ID: "x",
      PAYPAL_CLIENT_SECRET: "y",
      PASSPORT_SIGNING_KEY: "k",
    },
  });
  const res = await app.request("/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offerId: `lumen-${UPC_WINIX_A230}` }),
  });
  expect(res.status).toBe(409);
  expect((await app.request("/mock/state")).status).toBe(404);
});
