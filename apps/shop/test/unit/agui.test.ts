import type { RunAgentInput } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import { EventEncoder } from "@ag-ui/encoder";
import { createHarness, fakeProvider, MemoryThreadStore, type Notification } from "@shop/harness";
import { describe, expect, it } from "vitest";
import { createAguiTranslator, interpretRunInput } from "../../src/agui";
import { initialShopState, stubDomain } from "../../src/stub-domain";

/** A deterministic harness on the stub domain; ids and clock are fixed so the stream is golden. */
function rig() {
  const store = new MemoryThreadStore();
  const domain = stubDomain({
    userId: "u1",
    env: {},
    now: () => new Date(0),
    getState: () => initialShopState(),
    updateState: (f) => f(initialShopState()),
    getPrivate: () => undefined,
    setPrivate: () => {},
    notify: () => {},
    schedule: async () => "s",
    cancelSchedule: async () => true,
    startTurn: async () => {
      throw new Error("unused");
    },
  });
  const published: Notification[] = [];
  let n = 0;
  const harness = createHarness({
    userId: "u1",
    store,
    model: fakeProvider({ rules: domain.fakeRules ?? [] }),
    tools: domain.tools,
    systemPrompt: () => "golden",
    publish: (x) => published.push(x),
    now: () => new Date("2026-11-13T10:00:00.000Z"),
    newId: (p) => `${p}_${++n}`,
  });
  return { harness, published };
}

function sse(
  harness: ReturnType<typeof rig>["harness"],
  threadId: string,
  runId: string,
  ns: Notification[],
) {
  const t = createAguiTranslator({
    threadId,
    runId,
    pendingApprovals: (turn) =>
      harness
        .pendingApprovals()
        .filter((a) => a.threadId === turn.threadId && a.turnId === turn.id),
  });
  const encoder = new EventEncoder();
  const events = [...t.start(initialShopState())];
  for (const n of ns) events.push(...t.translate(n.method, n.params));
  for (const e of events) {
    const r = EventSchema.safeParse(e);
    expect(r.success, `${e.type}: ${r.error?.message}`).toBe(true);
  }
  return events.map((e) => encoder.encodeSSE(e)).join("");
}

describe("AG-UI adapter", () => {
  it("streams a search turn (golden)", async () => {
    const { harness, published } = rig();
    const thread = harness.startThread({ id: "thr_agui" });
    const from = published.length;
    await harness.startTurn({ threadId: thread.id, text: "find headphones" }).done;
    const stream = sse(harness, thread.id, "run_1", published.slice(from));
    await expect(stream).toMatchFileSnapshot("./__golden__/agui-search.sse");
  });

  it("ends a run on an approval interrupt, then resumes it (golden)", async () => {
    const { harness, published } = rig();
    const thread = harness.startThread({ id: "thr_agui" });
    let from = published.length;
    await harness.startTurn({ threadId: thread.id, text: "buy the headphones" }).done;
    const first = sse(harness, thread.id, "run_1", published.slice(from));
    await expect(first).toMatchFileSnapshot("./__golden__/agui-interrupt.sse");
    expect(first).toContain('"type":"RUN_FINISHED"');
    expect(first).toContain('"outcome":{"type":"interrupt"');

    const [approval] = harness.pendingApprovals();
    const cmd = interpretRunInput({
      threadId: thread.id,
      runId: "run_2",
      messages: [],
      tools: [],
      context: [],
      resume: [
        {
          interruptId: approval?.approvalId as string,
          status: "resolved",
          payload: { decision: "approve" },
        },
      ],
    } satisfies RunAgentInput);
    expect(cmd).toEqual({
      kind: "resume",
      answers: [{ approvalId: approval?.approvalId, decision: "approve" }],
    });
    from = published.length;
    const r = await harness.respondApproval({
      approvalId: approval?.approvalId as string,
      decision: "approve",
    });
    await r.done;
    const second = sse(harness, thread.id, "run_2", published.slice(from));
    await expect(second).toMatchFileSnapshot("./__golden__/agui-resume.sse");
    expect(second).toContain('"outcome":{"type":"success"}');
  });

  it("maps cancelled interrupts to deny and reads the last user message", () => {
    const base = { threadId: "t", runId: "r", tools: [], context: [] };
    expect(
      interpretRunInput({
        ...base,
        messages: [],
        resume: [{ interruptId: "ap_1", status: "cancelled" }],
      }),
    ).toEqual({ kind: "resume", answers: [{ approvalId: "ap_1", decision: "deny" }] });
    expect(
      interpretRunInput({
        ...base,
        messages: [
          { id: "m1", role: "user", content: "first" },
          { id: "m2", role: "assistant", content: "ok" },
          { id: "m3", role: "user", content: [{ type: "text", text: "second" }] },
        ],
      }),
    ).toEqual({ kind: "turn", text: "second" });
    expect(interpretRunInput({ ...base, messages: [] }).kind).toBe("invalid");
  });
});
