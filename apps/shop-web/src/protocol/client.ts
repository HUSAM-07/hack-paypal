import {
  type ClientMethod,
  classifyFrame,
  ErrorCodes,
  type Item,
  type ParamsOf,
  PROTOCOL_VERSION,
  type ResultOf,
  type RpcResponse,
  type ServerRequestResultOf,
} from "@shop/agent-protocol";
import type { ShopActionName, ShopState } from "@shop/commerce/contract";
import { type ClientState, type Event, initialState, reduce } from "./state";
import type { Connect, Transport } from "./transport";

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; method: string };

export type ShopClientOptions = {
  connect: Connect;
  clientInfo?: { name: string; title?: string; version: string };
  /** Backoff bounds for reconnects, ms. */
  minBackoff?: number;
  maxBackoff?: number;
};

/**
 * The protocol client: one logical session over reconnecting transports.
 *  - `initialize` first on every connection, then re-subscribes each thread with
 *    `thread/resume { afterSeq }` so nothing is missed or applied twice.
 *  - Correlates request ids; rejects in-flight requests when the socket drops.
 *  - Answers `approval/request` server requests when the user decides (or via
 *    `approval/respond` when the request came from another connection).
 *  - Applies `state/patch` only on a matching base version, else re-snapshots.
 * State lives in a tiny external store for `useSyncExternalStore`.
 */
export class ShopClient {
  private state: ClientState = initialState;
  private listeners = new Set<() => void>();
  private transport: Transport | undefined;
  private nextId = 1;
  private pending = new Map<string | number, Pending>();
  private ready: Promise<void>;
  private markReady!: () => void;
  private backoff: number;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private resyncing = false;

  constructor(private readonly opts: ShopClientOptions) {
    this.backoff = opts.minBackoff ?? 500;
    this.ready = new Promise((r) => {
      this.markReady = r;
    });
  }

  // ── store ──

  getState = (): ClientState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private dispatch(ev: Event) {
    const next = reduce(this.state, ev);
    if (next === this.state) return;
    this.state = next;
    for (const fn of this.listeners) fn();
    if (next.shopStale && !this.resyncing) void this.resyncShop();
  }

  // ── lifecycle ──

  start() {
    this.closed = false;
    this.open();
    return this;
  }

