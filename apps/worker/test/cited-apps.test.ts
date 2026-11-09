import { SELF } from "cloudflare:test";
import { env as rawEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { d1RunSource, prefixLinks } from "../src/cited-apps";

const env = rawEnv as unknown as { DB: D1Database };
const get = (path: string, init?: RequestInit) => SELF.fetch(`https://example.com${path}`, init);

describe("prefixLinks", () => {
  it("prefixes root-relative links and the checkout base, leaves the rest", () => {
    const html = `<a href="/northwind">N</a><a href="#">x</a><a href="https://a.b/">y</a><script>const base="/"+cfg.shop+"/api/orders";</script>`;
    expect(prefixLinks(html, "/shops")).toBe(
      `<a href="/shops/northwind">N</a><a href="#">x</a><a href="https://a.b/">y</a><script>const base="/shops/"+cfg.shop+"/api/orders";</script>`,
    );
  });
});

describe("CITED demo apps mounted in pact-worker", () => {
  it("serves a storefront whose links stay under /shops", async () => {
    const res = await get("/shops/northwind");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="/shops/northwind/p/');
    expect(html).not.toMatch(/href="\/northwind/);
    expect(res.headers.get("content-security-policy")).toContain("'unsafe-inline'");
  });

  it("checks out through the PayPal mock and delivers the webhooks to the engine", async () => {
    const products = (await (await get("/shops/lumen/api/products")).json()) as {
      products: { upc: string }[];
    };
    const upc = products.products[0]?.upc;
    const order = (await (
      await get("/shops/lumen/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ upc, clientRef: "test-cart" }),
      })
    ).json()) as { orderId: string };
    const cap = await get(`/shops/lumen/api/orders/${order.orderId}/capture`, { method: "POST" });
    expect(cap.status).toBe(200);
    const state = (await (await get("/shops/mock/state")).json()) as {
      failedDeliveries: unknown[];
      webhooksDelivered: number;
    };
    expect(state.failedDeliveries).toEqual([]);
    expect(state.webhooksDelivered).toBeGreaterThan(0);
  });

  it("serves the catalogue's health and the console from D1 run records", async () => {
    expect((await get("/catalogue/health")).status).toBe(200);
    const record = {
      request: "a purifier",
      status: "purchased",
      model: "fake-sonnet",
      arm: "test",
    };
    await env.DB.prepare("INSERT INTO cited_agent_runs (record) VALUES (?)")
      .bind(JSON.stringify(record))
      .run();
    const runs = await d1RunSource(env.DB).runs();
    expect(runs.map((r) => r.request)).toContain("a purifier");
    expect((await get("/console")).status).toBe(200);
    expect((await get("/console/api/demo")).status).toBe(200);
  });
});
