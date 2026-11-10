import { SELF } from "cloudflare:test";
import { env as rawEnv } from "cloudflare:workers";
import { LIVE_CATEGORY, UPC_WINIX_A230 } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { liveAgentChoice } from "../src/live/provider";
import { cleanRequest } from "../src/live/routes";
import type { LiveEvent } from "../src/live/run";
import { type JoinedSale, liveVerdict } from "../src/live/verdict";

const env = rawEnv as unknown as { DB: D1Database };
const get = (path: string, init?: RequestInit) => SELF.fetch(`https://example.com${path}`, init);

describe("live agent provider switch", () => {
  it("prefers the gateway, then Anthropic, else the labelled scripted agent", () => {
    const gw = liveAgentChoice({
      LLM_BASE_URL: "http://gw/v1",
      LLM_API_KEY: "k",
      ANTHROPIC_API_KEY: "a",
    });
    expect(gw.kind).toBe("gateway");
    expect(gw.kind !== "scripted" && gw.llm.api).toBe("openai");
    expect(gw.model).toBe("claude-sonnet-5-5");

    const an = liveAgentChoice({ ANTHROPIC_API_KEY: "a", LLM_BASE_URL: "http://gw/v1" });
    expect(an.kind).toBe("anthropic");
    expect(an.kind !== "scripted" && an.llm).toMatchObject({
      api: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "a",
      maxSteps: 6,
      maxTokens: 700,
    });

    const none = liveAgentChoice({ ANTHROPIC_API_KEY: "" });
    expect(none).toEqual({
      kind: "scripted",
      model: "scripted",
      label: "scripted agent (no model key)",
    });
    expect(liveAgentChoice({ CITED_LIVE_MODEL: "m", ANTHROPIC_API_KEY: "a" }).model).toBe("m");
  });
});

describe("live verdict", () => {
  const sale: JoinedSale = {
    upc: UPC_WINIX_A230,
    amount: { amountMinor: 9599, currency: "USD" },
    arm: "test",
    creatorsSeen: ["housefresh"],
    capturedAt: "2026-11-10T12:00:00.000Z",
    unattributedReason: null,
  };
  const funded = { brand: { brandId: "winix", name: "Winix" }, causedUnits: 51 };

  it("credits a test-arm sale of a funded SKU with proven lift: 8%, held 30 days", () => {
    const v = liveVerdict(sale, funded);
    expect(v.credited).toBe(true);
    expect(v.credits).toEqual([
      { creatorId: "housefresh", amount: { amountMinor: 767, currency: "USD" } },
    ]);
    expect(v.holdUntil?.slice(0, 10)).toBe("2026-12-10");
  });

  it("never credits placebo, held-out, unverified, unfunded or unproven sales", () => {
    expect(liveVerdict({ ...sale, arm: "placebo" }, funded).credited).toBe(false);
    expect(liveVerdict({ ...sale, arm: "none", creatorsSeen: [] }, funded).credited).toBe(false);
    expect(
      liveVerdict({ ...sale, arm: null, unattributedReason: "bad_signature" }, funded).why,
    ).toMatch(/bad_signature/);
    expect(liveVerdict(sale, { brand: null, causedUnits: 0 }).credited).toBe(false);
    expect(liveVerdict(sale, { ...funded, causedUnits: 0 }).credited).toBe(false);
    expect(liveVerdict(null, funded).credited).toBe(false);
  });
});

describe("cleanRequest", () => {
  it("strips control characters and bounds the length", () => {
    expect(cleanRequest("  a\u0000 purifier\n please ")).toBe("a purifier please");
    expect(cleanRequest("x")).toBeNull();
    expect(cleanRequest("a".repeat(281))).toBeNull();
    expect(cleanRequest(42)).toBeNull();
  });
});

async function events(res: Response): Promise<LiveEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as LiveEvent);
}

describe("/try", () => {
  it("serves the page with its own CSP and the scripted-agent label when no key is set", async () => {
    const res = await get("/try");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    const html = await res.text();
    expect(html).toContain("scripted agent (no model key)");
    expect(html).toContain("Small bedroom purifier, light sleeper, around $100, just buy it");
  });

  it("rejects an empty request and a cross-site post", async () => {
    const bad = await get("/try/run", { method: "POST", body: JSON.stringify({ request: "" }) });
    expect(bad.status).toBe(400);
    const xsite = await get("/try/run", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ request: "a purifier" }),
    });
    expect(xsite.status).toBe(403);
  });

  it("runs the scripted agent end to end: arm, PayPal capture, engine join, verdict; tagged live", async () => {
    const res = await get("/try/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "Small bedroom purifier, around $100, just buy it" }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const ev = await events(res);
    const types = ev.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types).toEqual(
      expect.arrayContaining(["search", "results", "checkout", "paid", "joined", "verdict"]),
    );
    expect(types.at(-1)).toBe("done");

    const results = ev.find((e) => e.type === "results");
    const paid = ev.find((e) => e.type === "paid");
    const joined = ev.find((e) => e.type === "joined");
    expect(results && results.type === "results" && ["test", "placebo", "none"]).toContain(
      results?.type === "results" ? results.arm : "",
    );
    expect(paid?.type === "paid" && paid.captureId).toBeTruthy();
    expect(joined?.type === "joined" && joined.unattributedReason).toBeNull();
    // No programme is funded in this test database, so the sale is joined but not credited.
    const verdict = ev.find((e) => e.type === "verdict");
    expect(verdict?.type === "verdict" && verdict.verdict.credited).toBe(false);

    const session = await env.DB.prepare(
      "SELECT category FROM agent_sessions ORDER BY created_at DESC LIMIT 1",
    ).first<{ category: string }>();
    expect(session?.category).toBe(LIVE_CATEGORY);
    const row = await env.DB.prepare("SELECT record, provider FROM cited_live_runs").first<{
      record: string;
      provider: string;
    }>();
    expect(row?.provider).toBe("scripted");
    expect(JSON.parse(row?.record ?? "{}")).toMatchObject({
      source: "live",
      status: "purchased",
      scripted: true,
    });
    const demoRuns = await env.DB.prepare("SELECT COUNT(*) AS n FROM cited_agent_runs").first<{
      n: number;
    }>();
    expect(demoRuns?.n).toBe(0);
  });
});
