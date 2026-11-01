import { describe, expect, it } from "vitest";
import type { AnyNotification, SocketLike } from "./client";
import { ThreadRouter } from "./router";

const thread = (id: string) => ({
  id,
  title: "T",
  kind: "solo" as const,
  memberIds: ["user_me"],
  createdAt: "2026-11-01T00:00:00.000Z",
  archived: false,
});

/** Mimics the worker: each socket is bound to one thread, or to none until `thread/start`. */
class FakeWorker {
  sockets: FakeSocket[] = [];
  private nextThread = 1;

  socket = (url: string): SocketLike => {
    const s = new FakeSocket(this, new URL(url).searchParams.get("thread") ?? "");
    this.sockets.push(s);
    queueMicrotask(() => s.open());
    return s;
  };

  handle(s: FakeSocket, raw: string) {
    const msg = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
    s.received.push(msg.method);
    const reply = (result: unknown) => queueMicrotask(() => s.push({ id: msg.id, result }));
    const fail = () =>
      queueMicrotask(() =>
        s.push({ id: msg.id, error: { code: -32602, message: "socket bound elsewhere" } }),
      );
    switch (msg.method) {
      case "initialize":
        return reply({ serverVersion: "t", protocolVersion: 1, catalogVersion: "1", userId: "u" });
      case "thread/list":
        return reply({ threads: [] });
      case "thread/start": {
        if (s.bound !== "new") return fail();
        s.bound = `thr_${this.nextThread++}`;
        queueMicrotask(() =>
          s.push({ method: "thread/started", seq: 1, params: { thread: thread(s.bound) } }),
        );
        return reply({ thread: thread(s.bound) });
      }
      case "thread/resume":
      case "turn/start":
        if (msg.params.threadId !== s.bound) return fail();
        return reply(
          msg.method === "turn/start"
            ? { turnId: "turn_1" }
            : { thread: thread(s.bound), lastSeq: 1 },
        );
    }
  }
}

class FakeSocket implements SocketLike {
  readyState = 0;
  received: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(
    private worker: FakeWorker,
    public bound: string,
  ) {}
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  send(data: string) {
    this.worker.handle(this, data);
  }
  push(frame: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
  close() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}

function setup() {
  const worker = new FakeWorker();
  const router = new ThreadRouter({
    url: (t) => `ws://pact.test/ws?thread=${t}`,
    socket: worker.socket,
    backoff: () => 0,
  });
  const seen: AnyNotification[] = [];
  router.onNotification((n) => seen.push(n));
  router.start();
  return { worker, router, seen };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("ThreadRouter", () => {
  it("lists threads over the lobby socket", async () => {
    const { worker, router } = setup();
    await expect(router.request("thread/list", {})).resolves.toEqual({ threads: [] });
    expect(worker.sockets.map((s) => s.bound)).toEqual(["new"]);
    expect(router.userId).toBe("u");
  });

  it("turns the lobby into the new thread's socket and opens a fresh lobby", async () => {
    const { worker, router, seen } = setup();
    const { thread: t } = await router.request("thread/start", {});
    await router.request("turn/start", { threadId: t.id, text: "hi" });
    await router.request("thread/list", {});
    const [first, second] = worker.sockets;
    expect(first?.bound).toBe(t.id);
    expect(first?.received).toContain("turn/start");
    expect(second?.bound).toBe("new");
    expect(second?.received).toContain("thread/list");
    expect(seen.map((n) => n.method)).toContain("thread/started");

    // After a drop, that socket reconnects straight to its thread and resumes it.
    first?.close();
    await tick();
    const reconnected = worker.sockets[2];
    expect(reconnected?.bound).toBe(t.id);
    expect(reconnected?.received).toEqual(["initialize", "thread/resume"]);
  });

  it("opens one socket per existing thread and routes by threadId", async () => {
    const { worker, router } = setup();
    await router.subscribe("thr_9");
    await router.request("turn/start", { threadId: "thr_9", text: "a" });
    await router.request("turn/start", { threadId: "thr_9", text: "b" });
    const bound = worker.sockets.filter((s) => s.bound === "thr_9");
    expect(bound).toHaveLength(1);
    expect(bound[0]?.received).toEqual(["initialize", "thread/resume", "turn/start", "turn/start"]);
  });

  it("gives concurrent thread starts separate sockets", async () => {
    const { router } = setup();
    const [a, b] = await Promise.all([
      router.request("thread/start", {}),
      router.request("thread/start", {}),
    ]);
    expect(a.thread.id).not.toBe(b.thread.id);
  });
});
