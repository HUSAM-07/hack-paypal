import { describe, expect, it } from "vitest";
import { points, recommend } from "../src/analyst";
import { createStudioApp, type RawEngine } from "../src/index";
import {
  parseTurn,
  type StudioLlmChoice,
  streamTurn,
  studioLlmChoice,
  toOpenAiMessages,
} from "../src/llm";
import { buildTables, inFirstPayout, type TableId } from "../src/tables";
import { raw } from "./fixture";

const row = (t: ReturnType<typeof buildTables>, table: TableId, id: string) =>
  t.tables[table]?.find((r) => r.id === id);

describe("buildTables", () => {
  const t = buildTables(raw);

  it("labels the first batch and matches credits by PayPal's or our batch id", () => {
    expect(t.firstBatch).toMatchObject({ senderBatchId: "cited-1", label: "Batch 1" });
    const c2 = raw.creators[0]?.credits[1];
    expect(c2 && inFirstPayout({ ...c2, creatorId: "housefresh" }, raw.payouts?.[0])).toBe(true);
    expect(row(t, "credits", "C2:housefresh")).toMatchObject({
      payoutBatch: "Batch 1",
      firstPayout: true,
    });
  });

  it("gives each brand a row per scope, money in dollars for display only", () => {
    expect(row(t, "brands", "winix:todate")).toMatchObject({ causedUnits: 2, paid: 7.68 });
    expect(row(t, "brands", "winix:first")).toMatchObject({ scopeKey: "first" });
    expect(row(t, "brands", "levoit:todate")).toMatchObject({ causedUnits: 0, paid: 0 });
  });

  it("scopes the arm strip like the tile: the first payout counts only its cycle's sessions", () => {
    const j = raw.journeys[0];
    if (!j) throw new Error("fixture has no journey");
    // A second-cycle sale, captured after the first batch's hold window closed.
    const later = { ...j, orderId: "O-later", capturedAt: "2026-12-20T00:00:00Z" };
    const s = buildTables({ ...raw, journeys: [...raw.journeys, later] });
    const testArm = (scope: string) => row(s, "arms", `winix:test:${scope}`);
    expect(testArm("first")).toMatchObject({ scopeKey: "first", sessions: 1, purchases: 1 });
    expect(testArm("todate")).toMatchObject({
      scopeKey: "todate",
      sessions: raw.lift[0]?.arms.test.sessions,
    });
  });

  it("writes text cells as – instead of blank, and a voided credit has no batch", () => {
    expect(row(t, "credits", "C1:housefresh")).toMatchObject({
      state: "voided",
      voidReason: "refund",
      payoutBatch: "–",
    });
    expect(row(t, "credits", "C2:housefresh")).toMatchObject({
      voidReason: "–",
      splitWith: "Other Lab $2.68",
    });
  });

  it("splits held-for-review credits out of pending and lists review flags", () => {
    const c2 = raw.creators[0]?.credits[1];
    if (!c2) throw new Error("fixture changed");
    const held = {
      ...c2,
      id: "C9:housefresh",
      captureId: "C9",
      state: "pending",
      payoutBatchId: null,
      held: true,
      holdReasons: ["self_purchase"],
    };
    const withHold: RawEngine = {
      ...raw,
      creators: raw.creators.map((c, i) => (i === 0 ? { ...c, credits: [...c.credits, held] } : c)),
      reviewFlags: [
        {
          id: "self_purchase:C9:housefresh",
          creditId: "C9:housefresh",
          captureId: "C9",
          reason: "self_purchase",
          detail: "the buyer's PayPal account is the creator's",
          status: "open",
          hold: true,
          createdAt: "2026-12-01T00:00:00.000Z",
          resolvedAt: null,
          credit: {
            creatorId: "housefresh",
            brandId: held.brandId,
            amountMinor: held.amountMinor,
            currency: "USD",
            state: "pending",
          },
        },
      ],
    };
    const h = buildTables(withHold);
    const before = row(t, "creators", "housefresh");
    expect(row(h, "creators", "housefresh")).toMatchObject({
      pending: before?.pending,
      held: held.amountMinor / 100,
      heldCount: 1,
      heldReasons: "Self-purchase",
    });
    expect(row(h, "credits", "C9:housefresh")).toMatchObject({
      state: "held",
      holdReason: "Self-purchase",
      payoutBatch: "Not paid yet",
    });
    expect(row(h, "brands", "winix:todate")).toMatchObject({ held: held.amountMinor / 100 });
    expect(row(h, "brands", "winix:first")).toMatchObject({ held: 0 });
    expect(h.tables.flags).toEqual([
      expect.objectContaining({
        id: "self_purchase:C9:housefresh",
        creator: "HouseFresh",
        kind: "Held for review",
        reason: "Self-purchase",
        status: "Waiting for a reviewer",
      }),
    ]);
    expect(t.tables.flags).toEqual([]);
  });

  it("changes version only when the data changes", () => {
    expect(buildTables(raw).version).toBe(t.version);
    const voided: RawEngine = {
      ...raw,
      journeys: raw.journeys.map((j) => ({ ...j, holdStatus: "voided" })),
    };
    expect(buildTables(voided).version).not.toBe(t.version);
  });
});

