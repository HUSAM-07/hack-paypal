import type { AgAiEvent, AgAiMessage, AgAiRunInput, AgAiTool, AgStudioApi } from "ag-studio";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREATOR_AGENT_TOOLS,
  CREATOR_INSTRUCTIONS,
  CREATOR_STARTERS,
  CREATOR_TOOL,
  creatorTool,
  pickTopic,
  sayLine,
  scriptedCreatorRun,
} from "./creatorAnalyst";

const run = async (messages: AgAiMessage[]) => {
  const input = {
    threadId: "t",
    runId: "r",
    messages,
    tools: [],
    state: {},
    context: [],
    forwardedProps: {},
  } satisfies AgAiRunInput;
  const out: AgAiEvent[] = [];
  for await (const e of scriptedCreatorRun(input)) out.push(e);
  return out;
};
const user = (content: string): AgAiMessage => ({ id: "u", role: "user", content });
const calls = (events: AgAiEvent[]) =>
  events.flatMap((e) => (e.type === "TOOL_CALL_START" ? [e.toolCallName] : []));
const texts = (events: AgAiEvent[]) =>
  events.flatMap((e) => (e.type === "TEXT_MESSAGE_CONTENT" ? [e.delta] : []));

afterEach(() => vi.unstubAllGlobals());

describe("Creator Analyst: question routing", () => {
  it("sends each starter chip to the topic it is about", () => {
    const topics = CREATOR_STARTERS.map((s) => pickTopic(s.prompt));
    expect(topics).toEqual(["earned", "voided", "held", "shared", "earn_more"]);
  });
  it("falls back to the totals", () => expect(pickTopic("hello")).toBe("overview"));
});

describe("Creator Analyst: the read tool", () => {
  const fake = (): {
    tool: AgAiTool;
    execute: (a: { topic: string }, c: unknown) => Promise<unknown>;
  } => {
    let captured: ((a: { topic: string }, c: unknown) => Promise<unknown>) | undefined;
    const api = {
      defineAiTool: (def: { name: string; execute: typeof captured }) => {
        captured = def.execute;
        return def as unknown as AgAiTool;
      },
    } as unknown as AgStudioApi;
    const tool = creatorTool(api, { creatorId: "airlab" });
    if (!captured) throw new Error("not defined");
    return { tool, execute: captured };
  };
  const ctx = {
    success: (text: string, data: unknown) => ({ success: true, text, data }),
    error: (message: string) => ({ success: false, message }),
  };

  it("only GETs the creator's own figures, with no body", async () => {
    const answer = {
      headline: "h",
      summary: "s",
      citations: [{ label: "L", value: "$1.00", source: "Credits table" }],
      credits: [],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer)));
    vi.stubGlobal("fetch", fetchMock);
    const { tool, execute } = fake();
    expect(tool.name).toBe(CREATOR_TOOL);
    const res = (await execute({ topic: "voided" }, ctx)) as { text: string };
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("/studio/api/creator-analyst?creator=airlab&topic=voided");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(res.text).toContain("Say: s");
    expect(res.text).toContain("L: $1.00 (Credits table)");
  });

  it("reports a failure instead of inventing figures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "no such creator yet" }), { status: 404 }),
      ),
    );
    const { execute } = fake();
    expect(await execute({ topic: "earned" }, ctx)).toMatchObject({
      success: false,
      message: "no such creator yet",
    });
  });
});

describe("Creator Analyst: no write path", () => {
  it("is offered no tool that approves, releases, voids, pays or tops up", () => {
    expect([...CREATOR_AGENT_TOOLS].sort()).toEqual(
      ["delegate_to", CREATOR_TOOL, "execute_query", "view_page", "view_schema"].sort(),
    );
    for (const name of CREATOR_AGENT_TOOLS)
      expect(name).not.toMatch(/approve|release|void_|pay|top_?up|draft_cap/);
  });
  it("tells the model it is read-only and keeps its advice honest", () => {
    expect(CREATOR_INSTRUCTIONS).toMatch(/strictly read-only/);
    expect(CREATOR_INSTRUCTIONS).toMatch(/cannot approve, release, void, pay/);
    expect(CREATOR_INSTRUCTIONS).toMatch(/clear, accurate verdicts in categories brands fund/);
    expect(CREATOR_INSTRUCTIONS).toMatch(/gaming the holdout, buying their own products/);
    expect(CREATOR_INSTRUCTIONS).toMatch(/changing a verdict to favour a funder/);
  });
});

describe("Creator Analyst: scripted fallback", () => {
  it("reads the credits first for a 'why did I earn' question, then calls the read tool, then answers", async () => {
    const q = user("Why did I earn $383.96?");
    const one = await run([q]);
    expect(calls(one)).toEqual(["execute_query"]);
    const two = await run([
      q,
      {
        id: "a1",
        role: "assistant",
        toolCalls: [
          { id: "c1", type: "function", function: { name: "execute_query", arguments: "{}" } },
        ],
      },
      { id: "t1", role: "tool", toolCallId: "c1", content: "{}" },
    ]);
    expect(calls(two)).toEqual([CREATOR_TOOL]);
    const three = await run([
      q,
      {
        id: "a2",
        role: "assistant",
        toolCalls: [
          {
            id: "c2",
            type: "function",
            function: { name: CREATOR_TOOL, arguments: '{"topic":"earned"}' },
          },
        ],
      },
      {
        id: "t2",
        role: "tool",
        toolCallId: "c2",
        content: "Headline: x.\nSay: You were paid $383.96.\nFigures: a.",
      },
    ]);
    expect(calls(three)).toEqual([]);
    expect(texts(three)).toEqual(["You were paid $383.96."]);
  });

  it("goes straight to the read tool for a void question and only ever calls read tools", async () => {
    const events = await run([user("Why was $7.68 voided?")]);
    expect(calls(events)).toEqual([CREATOR_TOOL]);
    for (const name of calls(events)) expect(CREATOR_AGENT_TOOLS).toContain(name);
  });

  it("answers a second question in the same thread afresh", async () => {
    const events = await run([
      user("Why was $7.68 voided?"),
      {
        id: "a",
        role: "assistant",
        toolCalls: [
          { id: "c", type: "function", function: { name: CREATOR_TOOL, arguments: "{}" } },
        ],
      },
      { id: "t", role: "tool", toolCallId: "c", content: "Say: old." },
      { id: "a3", role: "assistant", content: "old." },
      user("What would earn me more?"),
    ]);
    expect(calls(events)).toEqual([CREATOR_TOOL]);
  });

  it("finds the line to say in a tool result", () => {
    expect(sayLine("Headline: x.\nSay: A $1.00 credit.\nFigures: y.")).toBe("A $1.00 credit.");
    expect(sayLine(undefined)).toBeUndefined();
    const json = JSON.stringify({
      success: true,
      response: "Headline: x.\nSay: B.\nFigures: y.",
      data: { summary: "C." },
    });
    expect(sayLine(json)).toBe("C.");
    expect(sayLine(JSON.stringify({ success: true, response: "Headline: x.\nSay: B." }))).toBe(
      "B.",
    );
  });
});
