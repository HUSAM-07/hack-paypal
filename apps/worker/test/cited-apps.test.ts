import { SELF } from "cloudflare:test";
import { env as rawEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { d1RunSource, prefixLinks } from "../src/cited-apps";

const env = rawEnv as unknown as { DB: D1Database };
const get = (path: string, init?: RequestInit) => SELF.fetch(`https://example.com${path}`, init);

describe("prefixLinks", () => {
  it("prefixes root-relative links, leaves the rest", () => {
    const html = `<a href="/runs">N</a><a href="#">x</a><a href="https://a.b/">y</a>`;
    expect(prefixLinks(html, "/console")).toBe(
      `<a href="/console/runs">N</a><a href="#">x</a><a href="https://a.b/">y</a>`,
    );
  });
});

const post = (path: string, body: unknown) =>
  get(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("CITED demo apps mounted in pact-worker", () => {
  it("has no storefronts", async () => {
    expect((await get("/shops/northwind")).status).toBe(404);
  });

  it("an agent checks out through PayPal; capture and refund webhooks reach the engine", async () => {
    const { offers } = (await (await get("/catalogue/offers")).json()) as {
      offers: { offerId: string; seller: { id: string } }[];
    };
    const offer = offers.find((o) => o.seller.id === "lumen");
    const res = await post("/catalogue/checkout", {
      offerId: offer?.offerId,
      clientRef: "test-cart",
    });
    expect(res.status).toBe(201);
    const bought = (await res.json()) as { captureId: string; status: string };
    expect(bought.status).toBe("COMPLETED");
    const refund = await post("/catalogue/sellers/lumen/refunds", { captureId: bought.captureId });
    expect(refund.status).toBe(200);
    const state = (await (await get("/catalogue/mock/state")).json()) as {
      failedDeliveries: unknown[];
      webhooksDelivered: number;
      captures: { vaulted: boolean; refunded: number }[];
    };
    expect(state.failedDeliveries).toEqual([]);
    expect(state.webhooksDelivered).toBe(3);
    expect(state.captures[0]).toMatchObject({ vaulted: true });
    expect(state.captures[0]?.refunded).toBeGreaterThan(0);
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

  it("serves the AG Studio page under a strict CSP, and its API from live engine data", async () => {
    const page = await get("/studio/creator");
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    const config = await get("/studio/api/config");
    expect(config.status).toBe(200);
    expect(await config.json()).toMatchObject({ llm: { kind: expect.any(String) } });
    const data = await get("/studio/api/data");
    expect(data.status).toBe(200);
    expect(await data.json()).toHaveProperty("tables.brands");
  });
});
