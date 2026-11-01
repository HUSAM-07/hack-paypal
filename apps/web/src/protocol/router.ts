import type { ClientMethod, ParamsOf, ResultOf } from "@pact/protocol";
import {
  type AnyNotification,
  type ConnectionState,
  PactClient,
  type PactClientOptions,
  type SocketLike,
} from "./client";

/** What the app needs from a protocol connection; both `PactClient` and `ThreadRouter` fit. */
export interface ProtocolClient {
  readonly state: ConnectionState;
  readonly userId: string | null;
  start(): void;
  stop(): void;
  onNotification(fn: (n: AnyNotification) => void): () => void;
  onState(fn: (s: ConnectionState) => void): () => void;
  subscribe(threadId: string): Promise<ResultOf<"thread/resume"> | undefined>;
  request<M extends ClientMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
}

export interface ThreadRouterOptions extends Pick<PactClientOptions, "backoff" | "clientInfo"> {
  /** Socket URL for a thread id, or for `"new"` (the lobby). */
  url: (thread: string) => string;
  socket?: (url: string) => SocketLike;
}

/** Mutable so a lobby socket that started a thread reconnects to that thread. */
interface Target {
  thread: string;
}

/**
 * The worker binds each WebSocket to one thread (its ThreadDO owns the socket), so
 * the app talks to it through one `PactClient` per thread plus a lobby socket
 * (`?thread=new`) for `thread/list` and `thread/start`. A lobby that starts a thread
 * becomes that thread's socket and a fresh lobby takes its place.
 */
export class ThreadRouter implements ProtocolClient {
  private lobbyTarget: Target = { thread: "new" };
  private lobby: PactClient;
  private readonly byThread = new Map<string, PactClient>();
  private readonly listeners = new Set<(n: AnyNotification) => void>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  private started = false;
  private lastState: ConnectionState = "idle";
  userId: string | null = null;

  constructor(private readonly opts: ThreadRouterOptions) {
    this.lobby = this.make(this.lobbyTarget);
  }

  /** The lobby's state, except that any thread socket reconnecting shows as reconnecting. */
  get state(): ConnectionState {
    for (const c of this.byThread.values()) if (c.state === "reconnecting") return "reconnecting";
    return this.lobby.state;
  }

  start(): void {
    this.started = true;
    this.lobby.start();
    for (const c of this.byThread.values()) c.start();
  }

  stop(): void {
    this.started = false;
    this.lobby.stop();
    for (const c of this.byThread.values()) c.stop();
  }

  onNotification(fn: (n: AnyNotification) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  subscribe(threadId: string): Promise<ResultOf<"thread/resume"> | undefined> {
    return this.forThread(threadId).subscribe(threadId);
  }

  request<M extends ClientMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    if (method === "thread/start") {
      return this.startThread(params as ParamsOf<"thread/start">) as Promise<ResultOf<M>>;
    }
    const threadId = (params as { threadId?: unknown }).threadId;
    const client = typeof threadId === "string" ? this.forThread(threadId) : this.lobby;
    return client.request(method, params);
  }

  private async startThread(params: ParamsOf<"thread/start">): Promise<ResultOf<"thread/start">> {
    // Swap the lobby out before sending, so concurrent starts each get their own socket.
    const target = this.lobbyTarget;
    const client = this.lobby;
    this.lobbyTarget = { thread: "new" };
    this.lobby = this.make(this.lobbyTarget);
    try {
      const result = await client.request("thread/start", params);
      target.thread = result.thread.id;
      this.byThread.set(result.thread.id, client);
      // Already subscribed server-side; this records it so reconnects resume the thread.
      void client.subscribe(result.thread.id).catch(() => {});
      return result;
    } catch (e) {
      client.stop();
      throw e;
    }
  }

  private forThread(threadId: string): PactClient {
    let client = this.byThread.get(threadId);
    if (!client) {
      client = this.make({ thread: threadId });
      this.byThread.set(threadId, client);
    }
    return client;
  }

  private make(target: Target): PactClient {
    const socket = this.opts.socket ?? ((url: string) => new WebSocket(url));
    const client = new PactClient({
      connect: () => socket(this.opts.url(target.thread)),
      ...(this.opts.backoff ? { backoff: this.opts.backoff } : {}),
      ...(this.opts.clientInfo ? { clientInfo: this.opts.clientInfo } : {}),
      onInitialized: (r) => {
        this.userId = r.userId;
      },
    });
    client.onNotification((n) => {
      for (const fn of this.listeners) fn(n);
    });
    client.onState(() => this.emitState());
    if (this.started) client.start();
    return client;
  }

  private emitState() {
    const s = this.state;
    if (s === this.lastState) return;
    this.lastState = s;
    for (const fn of this.stateListeners) fn(s);
  }
}
