import { createPayPal } from "@pact/paypal";
import {
  type PassportBody,
  signPassport,
  UPC_LEVOIT_CORE300,
  UPC_WINIX_A230,
} from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { createShopsApp, priceAt, SHOP_IDS, simulatedPayPal } from "../src/index";

const SECRET = "test-secret";
const body: PassportBody = {
  v: 1,
  sessionId: "sess1",
  arm: "test",
  creatorsSeen: ["housefresh"],
  storesViewed: ["northwind"],
};

function setup() {
  const sim = simulatedPayPal();
  const paypal = createPayPal({
    env: "sandbox",
    clientId: "x",
    clientSecret: "y",
    fetch: sim.fetch,
  });
  const app = createShopsApp({ paypal, env: { PASSPORT_SECRET: SECRET } });
  const post = (path: string, json?: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
  return { sim, app, post };
}

describe("shop prices", () => {
  it("Lumen sells the Winix $4 cheaper than Northwind", () => {
    const n = priceAt("northwind", UPC_WINIX_A230);
    const l = priceAt("lumen", UPC_WINIX_A230);
    expect(n?.amountMinor).toBe(9999);
    expect(l?.amountMinor).toBe(9599);
  });
  it("every shop sells both products", () => {
    for (const s of SHOP_IDS) {
      expect(priceAt(s, UPC_WINIX_A230)).toBeDefined();
      expect(priceAt(s, UPC_LEVOIT_CORE300)).toBeDefined();
    }
  });
});

describe("agent checkout API", () => {
  it("creates and captures a simulated Lumen order carrying a valid passport and the UPC", async () => {
    const { sim, post } = setup();
    const passport = await signPassport(body, SECRET);
    const created = await post("/lumen/api/orders", { upc: UPC_WINIX_A230, passport });
    expect(created.status, await created.clone().text()).toBe(201);
    const order = (await created.json()) as { orderId: string; customId: string };
    expect(order.customId).toBe(passport);

    const raw = sim.created[0]?.body.purchase_units[0];
    expect(raw.custom_id).toBe(passport);
    expect(raw.items[0].upc).toEqual({ type: "UPC-A", code: UPC_WINIX_A230 });
    expect(raw.amount).toMatchObject({
      value: "95.99",
      breakdown: { item_total: { value: "95.99" } },
    });
    expect(sim.created[0]?.requestId).toMatch(/^cited-lumen-create-/);

    const captured = await post(`/lumen/api/orders/${order.orderId}/capture`);
    expect(await captured.json()).toMatchObject({ status: "COMPLETED", customId: passport });
  });

  it("works at all three shops", async () => {
    const { post } = setup();
    for (const shop of SHOP_IDS) {
      const r = await post(`/${shop}/api/orders`, { upc: UPC_LEVOIT_CORE300 });
      expect(r.status).toBe(201);
      const { orderId } = (await r.json()) as { orderId: string };
      expect((await post(`/${shop}/api/orders/${orderId}/capture`)).status).toBe(200);
    }
  });

  it("retries with the same clientRef reuse the order; capture is idempotent", async () => {
    const { sim, post } = setup();
    const a: any = await (
      await post("/northwind/api/orders", { upc: UPC_WINIX_A230, clientRef: "c1" })
    ).json();
    const b: any = await (
      await post("/northwind/api/orders", { upc: UPC_WINIX_A230, clientRef: "c1" })
    ).json();
    expect(b.orderId).toBe(a.orderId);
    expect(sim.orders.size).toBe(1);
    const c1: any = await (await post(`/northwind/api/orders/${a.orderId}/capture`)).json();
    const c2: any = await (await post(`/northwind/api/orders/${a.orderId}/capture`)).json();
    expect(c2.captureId).toBe(c1.captureId);
  });

  it("rejects forged passports, unknown products and bad quantities", async () => {
    const { post } = setup();
    const forged = `${(await signPassport(body, SECRET)).slice(0, -2)}xx`;
    expect(
      (await post("/lumen/api/orders", { upc: UPC_WINIX_A230, passport: forged })).status,
    ).toBe(400);
    expect((await post("/lumen/api/orders", { upc: "999" })).status).toBe(404);
    expect((await post("/lumen/api/orders", { upc: UPC_WINIX_A230, quantity: 0 })).status).toBe(
      400,
    );
  });
});

describe("storefronts", () => {
  it("serves visually distinct pages with prices and a checkout block", async () => {
    const { app } = setup();
    const html: Record<string, string> = {};
    for (const shop of SHOP_IDS) {
      const res = await app.request(`/${shop}/p/winix-a230`);
      expect(res.status).toBe(200);
      html[shop] = await res.text();
      expect(html[shop]).toContain("paypal-buttons");
    }
    expect(html.northwind).toContain("$99.99");
    expect(html.lumen).toContain("$95.99");
    expect(html.megamart).toContain("$104.99");
    expect(new Set(Object.values(html).map((h) => h.match(/<style>([^<]*)/)?.[1])).size).toBe(3);
    expect((await app.request("/lumen")).status).toBe(200);
    expect((await app.request("/nope")).status).toBe(404);
  });
});