describe("Analyst recommendation", () => {
  it("keeps the cap when the deposit left covers a cycle", () => {
    expect(recommend(raw, "winix")).toMatchObject({
      action: "none",
      amountMinor: null,
      approvalId: "analyst-2",
    });
  });

  it("raises the cap in $500 steps when proven lift outruns the deposit", () => {
    const short: RawEngine = {
      ...raw,
      deposits: raw.deposits.map((d) => ({ ...d, available: 0, deposits: d.deposits.slice(0, 1) })),
    };
    const rec = recommend(short, "winix");
    expect(rec).toMatchObject({
      action: "raise_cap",
      amountMinor: 50_000,
      approvalId: "analyst-1",
    });
    expect(rec?.citations.map((c) => c.source)).toContain("/api/cited/api/lift");
    expect(rec?.guard).toMatch(/never changes ranking/);
  });

  it("never funds a brand whose lift isn't proven", () => {
    expect(recommend(raw, "levoit")).toMatchObject({ action: "none" });
  });

  it("gives the Analyst a summary with the point lift and arm counts it can say as is", () => {
    const short: RawEngine = {
      ...raw,
      deposits: raw.deposits.map((d) => ({ ...d, available: 0, deposits: d.deposits.slice(0, 1) })),
    };
    const rec = recommend(short, "winix");
    expect(rec?.summary).toBe(
      "Shown the test, agents bought Winix 4 of 4 times against 1 of 4 on the same creator's placebo: +75 points, +50 at the 80% lower bound. " +
        "Raise the purifier cap by $500: $0 is left and a payout cycle credits $15.36.",
    );
    expect(rec?.citations[0]).toEqual({
      label: "Lift, shown the test vs the same creator's placebo",
      value: "+75 points (bought 4 of 4 vs 1 of 4)",
      source: "/api/cited/api/lift",
    });
    // Every number in the summary is in a citation or the amount: nothing for the model to invent.
    expect(recommend(raw, "levoit")?.summary).toBe(
      "Shown the test, agents bought Levoit 0 of 4 times against 3 of 4 on the same creator's placebo: −75 points, so the test caused no Levoit sales and Levoit pays nothing.",
    );
    expect(recommend(raw, "winix")?.summary).toMatch(/: \+75 points\. Keep the purifier cap/);
  });

  it("says lift in whole, signed points", () => {
    expect(points(0.9444)).toBe("+94 points");
    expect(points(-0.9444)).toBe("−94 points");
    expect(points(0.004)).toBe("0 points");
  });
});

