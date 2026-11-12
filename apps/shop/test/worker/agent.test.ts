import { SELF } from "cloudflare:test";
import { ErrorCodes, type Item, type Turn } from "@shop/agent-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type Frame, TestClient } from "./client";

const open: TestClient[] = [];
let n = 0;
const user = () => `u_${Date.now().toString(36)}_${++n}`;
async function client(userId: string, handlers?: Parameters<typeof TestClient.open>[1]) {
  const c = await TestClient.open(userId, handlers);
  open.push(c);
  return c;
}

afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

const itemsOf = (frames: Frame[], method: string) =>
  frames.filter((f) => f.method === method).map((f) => (f.params as { item: Item }).item);

describe("ShopperAgent protocol", () => {
  it("rejects every method before initialize, then sends the state snapshot", async () => {
    const c = await TestClient.connect(user());
    open.push(c);
    await expect(c.peer.request("thread/list", {})).rejects.toMatchObject({
      code: ErrorCodes.notInitialized,
    });
    const init = await c.peer.request("initialize", {
      clientInfo: { name: "test", version: "0" },
      protocolVersion: 1,
    });
    expect(init).toMatchObject({ protocolVersion: 1, capabilities: ["demo"] });
    const snap = await c.waitFor((f) => f.method === "state/snapshot");
    expect(snap.params).toMatchObject({ version: 0, state: { watches: [], orders: [] } });
    await expect(
      c.peer.request("initialize", { clientInfo: { name: "t", version: "0" }, protocolVersion: 1 }),
    ).rejects.toMatchObject({ code: ErrorCodes.invalidRequest });

    c.sendRaw("not json");
    const err = await c.waitFor((f) => f.error?.code === ErrorCodes.parseError);
    expect(err.id).toBeNull();
    // The Agents SDK's own frames (identity, cf_agent_state) never reach the client.
    expect(c.frames.some((f) => typeof (f as { type?: unknown }).type === "string")).toBe(false);
  });

  it("runs a fake-model chat end to end with ordered items and monotonic seq", async () => {
    const c = await client(user());
    const { thread } = await c.peer.request("thread/start", {});
    const { turn } = await c.peer.request("turn/start", {
      threadId: thread.id,
      text: "find headphones",
    });
    await c.turnCompleted(turn.id);

    const seqs = c.frames.filter((f) => f.seq !== undefined).map((f) => f.seq as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    const completed = itemsOf(c.frames, "item/completed");
    const search = completed.find((i) => i.type === "toolCall");
    expect(search).toMatchObject({ name: "demo_search", status: "completed" });
    expect((search as { result: { offers: unknown[] } }).result.offers.length).toBeGreaterThan(0);
    const startIdx = c.frames.findIndex(
      (f) => f.method === "item/started" && (f.params as { item: Item }).item.id === search?.id,
    );
    const endIdx = c.frames.findIndex(
      (f) => f.method === "item/completed" && (f.params as { item: Item }).item.id === search?.id,
    );
    expect(startIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeLessThan(endIdx);
    expect(c.frames.some((f) => f.method === "item/agentMessage/delta")).toBe(true);
    expect(completed.at(-1)?.type).toBe("agentMessage");

    const read = await c.peer.request("thread/read", { threadId: thread.id });
    expect(read.turns[0]?.status).toBe("completed");
    const list = await c.peer.request("thread/list", {});
    expect(list.threads.map((t) => t.id)).toContain(thread.id);
  });

  it("resumes after a disconnect and replays only what was missed", async () => {
    const userId = user();
    const a = await client(userId);
    const { thread } = await a.peer.request("thread/start", {});
    const { turn } = await a.peer.request("turn/start", {
      threadId: thread.id,
      text: "find a vacuum",
    });
    await a.waitFor((f) => f.method === "item/started");
    const seenSeq = a.peer.lastSeq(thread.id);
    a.close();

    const b = await client(userId);
    // Let the turn finish while nobody is subscribed to the thread.
    for (let i = 0; i < 50; i++) {
      const r = await b.peer.request("thread/read", { threadId: thread.id });
      if (r.turns[0]?.status === "completed") break;
      await new Promise((res) => setTimeout(res, 20));
    }
    const resumed = await b.peer.request("thread/resume", {
      threadId: thread.id,
      afterSeq: seenSeq,
    });
    await b.turnCompleted(turn.id);
    await b.waitFor((f) => f.seq === resumed.lastSeq);
    const replayed = b.frames.filter((f) => f.seq !== undefined);
    expect(replayed.every((f) => (f.seq as number) > seenSeq)).toBe(true);
    expect(replayed.at(-1)?.seq).toBeLessThanOrEqual(resumed.lastSeq);
    expect(b.peer.lastSeq(thread.id)).toBe(resumed.lastSeq);
    expect(itemsOf(b.frames, "item/completed").some((i) => i.type === "agentMessage")).toBe(true);
  });

  it("pauses on an approval, re-sends it to a new surface, and resumes on approval/respond", async () => {
    const userId = user();
    const asked: string[] = [];
    // This surface sees the request but never answers it.
    const phone = await client(userId, {
      "approval/request": (p) => {
        asked.push(p.item.approvalId);
        return new Promise(() => {});
      },
    });
    const { thread } = await phone.peer.request("thread/start", {});
    const { turn } = await phone.peer.request("turn/start", {
      threadId: thread.id,
      text: "buy the headphones",
    });
    const parked = await phone.waitFor(
      (f) =>
        f.method === "turn/updated" &&
        (f.params as { turn: Turn }).turn.status === "awaitingApproval",
    );
    expect(parked).toBeTruthy();
    expect(asked).toHaveLength(1);
    const approvalId = asked[0] as string;

    const laptopAsked: string[] = [];
    const laptop = await client(userId, {
      "approval/request": (p) => {
        laptopAsked.push(p.item.approvalId);
        return new Promise(() => {});
      },
    });
    await laptop.waitFor((f) => f.method === "approval/request");
    expect(laptopAsked).toEqual([approvalId]);

    const r = await laptop.peer.request("approval/respond", { approvalId, decision: "approve" });
    expect(r.accepted).toBe(true);
    const done = await phone.turnCompleted(turn.id);
    expect((done.params as { turn: Turn }).turn.status).toBe("completed");
    const buy = itemsOf(phone.frames, "item/completed").find(
      (i) => i.type === "toolCall" && i.name === "demo_buy",
    );
    expect(buy).toMatchObject({ status: "completed", result: { offerId: "demo_xm6" } });
    expect(phone.frames.some((f) => f.method === "inbox/added")).toBe(true);
    const again = await laptop.peer.request("approval/respond", {
      approvalId,
      decision: "approve",
    });
    expect(again.accepted).toBe(false);
  });

  it("accepts the answer to the approval/request server request itself", async () => {
    const c = await client(user(), { "approval/request": () => ({ decision: "deny" }) });
    const { thread } = await c.peer.request("thread/start", {});
    const { turn } = await c.peer.request("turn/start", { threadId: thread.id, text: "buy it" });
    await c.turnCompleted(turn.id);
    const buy = itemsOf(c.frames, "item/completed").find((i) => i.type === "toolCall");
    expect(buy).toMatchObject({ status: "declined" });
  });

  it("forks a thread and streams the fork's own turns", async () => {
    const c = await client(user());
    const { thread } = await c.peer.request("thread/start", { title: "Headphones" });
    const first = await c.peer.request("turn/start", {
      threadId: thread.id,
      text: "find headphones",
    });
    await c.turnCompleted(first.turn.id);
    const { thread: fork } = await c.peer.request("thread/fork", { threadId: thread.id });
    expect(fork.forkedFrom).toEqual({ threadId: thread.id, turnId: first.turn.id });
    const next = await c.peer.request("turn/start", { threadId: fork.id, text: "hello" });
    await c.turnCompleted(next.turn.id);
    const forkRead = await c.peer.request("thread/read", { threadId: fork.id });
    expect(forkRead.turns.map((t) => t.status)).toEqual(["completed", "completed"]);
    const original = await c.peer.request("thread/read", { threadId: thread.id });
    expect(original.turns).toHaveLength(1);
  });

  it("dispatches widget actions and broadcasts a versioned state patch", async () => {
    const userId = user();
    const a = await client(userId);
    const b = await client(userId);
    await a.peer.request("action/invoke", {
      name: "settings.update",
      args: { coolingOffMinutes: 30 },
    });
    const patch = await b.waitFor((f) => f.method === "state/patch");
    expect(patch.params).toEqual({
      version: 1,
      baseVersion: 0,
      ops: [{ op: "replace", path: "/coolingOffMinutes", value: 30 }],
    });
    await expect(a.peer.request("action/invoke", { name: "nope" })).rejects.toMatchObject({
      code: ErrorCodes.notFound,
    });
    await expect(
      a.peer.request("action/invoke", { name: "settings.update", args: { coolingOffMinutes: -1 } }),
    ).rejects.toMatchObject({ code: ErrorCodes.invalidParams });
    const fresh = await client(userId);
    const snap = await fresh.waitFor((f) => f.method === "state/snapshot");
    expect(snap.params).toMatchObject({ version: 1, state: { coolingOffMinutes: 30 } });
  });

  it("interrupts a running turn", async () => {
    const c = await client(user());
    const { thread } = await c.peer.request("thread/start", {});
    const { turn } = await c.peer.request("turn/start", {
      threadId: thread.id,
      text: "hello there",
    });
    await c.peer.request("turn/interrupt", { threadId: thread.id, turnId: turn.id });
    const done = await c.turnCompleted(turn.id);
    expect(["interrupted", "completed"]).toContain((done.params as { turn: Turn }).turn.status);
    await expect(
      c.peer.request("turn/start", { threadId: "thr_missing", text: "x" }),
    ).rejects.toMatchObject({ code: ErrorCodes.notFound });
  });
});

describe("routes", () => {
  it("routes the WebSocket upgrade to the dev user's agent and rejects plain GETs", async () => {
    const plain = await SELF.fetch("https://shop.test/api/shop/ws");
    expect(plain.status).toBe(426);
    const res = await SELF.fetch("https://shop.test/api/shop/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
  });

  it("serves an AG-UI run as SSE through POST /api/shop/agui", async () => {
    const res = await SELF.fetch("https://shop.test/api/shop/agui", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        threadId: `agui_${Date.now()}`,
        runId: "run_1",
        messages: [{ id: "m1", role: "user", content: "find headphones" }],
        tools: [],
        context: [],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const types = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => (JSON.parse(l.slice(6)) as { type: string }).type);
    expect(types[0]).toBe("RUN_STARTED");
    expect(types).toContain("TOOL_CALL_START");
    expect(types).toContain("TOOL_CALL_RESULT");
    expect(types).toContain("TEXT_MESSAGE_CONTENT");
    expect(types.at(-1)).toBe("RUN_FINISHED");

    const bad = await SELF.fetch("https://shop.test/api/shop/agui", { method: "POST", body: "{}" });
    expect(bad.status).toBe(400);
  });
});
