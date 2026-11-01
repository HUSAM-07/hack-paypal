import {
  type ClientMethod,
  ClientRequests,
  type NotificationOf,
  type ParamsOf,
  PROTOCOL_VERSION,
  type ResultOf,
  RpcNotification,
  RpcResponse,
  type ServerNotificationMethod,
  ServerNotifications,
} from "@pact/protocol";

/** The subset of `WebSocket` the client relies on, so the mock server can stand in for it. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type AnyNotification = {
  [M in ServerNotificationMethod]: {
    method: M;
    seq: number | undefined;
    params: NotificationOf<M>;
  };
}[ServerNotificationMethod];

export class RpcRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcRequestError";
  }
}

/** Thrown for requests in flight when the socket drops; the caller decides whether to retry. */
export class ConnectionLostError extends Error {
  constructor() {
    super("connection lost");
    this.name = "ConnectionLostError";
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  method: ClientMethod;
  timer: ReturnType<typeof setTimeout>;
}

export interface PactClientOptions {
  connect: () => SocketLike;
  clientInfo?: { name: string; version: string };
  requestTimeoutMs?: number;
  /** Backoff for reconnect attempt n (0-based). Defaults to capped exponential with jitter. */
  backoff?: (attempt: number) => number;
  onInitialized?: (result: ResultOf<"initialize">) => void;
}

const OPEN = 1;

function defaultBackoff(attempt: number): number {
  const base = Math.min(10_000, 400 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

/** Pulls the thread a notification belongs to, so `seq` can be tracked per thread. */
function threadIdOf(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const p = params as Record<string, unknown>;
  if (typeof p.threadId === "string") return p.threadId;
  const item = p.item as Record<string, unknown> | undefined;
  if (item && typeof item.threadId === "string") return item.threadId;
  const thread = p.thread as Record<string, unknown> | undefined;
  if (thread && typeof thread.id === "string") return thread.id;
  return undefined;
}

/**
 * Typed JSON-RPC-lite client for the Pact protocol.
 *
 * - Correlates responses to requests by id, with per-request timeouts.
 * - Validates every inbound notification against the protocol schemas; malformed
 *   frames are dropped rather than trusted.
 * - Tracks the highest `seq` seen per thread and drops replays at or below it, so a
 *   resume that overlaps already-applied events is harmless.
 * - On an unexpected close it reconnects with backoff, re-initializes, and sends
 *   `thread/resume { afterSeq }` for every subscribed thread before flushing queued requests.
 */
export class PactClient {
  private socket: SocketLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private outbox: { id: number; frame: string }[] = [];
  private ready = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly lastSeq = new Map<string, number>();
  private readonly subscribed = new Set<string>();
  private readonly listeners = new Set<(n: AnyNotification) => void>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  private _state: ConnectionState = "idle";
  userId: string | null = null;

  constructor(private readonly opts: PactClientOptions) {}

  get state(): ConnectionState {
    return this._state;
  }

  seqFor(threadId: string): number {
    return this.lastSeq.get(threadId) ?? 0;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "client stop");
    this.socket = null;
    this.failPending();
    this.setState("closed");
  }

  onNotification(fn: (n: AnyNotification) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /** Follow a thread: resume now if connected, and again after every reconnect. */
  async subscribe(threadId: string): Promise<ResultOf<"thread/resume"> | undefined> {
    this.subscribed.add(threadId);
    if (!this.ready) return undefined;
    return this.request("thread/resume", { threadId, afterSeq: this.seqFor(threadId) });
  }

  request<M extends ClientMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const id = this.nextId++;
    const frame = JSON.stringify({ id, method, params });
    return new Promise<ResultOf<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.outbox = this.outbox.filter((o) => o.id !== id);
        reject(new RpcRequestError(-32000, `${method} timed out`));
      }, this.opts.requestTimeoutMs ?? 20_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method, timer });
      if (this.ready && this.socket?.readyState === OPEN) this.socket.send(frame);
      else this.outbox.push({ id, frame });
    });
  }

  // ── internals ──

  private setState(s: ConnectionState) {
    if (this._state === s) return;
    this._state = s;
    for (const fn of this.stateListeners) fn(s);
  }

  private open() {
    this.setState(this.attempt === 0 ? "connecting" : "reconnecting");
    const socket = this.opts.connect();
    this.socket = socket;
    socket.onopen = () => void this.handshake(socket);
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onclose = () => this.handleClose(socket);
    socket.onerror = () => {
      // onclose follows; reconnect is handled there.
    };
  }

  private async handshake(socket: SocketLike) {
    try {
      const result = await this.rawRequest(socket, "initialize", {
        clientInfo: this.opts.clientInfo ?? { name: "pact-web", version: "0.0.0" },
        protocolVersion: PROTOCOL_VERSION,
      });
      this.userId = result.userId;
      this.opts.onInitialized?.(result);
      await Promise.all(
        [...this.subscribed].map((threadId) =>
          this.rawRequest(socket, "thread/resume", { threadId, afterSeq: this.seqFor(threadId) }),
        ),
      );
      if (socket !== this.socket) return;
      this.ready = true;
      this.attempt = 0;
      this.setState("open");
      const queued = this.outbox;
      this.outbox = [];
      for (const { frame } of queued) socket.send(frame);
    } catch {
      socket.close(4000, "handshake failed");
    }
  }

  /** Sends on a specific socket, bypassing the ready gate (handshake only). */
  private rawRequest<M extends ClientMethod>(
    socket: SocketLike,
    method: M,
    params: ParamsOf<M>,
  ): Promise<ResultOf<M>> {
    const id = this.nextId++;
    return new Promise<ResultOf<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcRequestError(-32000, `${method} timed out`));
      }, this.opts.requestTimeoutMs ?? 20_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  private handleFrame(raw: unknown) {
    if (typeof raw !== "string") return;
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg && typeof msg === "object" && "id" in msg && !("method" in msg)) {
      this.handleResponse(msg);
      return;
    }
    const n = RpcNotification.safeParse(msg);
    if (!n.success) return;
    const { method, seq, params } = n.data;
    const schema = ServerNotifications[method as ServerNotificationMethod];
    if (!schema) return;
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      console.warn(`[pact] dropped malformed ${method}`, parsed.error.issues);
      return;
    }
    if (seq !== undefined) {
      const threadId = threadIdOf(parsed.data);
      if (threadId) {
        if (seq <= this.seqFor(threadId)) return; // replay of something already applied
        this.lastSeq.set(threadId, seq);
      }
    }
    const notification = { method, seq, params: parsed.data } as AnyNotification;
    for (const fn of this.listeners) fn(notification);
  }

  private handleResponse(msg: unknown) {
    const r = RpcResponse.safeParse(msg);
    if (!r.success || r.data.id === null) return;
    const id = Number(r.data.id);
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if ("error" in r.data) {
      p.reject(new RpcRequestError(r.data.error.code, r.data.error.message, r.data.error.data));
      return;
    }
    const schema = ClientRequests[p.method].result;
    const parsed = schema.safeParse(r.data.result);
    if (parsed.success) p.resolve(parsed.data);
    else p.reject(new RpcRequestError(-32603, `invalid ${p.method} result`));
  }

  private handleClose(socket: SocketLike) {
    if (socket !== this.socket) return;
    this.ready = false;
    this.socket = null;
    // Queued-but-unsent requests survive the reconnect; in-flight ones may or may not
    // have reached the server, so they fail and the caller decides.
    const queued = new Set(this.outbox.map((o) => o.id));
    for (const [id, p] of this.pending) {
      if (queued.has(id)) continue;
      clearTimeout(p.timer);
      p.reject(new ConnectionLostError());
      this.pending.delete(id);
    }
    if (this.stopped) {
      this.setState("closed");
      return;
    }
    this.setState("reconnecting");
    const delay = (this.opts.backoff ?? defaultBackoff)(this.attempt++);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private failPending() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ConnectionLostError());
    }
    this.pending.clear();
    this.outbox = [];
  }
}