describe("model proxy", () => {
  it("prefers the local gateway, then Anthropic, then the scripted Analyst", () => {
    expect(
      studioLlmChoice({ LLM_BASE_URL: "http://g/", LLM_API_KEY: "k", ANTHROPIC_API_KEY: "a" }).kind,
    ).toBe("gateway");
    expect(studioLlmChoice({ ANTHROPIC_API_KEY: "a" }).kind).toBe("anthropic");
    expect(studioLlmChoice({}).kind).toBe("scripted");
  });

  it("rejects malformed turns and maps tool calls to OpenAI messages", () => {
    expect(typeof parseTurn({ input: "nope" })).toBe("string");
    const turn = parseTurn({
      instructions: "be brief",
      input: [
        { type: "message", role: "user", content: [{ type: "text", text: "hi" }] },
        { type: "function_call", callId: "c1", name: "run_query", arguments: "{}" },
        { type: "function_call_output", callId: "c1", output: "42" },
      ],
    });
    if (typeof turn === "string") throw new Error(turn);
    expect(toOpenAiMessages(turn).map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
  });

  it("streams a gateway turn as text, tool calls and a done event", async () => {
    const sse = [
      { choices: [{ delta: { content: "Hello" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "t1", function: { name: "go", arguments: '{"a":' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] },
            finish_reason: "tool_calls",
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } },
    ]
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join("");
    const fake = (async () => new Response(`${sse}data: [DONE]\n\n`)) as unknown as typeof fetch;
    const choice: StudioLlmChoice = {
      kind: "gateway",
      model: "m",
      baseUrl: "http://g",
      apiKey: "k",
      label: "m",
    };
    const turn = parseTurn({ input: [{ type: "message", role: "user", content: "hi" }] });
    if (typeof turn === "string") throw new Error(turn);
    const text = await new Response(
      streamTurn(choice, turn, { signal: new AbortController().signal, fetch: fake }),
    ).text();
    const events = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events).toEqual([
      { t: "text", d: "Hello" },
      { t: "tool", id: "t1", name: "go" },
      { t: "args", id: "t1", d: '{"a":' },
      { t: "args", id: "t1", d: "1}" },
      { t: "done", model: "m", status: "completed", usage: { inputTokens: 3, outputTokens: 4 } },
    ]);
  });
});

describe("studio routes", () => {
  const gateway: StudioLlmChoice = {
    kind: "gateway",
    model: "m",
    baseUrl: "http://g",
    apiKey: "secret",
    label: "m",
  };
  const approvals: unknown[] = [];
  const short: RawEngine = {
    ...raw,
    deposits: raw.deposits.map((d) => ({ ...d, available: 0, deposits: d.deposits.slice(0, 1) })),
  };
  const app = createStudioApp({
    read: async () => short,
    approve: async (a) => {
      approvals.push(a);
      return { status: "captured" };
    },
    llm: gateway,
    llmFetch: (async () => new Response("data: [DONE]\n\n")) as unknown as typeof fetch,
    limit: async (req) => req.headers.get("x-test-limit") !== "over",
  });

  it("serves config without the model key, and the tables", async () => {
    const config = await (await app.request("/api/config")).text();
    expect(config).not.toContain("secret");
    expect(JSON.parse(config)).toMatchObject({
      llm: { kind: "gateway", label: "m" },
      licenseKey: "",
    });
    const data = (await (await app.request("/api/data")).json()) as {
      tables: Record<string, unknown[]>;
    };
    expect(Object.keys(data.tables)).toEqual(
      expect.arrayContaining(["brands", "credits", "journeys", "payouts"]),
    );
  });

  it("answers 503 when the engine is down", async () => {
    const { EngineUnavailable } = await import("../src/dashboard");
    const down = createStudioApp({
      read: async () => {
        throw new EngineUnavailable("down");
      },
    });
    expect((await down.request("/api/data")).status).toBe(503);
  });

  it("refuses cross-origin and over-limit model calls, and caps the body", async () => {
    const post = (headers: Record<string, string>, body = '{"input":[]}') =>
      app.request("http://studio.test/api/llm", {
        method: "POST",
        headers: { host: "studio.test", ...headers },
        body,
      });
    expect((await post({ origin: "http://evil.test" })).status).toBe(403);
    expect((await post({ "x-test-limit": "over" })).status).toBe(429);
    expect((await post({}, "x".repeat(400_001))).status).toBe(413);
    expect((await post({ origin: "http://studio.test" })).status).toBe(200);
    const scripted = createStudioApp({ read: async () => raw });
    expect((await scripted.request("/api/llm", { method: "POST", body: "{}" })).status).toBe(503);
  });

  it("approves only the recommendation Maya saw, at the engine's amount", async () => {
    const approve = (body: unknown, headers: Record<string, string> = { "x-studio": "approve" }) =>
      app.request("/api/analyst/approve", { method: "POST", headers, body: JSON.stringify(body) });
    expect((await approve({ approvalId: "analyst-1", brandId: "winix" }, {})).status).toBe(403);
    expect((await approve({ approvalId: "analyst-9", brandId: "winix" })).status).toBe(409);
    const ok = await approve({ approvalId: "analyst-1", brandId: "winix", amountMinor: 9_999_999 });
    expect(ok.status).toBe(200);
    expect(approvals).toEqual([{ approvalId: "analyst-1", brandId: "winix", amountMinor: 50_000 }]);
  });

  it("passes a reviewer's release or void to the engine, and refuses anything else", async () => {
    const { createEngineReviewer, ReviewRejected } = await import("../src/dashboard");
    const calls: { url: string; auth: string | null }[] = [];
    const engineFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url.includes("/done%3A"))
        return Response.json({ error: "already_released" }, { status: 409 });
      return Response.json({
        flag: { id: "x", status: url.endsWith("/void") ? "voided" : "released" },
      });
    }) as typeof fetch;
    const review = createEngineReviewer({
      baseUrl: "http://e.test/",
      token: "t0k",
      fetch: engineFetch,
    });
    const studio = createStudioApp({ read: async () => raw, review });
    const post = (path: string, headers: Record<string, string> = { "x-studio": "review" }) =>
      studio.request(path, { method: "POST", headers });

    expect((await post("/api/review-flags/self_purchase:C9:housefresh/release", {})).status).toBe(
      403,
    );
    expect((await post("/api/review-flags/self_purchase:C9:housefresh/pay")).status).toBe(404);
    expect((await post("/api/review-flags/a%20b/release")).status).toBe(400);
    const ok = await post("/api/review-flags/self_purchase:C9:housefresh/void");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ flag: { id: "x", status: "voided" } });
    expect(calls[0]).toEqual({
      url: "http://e.test/api/review-flags/self_purchase%3AC9%3Ahousefresh/void",
      auth: "Bearer t0k",
    });
    const late = await post("/api/review-flags/done:C1:housefresh/release");
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "already_released" });
    expect(ReviewRejected).toBeDefined();
    expect(
      (
        await createStudioApp({ read: async () => raw }).request("/api/review-flags/x/void", {
          method: "POST",
          headers: { "x-studio": "review" },
        })
      ).status,
    ).toBe(501);
  });
});
