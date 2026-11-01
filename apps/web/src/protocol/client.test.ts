import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AnyNotification, ConnectionLostError, PactClient, type SocketLike } from "./client";
import { ThreadStore } from "./store";

const THREAD = {
  id: "thread_abcd",
  title: "T",
  kind: "solo" as const,
  memberIds: ["user_me"],
  createdAt: "2026-11-01T00:00:00.000Z",
  archived: false,
};

/** Minimal scripted server: answers RPCs, keeps a seq'd log, honors afterSeq on resume. */
class FakeServer {
  sockets: FakeSocket[] = [];
  log: { method: string; seq: number; params: unknown }[] = [];
  resumes: number[] = [];
  received: { method: string; params: unknown }[] = [];

  connect = (): SocketLike => {
    const s = new FakeSocket(this);
    this.sockets.push(s);
    queueMicrotask(() => s.open());
    return s;
  };

  get live() {
    return this.sockets[this.sockets.length - 1]!;
  }

  handle(s: FakeSocket, raw: string) {
    const msg = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
    this.received.push({ method: msg.method, params: msg.params });
    const reply = (result: unknown) => queueMicrotask(() => s.push({ id: msg.id, result }));
    switch (msg.method) {
      case "initialize":
        return reply({
          serverVersion: "t",
          protocolVersion: 1,
          catalogVersion: "1",
          userId: "user_me",
        });
      case "thread/resume": {
        const after = msg.params.afterSeq as number;
        this.resumes.push(after);
        reply({ thread: THREAD, lastSeq: this.log.length });
        queueMicrotask(() => {
          for (const f of this.log) if (f.seq > after) s.push(f);
        });
        return;
      }
      case "turn/start":
        return reply({ turnId: "turn_1" });
    }
  }

  /** Append an event and deliver it to the live socket (if `deliver`). */
  emit(method: string, params: unknown, deliver = true) {
    const f = { method, seq: this.log.length + 1, params };
    this.log.push(f);
    if (deliver && this.live.readyState === 1) this.live.push(f);
  }
}

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(private server: FakeServer) {}
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  send(data: string) {
    this.server.handle(this, data);
  }
  push(frame: unknown) {
    if (this.readyState === 1)
      this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
  close() {
    this.drop();
  }
  drop() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const agentStarted = (id: string) => ({
  item: {
    id,
    threadId: THREAD.id,
    turnId: "turn_1",
    status: "inProgress",
    createdAt: THREAD.createdAt,
    type: "agentMessage",
    text: "",
    refs: {},
    diagnostics: [],
  },
});

describe("PactClient", () => {
  let server: FakeServer;
  let client: PactClient;
  let seen: AnyNotification[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server = new FakeServer();
    client = new PactClient({ connect: server.connect, backoff: () => 50 });
    seen = [];
    client.onNotification((n) => seen.push(n));
  });
  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  it("initializes, correlates responses and queues requests made before the socket is ready", async () => {
    const pending = client.request("turn/start", { threadId: THREAD.id, text: "hi" });
    client.start();
    await flush(20);
    await expect(pending).resolves.toEqual({ turnId: "turn_1" });
    expect(server.received.map((r) => r.method)).toEqual(["initialize", "turn/start"]);
    expect(client.userId).toBe("user_me");
    expect(client.state).toBe("open");
  });

  it("tracks seq per thread and drops replays it has already applied", async () => {
    client.start();
    await flush(20);
    await client.subscribe(THREAD.id);
    await flush(20);
    server.emit("item/started", agentStarted("item_a"));
    server.emit("item/agentMessage/delta", { threadId: THREAD.id, itemId: "item_a", delta: "he" });
    expect(client.seqFor(THREAD.id)).toBe(2);
    // A duplicate frame (same seq) must not be dispatched twice.
    server.live.push(server.log[1]);
    expect(seen.filter((n) => n.method === "item/agentMessage/delta")).toHaveLength(1);
  });

  it("reconnects after a drop, resumes from the last seq and replays only the missed events", async () => {
    const store = new ThreadStore();
    store.upsertThread(THREAD);
    client.onNotification((n) => store.apply(n));
    client.start();
    await flush(20);
    await client.subscribe(THREAD.id);
    await flush(20);

    server.emit("item/started", agentStarted("item_a"));
    server.emit("item/agentMessage/delta", { threadId: THREAD.id, itemId: "item_a", delta: "Hel" });
    expect(client.seqFor(THREAD.id)).toBe(2);

    server.live.drop();
    expect(client.state).toBe("reconnecting");
    // Events keep happening server-side while we're offline.
    server.emit(
      "item/agentMessage/delta",
      { threadId: THREAD.id, itemId: "item_a", delta: "lo" },
      false,
    );
    server.emit(
      "item/agentMessage/delta",
      { threadId: THREAD.id, itemId: "item_a", delta: "!" },
      false,
    );

    await vi.advanceTimersByTimeAsync(60);
    await flush(30);

    expect(server.sockets).toHaveLength(2);
    expect(server.resumes.at(-1)).toBe(2);
    expect(client.state).toBe("open");
    expect(client.seqFor(THREAD.id)).toBe(4);
    const item = store.getSnapshot().threads[THREAD.id]?.items.item_a;
    expect(item?.type === "agentMessage" && item.text).toBe("Hello!");
  });

  it("fails in-flight requests on a drop but keeps queued ones for after reconnect", async () => {
    client.start();
    await flush(20);
    // Swallow the response so the request stays in flight.
    const handle = server.handle.bind(server);
    server.handle = (s, raw) => {
      if (raw.includes("turn/start")) return;
      handle(s, raw);
    };
    const inflight = client.request("turn/start", { threadId: THREAD.id, text: "a" });
    server.live.drop();
    await expect(inflight).rejects.toBeInstanceOf(ConnectionLostError);

    server.handle = handle;
    const queued = client.request("turn/start", { threadId: THREAD.id, text: "b" });
    await vi.advanceTimersByTimeAsync(60);
    await flush(30);
    await expect(queued).resolves.toEqual({ turnId: "turn_1" });
  });

  it("drops frames that don't match the protocol schema", async () => {
    client.start();
    await flush(20);
    await client.subscribe(THREAD.id);
    await flush(20);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.live.push({
      method: "item/started",
      seq: 99,
      params: { item: { type: "evil", threadId: THREAD.id } },
    });
    server.live.push({ method: "not/a/method", seq: 100, params: {} });
    expect(seen).toHaveLength(0);
    expect(client.seqFor(THREAD.id)).toBe(0);
    warn.mockRestore();
  });
});

describe("ThreadStore", () => {
  it("replaces the optimistic user message with the server echo without duplicating it", () => {
    const store = new ThreadStore();
    store.upsertThread(THREAD);
    const base = {
      threadId: THREAD.id,
      createdAt: THREAD.createdAt,
      type: "userMessage" as const,
      authorId: "user_me",
      text: "hi",
    };
    store.addOptimistic({ ...base, id: "optimistic_1", turnId: "pending", status: "inProgress" });
    const echo = { ...base, id: "item_u1", turnId: "turn_1", status: "completed" as const };
    store.apply({ method: "item/started", seq: 1, params: { item: echo } });
    store.apply({ method: "item/completed", seq: 2, params: { item: echo } });
    const t = store.getSnapshot().threads[THREAD.id]!;
    expect(t.order).toEqual(["item_u1"]);
  });
});
