import { SELF } from "cloudflare:test";
import { env as rawEnv } from "cloudflare:workers";
import { assignArm } from "@cited/catalogue-mcp";
import {
  armProbabilities,
  DEFAULT_SCHEDULE,
  LIVE_CATEGORY,
  UPC_BOSE_QC,
  UPC_LEVOIT_CORE300,
  UPC_ROBOROCK_Q7MAX,
  UPC_ROOMBA_J5,
  UPC_SONY_XM5,
  UPC_WINIX_A230,
} from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { CATALOGUE_SEED, sessionIdsFor } from "../src/live/arms";
import { parseCategory, TRY_CATEGORIES } from "../src/live/categories";
import { liveAgentChoice } from "../src/live/provider";
import { cleanRequest, type PairEvent, type PairLane } from "../src/live/routes";
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

  it("credits a funded robot-vacuum test sale to CrumbLab the same way", () => {
    const v = liveVerdict(
      {
        ...sale,
        upc: UPC_ROBOROCK_Q7MAX,
        amount: { amountMinor: 29599, currency: "USD" },
        creatorsSeen: ["crumblab"],
      },
      { brand: { brandId: "roborock", name: "Roborock" }, causedUnits: 5 },
    );
    expect(v.credited).toBe(true);
    expect(v.credits).toEqual([
      { creatorId: "crumblab", amount: { amountMinor: 2367, currency: "USD" } },
    ]);
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

  it("never credits more than the brand's deposit has left", () => {
    // The commission on a $95.99 sale is $7.67 (767 minor units, rounded down).
    const short = liveVerdict(sale, { ...funded, availableMinor: 766 });
    expect(short.credited).toBe(false);
    expect(short.why).toMatch(/top it up/);
    expect(short.brandId).toBe("winix");
    expect(liveVerdict(sale, { ...funded, availableMinor: 767 }).credited).toBe(true);
    // Unknown balance: the check is skipped, not guessed.
    expect(liveVerdict(sale, funded).credited).toBe(true);
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

describe("/try side by side", () => {
  it("picks catalogue session ids whose bucket lands in the wanted arm on any day", () => {
    const sched = (day: number) => armProbabilities(day, DEFAULT_SCHEDULE);
    for (const arm of ["test", "none"] as const) {
      const ids = sessionIdsFor(arm, "livex", 6);
      expect(ids).toHaveLength(6);
      for (const id of ids)
        for (const day of [0, 3, 7, 30])
          expect(assignArm(CATALOGUE_SEED, id, day, DEFAULT_SCHEDULE)).toBe(arm);
    }
    expect(sched(30).none).toBeGreaterThan(0);
  });

  it("runs two scripted agents at once: test lane buys the Winix, held out does not; same offers", async () => {
    const res = await get("/try/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "Small bedroom purifier, around $100, just buy it" }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const ev = (await events(res)) as unknown as PairEvent[];
    expect(ev.at(-1)?.type).toBe("end");
    const lane = (l: PairLane) =>
      ev.filter((e): e is LiveEvent & { lane: PairLane } => "lane" in e && e.lane === l);
    const results = (l: PairLane) => lane(l).find((e) => e.type === "results");
    const paid = (l: PairLane) => lane(l).find((e) => e.type === "paid");

    const t = results("test"),
      h = results("held");
    expect(t?.type === "results" && t.arm).toBe("test");
    expect(h?.type === "results" && h.arm).toBe("none");
    expect(t?.type === "results" && t.content.map((c) => c.kind)).toEqual(["test"]);
    expect(h?.type === "results" && h.content).toEqual([]);
    // Ranking is identical across arms.
    expect(t?.type === "results" && t.offers).toEqual(h?.type === "results" && h.offers);

    expect(paid("test")?.type === "paid" && paid("test")).toMatchObject({ upc: UPC_WINIX_A230 });
    expect(paid("held")?.type === "paid" && paid("held")).toMatchObject({
      upc: UPC_LEVOIT_CORE300,
    });
    for (const l of ["test", "held"] as const) {
      expect(lane(l).find((e) => e.type === "start")).toMatchObject({ scripted: true });
      expect(lane(l).at(-1)?.type).toBe("done");
    }

    const rows = await env.DB.prepare(
      "SELECT record FROM cited_live_runs WHERE record LIKE '%pair_%'",
    ).all<{ record: string }>();
    const records = rows.results.map((r) => JSON.parse(r.record));
    expect(records.map((r) => r.forcedArm).sort()).toEqual(["none", "test"]);
    expect(new Set(records.map((r) => r.pairId)).size).toBe(1);
    for (const r of records) expect(r).toMatchObject({ source: "live", status: "purchased" });
    const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE category = ?")
      .bind(LIVE_CATEGORY)
      .first<{ n: number }>();
    expect(live?.n).toBeGreaterThanOrEqual(2);
  });
});

describe("/try categories", () => {
  const post = (path: string, body: unknown) =>
    get(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const pair = async (body: unknown) => {
    const ev = (await events(await post("/try/pair", body))) as unknown as PairEvent[];
    const lane = (l: PairLane) =>
      ev.filter((e): e is LiveEvent & { lane: PairLane } => "lane" in e && e.lane === l);
    return {
      ev,
      results: (l: PairLane) => lane(l).find((e) => e.type === "results"),
      paid: (l: PairLane) => lane(l).find((e) => e.type === "paid"),
      verdict: (l: PairLane) => lane(l).find((e) => e.type === "verdict"),
    };
  };

  it("parses a category: absent is purifiers, unknown is refused", () => {
    expect(parseCategory(undefined)).toBe("purifier");
    expect(parseCategory("")).toBe("purifier");
    expect(parseCategory("headphones")).toBe("headphones");
    expect(parseCategory("robot-vacuum")).toBe("robot-vacuum");
    expect(parseCategory("toasters")).toBeNull();
    expect(parseCategory(7)).toBeNull();
  });

  it("every example names its category and states a budget the sellers meet", () => {
    for (const c of TRY_CATEGORIES) {
      for (const ex of c.examples) {
        expect(cleanRequest(ex)).toBe(ex);
        expect(ex).toMatch(/\$\d+/);
      }
    }
  });

  it("serves the purifier page by default, unchanged, with a three-way picker and no 'arm' in the text", async () => {
    const html = await (await get("/try")).text();
    expect(html).toContain("Small bedroom purifier, light sleeper, around $100, just buy it");
    expect(html).toContain("Sees HouseFresh's test of the Winix A230");
    expect(html).toMatch(/<input type="radio" name="category" value="purifier" checked>/);
    for (const c of TRY_CATEGORIES) expect(html).toContain(`value="${c.id}"`);
    expect(html).toContain("Test group");
    // No visible "arm": strip scripts, styles and tags, then look at the words.
    const visible = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ");
    expect(visible).not.toMatch(/\barms?\b/i);
    expect(html).not.toMatch(/Test arm/);
  });

  it("opens on another category with its default request, placeholder, examples and creator", async () => {
    const html = await (await get("/try?category=robot-vacuum")).text();
    expect(html).toContain(
      ">Robot vacuum for a small apartment with pets, under $300, just buy it</textarea>",
    );
    expect(html).toContain('placeholder="e.g. Robot vacuum for a small apartment');
    expect(html).toMatch(/value="robot-vacuum" checked/);
    expect(html).toContain("Sees CrumbLab's test of the Roborock Q7 Max");
    expect(html).toContain("Roborock picks over five pairs");
    const hp = await (await get("/try?category=headphones")).text();
    expect(hp).toContain("Sees QuietBench's test of the Bose QuietComfort Headphones");
    // An unknown category falls back to the default page.
    const odd = await (await get("/try?category=toasters")).text();
    expect(odd).toMatch(/value="purifier" checked/);
  });

  it("refuses an unknown category before any run starts", async () => {
    for (const path of ["/try/pair", "/try/run"]) {
      const res = await post(path, { request: "a purifier", category: "toasters" });
      expect(res.status).toBe(400);
    }
  });

  it("the default and an explicit purifier category run the same pair", async () => {
    const a = await pair({ request: "Small bedroom purifier, around $100, just buy it" });
    const b = await pair({
      request: "Small bedroom purifier, around $100, just buy it",
      category: "purifier",
    });
    for (const r of [a, b]) {
      expect(r.paid("test")).toMatchObject({ upc: UPC_WINIX_A230 });
      expect(r.paid("held")).toMatchObject({ upc: UPC_LEVOIT_CORE300 });
      const t = r.results("test");
      expect(t?.type === "results" && t.content.map((c) => c.creatorId)).toEqual(["housefresh"]);
    }
    const ta = a.results("test");
    const tb = b.results("test");
    expect(ta?.type === "results" && ta.offers).toEqual(tb?.type === "results" && tb.offers);
  });

  it("robot vacuums: the test group reads CrumbLab's test and buys the Roborock, held out buys the Roomba", async () => {
    const r = await pair({
      request: "Robot vacuum for a small apartment with pets, under $300, just buy it",
      category: "robot-vacuum",
    });
    const t = r.results("test");
    const h = r.results("held");
    expect(t?.type === "results" && t.arm).toBe("test");
    expect(h?.type === "results" && h.arm).toBe("none");
    expect(t?.type === "results" && t.content.map((c) => [c.kind, c.creatorId])).toEqual([
      ["test", "crumblab"],
    ]);
    expect(t?.type === "results" && t.content[0]?.disclosure).toContain("CrumbLab");
    expect(h?.type === "results" && h.content).toEqual([]);
    expect(t?.type === "results" && t.offers.every((o) => /Roborock|iRobot/.test(o.product))).toBe(
      true,
    );
    // Ranking is identical across groups.
    expect(t?.type === "results" && t.offers).toEqual(h?.type === "results" && h.offers);
    expect(r.paid("test")).toMatchObject({ upc: UPC_ROBOROCK_Q7MAX });
    expect(r.paid("held")).toMatchObject({ upc: UPC_ROOMBA_J5 });
    // The lane's passport is probed in its own category: it names CrumbLab and nobody else.
    expect(t?.type === "results" && t.creatorsSeen).toEqual(["crumblab"]);
    expect(h?.type === "results" && h.creatorsSeen).toEqual([]);
    // No programme is funded for these products in this database, so the sale is not credited.
    const v = r.verdict("test");
    expect(v?.type === "verdict" && v.verdict.credited).toBe(false);
    expect(v?.type === "verdict" && v.verdict.why).toMatch(/no brand funds a programme/);
  });

  it("headphones: the test group reads QuietBench's test and buys the Bose, held out buys the Sony", async () => {
    const r = await pair({
      request:
        "Noise-cancelling headphones for a noisy commute and video calls, under $350, just buy it",
      category: "headphones",
    });
    const t = r.results("test");
    expect(t?.type === "results" && t.content.map((c) => c.creatorId)).toEqual(["quietbench"]);
    expect(t?.type === "results" && t.creatorsSeen).toEqual(["quietbench"]);
    expect(t?.type === "results" && t.content[0]?.disclosure).toContain("QuietBench");
    expect(r.results("held")).toMatchObject({ content: [] });
    expect(r.paid("test")).toMatchObject({ upc: UPC_BOSE_QC });
    expect(r.paid("held")).toMatchObject({ upc: UPC_SONY_XM5 });
  });

  it("live sessions in every category stay out of the study and are recorded with their category", async () => {
    await pair({
      request: "Robot vacuum for a small apartment with pets, under $300, just buy it",
      category: "robot-vacuum",
    });
    const rows = await env.DB.prepare("SELECT record FROM cited_live_runs").all<{
      record: string;
    }>();
    const cats = new Set(rows.results.map((r) => JSON.parse(r.record).category));
    expect(cats.has("robot-vacuum")).toBe(true);
    const study = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM agent_sessions WHERE category NOT IN (?)",
    )
      .bind(LIVE_CATEGORY)
      .first<{ n: number }>();
    expect(study?.n).toBe(0);
    const demoRuns = await env.DB.prepare("SELECT COUNT(*) AS n FROM cited_agent_runs").first<{
      n: number;
    }>();
    expect(demoRuns?.n).toBe(0);
  });
});