  stop() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.transport?.close();
    this.transport = undefined;
  }

  private resetReady() {
    this.ready = new Promise((r) => {
      this.markReady = r;
    });
  }

  private open() {
    this.dispatch({
      type: "status",
      status: this.state.userId ? "reconnecting" : "connecting",
    });
    const t = this.opts.connect({
      onOpen: () => void this.handshake(t),
      onMessage: (frame) => this.onFrame(frame),
      onClose: ({ unauthorized }) => this.onClose(t, unauthorized),
    });
    this.transport = t;
  }

  private onClose(t: Transport, unauthorized: boolean) {
    if (this.transport !== t) return;
    this.transport = undefined;
    for (const [, p] of this.pending)
      p.reject(new RpcError(ErrorCodes.internal, "Connection lost"));
    this.pending.clear();
    this.resetReady();
    if (this.closed) return;
    if (unauthorized) {
      this.dispatch({ type: "status", status: "unauthorized" });
      return;
    }
    this.dispatch({ type: "status", status: "offline" });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(this.opts.maxBackoff ?? 8000, this.backoff * 2);
  }

  /** Retry now (the "Reconnect" button), skipping the backoff wait. */
  reconnect() {
    clearTimeout(this.retryTimer);
    this.backoff = this.opts.minBackoff ?? 500;
    this.transport?.close();
    this.transport = undefined;
    this.open();
  }

  private async handshake(t: Transport) {
    try {
      const init = (await this.rawRequest(t, "initialize", {
        clientInfo: this.opts.clientInfo ?? { name: "shop-web", title: "Shop", version: "0.1.0" },
        protocolVersion: PROTOCOL_VERSION,
        capabilities: ["browserPane", "approvals", "statePatch"],
      })) as ResultOf<"initialize">;
      this.backoff = this.opts.minBackoff ?? 500;
      this.dispatch({ type: "initialized", userId: init.userId, capabilities: init.capabilities });
      this.markReady();
      // Re-subscribe every thread we hold, from where we left off.
      for (const [threadId, view] of Object.entries(this.state.views)) {
        void this.request("thread/resume", { threadId, afterSeq: view.lastSeq }).catch(() => {});
      }
      void this.refreshThreads();
    } catch (e) {
      if (e instanceof RpcError && e.code === ErrorCodes.unauthorized) {
        this.closed = true;
        this.dispatch({ type: "status", status: "unauthorized" });
        t.close();
      }
    }
  }

  private onFrame(raw: unknown) {
    const f = classifyFrame(raw);
    switch (f.kind) {
      case "response":
        return this.onResponse(f.frame);
      case "notification":
        return this.dispatch({
          type: "notification",
          method: f.frame.method,
          params: f.frame.params,
          seq: f.frame.seq,
        });
      case "request":
        return this.onServerRequest(f.frame.id, f.frame.method, f.frame.params);
      case "invalid":
        return;
    }
  }

  private onResponse(frame: RpcResponse) {
    if (frame.id === null) return;
    const p = this.pending.get(frame.id);
    if (!p) return;
    this.pending.delete(frame.id);
    if ("error" in frame)
      p.reject(new RpcError(frame.error.code, frame.error.message, frame.error.data));
    else p.resolve(frame.result);
  }

  private onServerRequest(id: string | number, method: string, params: unknown) {
    if (method === "approval/request") {
      const item = (params as { item?: Item } | undefined)?.item;
      if (item && item.type === "approvalRequest") {
        this.dispatch({ type: "approvalRequested", approvalId: item.approvalId, rpcId: id, item });
        return;
      }
    }
    this.transport?.send({
      id,
      error: { code: ErrorCodes.methodNotFound, message: `Client can't handle ${method}` },
    });
  }

  // ── requests ──

  private rawRequest(t: Transport, method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      t.send({ id, method, params });
    });
  }

  /** Typed request; waits for the connection to be initialized. */
  async request<M extends ClientMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    await this.ready;
    const t = this.transport;
    if (!t) throw new RpcError(ErrorCodes.internal, "Not connected");
    return (await this.rawRequest(t, method, params)) as ResultOf<M>;
  }

  private async resyncShop() {
    this.resyncing = true;
    try {
      await this.ready;
      const t = this.transport;
      if (!t) return;
      // `state/get` is an additive method; servers without it get a reconnect, whose
      // initialize always ends with a fresh `state/snapshot`.
      const r = (await this.rawRequest(t, "state/get", {})) as {
        version: number;
        state: ShopState;
      };
      this.dispatch({ type: "shopSnapshot", version: r.version, state: r.state });
    } catch (e) {
      if (e instanceof RpcError && e.code === ErrorCodes.methodNotFound) this.reconnect();
    } finally {
      this.resyncing = false;
    }
  }

  async refreshThreads() {
    const r = await this.request("thread/list", { includeArchived: false, limit: 50 });
    this.dispatch({ type: "threads", threads: r.threads });
    return r.threads;
  }

  /** Subscribe to a thread (replaying what we haven't seen) and make it the active one. */
  async openThread(threadId: string) {
    this.dispatch({ type: "subscribed", threadId });
    this.dispatch({ type: "activate", threadId });
    const afterSeq = this.state.views[threadId]?.lastSeq ?? 0;
    const r = await this.request("thread/resume", { threadId, afterSeq });
    this.dispatch({ type: "threads", threads: [r.thread] });
  }

  newThread() {
    this.dispatch({ type: "activate", threadId: undefined });
  }

  /** Send a message: steer the running turn if there is one, else start a turn. */
  async send(text: string, uiState?: Record<string, unknown>) {
    let threadId = this.state.activeThreadId;
    if (!threadId) {
      const { thread } = await this.request("thread/start", { title: text.slice(0, 80) });
      this.dispatch({ type: "threads", threads: [thread] });
      await this.openThread(thread.id);
      threadId = thread.id;
    }
    // A running turn takes new input as steering (Codex-style); widget intents ride along as text.
    const running = this.state.views[threadId]?.activeTurnId;
    if (running) {
      const r = await this.request("turn/steer", { threadId, turnId: running, text });
      if (r.accepted) return;
    }
    await this.request("turn/start", { threadId, text, ...(uiState ? { uiState } : {}) });
  }

  async interrupt() {
    const threadId = this.state.activeThreadId;
    const turnId = threadId ? this.state.views[threadId]?.activeTurnId : undefined;
    if (!threadId || !turnId) return;
    await this.request("turn/interrupt", { threadId, turnId });
  }

  async respondApproval(
    approvalId: string,
    decision: "approve" | "deny",
    extra: { edits?: Record<string, unknown>; assertion?: unknown } = {},
  ) {
    const rpcId = this.state.pendingApprovals[approvalId];
    const result: ServerRequestResultOf<"approval/request"> = {
      decision,
      ...(extra.edits ? { edits: extra.edits } : {}),
      ...(extra.assertion !== undefined ? { assertion: extra.assertion } : {}),
    };
    if (rpcId !== undefined && this.transport) {
      this.transport.send({ id: rpcId, result });
      this.dispatch({ type: "approvalAnswered", approvalId });
      return;
    }
    // Asked on another connection (or before a reconnect): answer by id.
    const r = await this.request("approval/respond", { approvalId, ...result });
    this.dispatch({ type: "approvalAnswered", approvalId });
    if (!r.accepted) throw new Error("This approval is no longer open.");
  }

  async invoke(name: ShopActionName | (string & {}), args?: unknown) {
    const r = await this.request("action/invoke", { name, args: args ?? {} });
    return r.result;
  }

  async takeControl(sessionId: string) {
    return this.request("browser/takeControl", { sessionId });
  }

  async handBack(sessionId: string, note?: string) {
    return this.request("browser/handBack", { sessionId, ...(note ? { note } : {}) });
  }

  dismissInbox() {
    this.dispatch({ type: "inboxDismissed" });
  }
}
