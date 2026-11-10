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
    // The seller's refund is a demo control: locked without the CITED token.
    const refundBody = JSON.stringify({ captureId: bought.captureId });
    const anon = await get("/catalogue/sellers/lumen/refunds", {
      method: "POST",
      body: refundBody,
    });
    expect(anon.status).toBe(401);
    const refund = await get("/catalogue/sellers/lumen/refunds", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-cited-token" },
      body: refundBody,
    });
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

describe("AG Studio on the hosted demo", () => {
  const studio = (path: string, kind: string, cookie?: string, body?: unknown) =>
    get(`/studio/api${path}`, {
      method: "POST",
      headers: {
        "x-studio": kind,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
  const ledger = async () =>
    Promise.all(
      ["/credits", "/deposits", "/review-flags", "/payouts"].map(async (p) =>
        (await get(`/api/cited/api${p}`)).text(),
      ),
    );

  it("a visitor's Approve, Release and Void never change the shared ledger", async () => {
    // One guard hold, as the demo leaves it: a self-purchase credit waiting for a reviewer.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO creators (creator_id, name, paypal_id) VALUES ('housefresh', 'HouseFresh', 'hf@example.com')",
      ),
      env.DB.prepare(
        `INSERT INTO credits (id, capture_id, creator_id, brand_id, upc, amount_minor, currency,
           state, void_reason, hold_until, payout_batch_id, payout_status, created_at)
         VALUES ('CAPV:housefresh', 'CAPV', 'housefresh', 'winix', 'W', 768, 'USD', 'pending',
           NULL, '2026-12-01T00:00:00Z', NULL, NULL, '2026-11-01T00:00:00Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO review_flags (credit_id, capture_id, reason, id, status, detail, created_at)
         VALUES ('CAPV:housefresh', 'CAPV', 'self_purchase', 'self_purchase:CAPV:housefresh',
           'open', 'test', '2026-11-01T00:00:00Z')`,
      ),
    ]);
    const before = await ledger();

    const config = (await (await get("/studio/api/config")).json()) as {
      privateWrites: { ttlMinutes: number } | null;
    };
    expect(config.privateWrites).toEqual({ ttlMinutes: 30 });

    const approve = await studio("/analyst/approve", "approve", undefined, {
      approvalId: "analyst-1",
      brandId: "winix",
    });
    expect([200, 409]).toContain(approve.status);

    for (const action of ["release", "void"] as const) {
      const res = await studio(`/review-flags/self_purchase:CAPV:housefresh/${action}`, "review");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ private: true });
      const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      const mine = (await (await get("/studio/api/data", { headers: { cookie } })).json()) as {
        tables: { flags: { id: string; status: string }[] };
      };
      expect(
        mine.tables.flags.find((f) => f.id === "self_purchase:CAPV:housefresh")?.status,
      ).not.toBe("Waiting for a reviewer");
    }

    expect(await ledger()).toEqual(before);
    const flags = (await (await get("/api/cited/api/review-flags")).json()) as {
      flags: { id: string; status: string }[];
    };
    expect(flags.flags.find((f) => f.id === "self_purchase:CAPV:housefresh")?.status).toBe("open");
  });
});
