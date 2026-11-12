/**
 * A transport-agnostic JSON-RPC-lite peer for the client end of the socket (browser, tests,
 * scripts). It correlates responses to requests, dispatches notifications, answers
 * server-initiated requests (approvals) and tracks the last `seq` seen per thread, so a
 * reconnecting client can call `thread/resume { afterSeq: peer.lastSeq(threadId) }` and drop
 * duplicates if live frames race the replay.
 */
import {
  type ClientMethod,
  classifyFrame,
  ErrorCodes,
  type NotificationOf,
  type ParamsOf,
  type ResultOf,
  type ServerNotificationMethod,
  type ServerRequestMethod,
  type ServerRequestParamsOf,
  type ServerRequestResultOf,
} from "./protocol";

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

export type NotificationHandler<M extends ServerNotificationMethod> = (
  params: NotificationOf<M>,
  meta: { seq?: number },
) => void;

export type ServerRequestHandlers = {
  [M in ServerRequestMethod]?: (
    params: ServerRequestParamsOf<M>,
  ) => ServerRequestResultOf<M> | Promise<ServerRequestResultOf<M>>;
};

export interface RpcPeerOptions {
  /** Write one frame to the transport. */
  send(frame: string): void;
  serverRequests?: ServerRequestHandlers;
  /** Every notification, after seq de-duplication. Typed handlers can be added with `on`. */
  onNotification?(method: string, params: unknown, seq?: number): void;
  /** Default per-request timeout. 0 disables it. */
  timeoutMs?: number;
}

export interface RpcPeer {
  request<M extends ClientMethod>(
    method: M,
    params: ParamsOf<M>,
    opts?: { timeoutMs?: number },
  ): Promise<ResultOf<M>>;
  on<M extends ServerNotificationMethod>(method: M, handler: NotificationHandler<M>): () => void;
  /** Feed one inbound frame (string or parsed JSON). */
  receive(data: unknown): void;
  /** Highest `seq` seen for a thread (0 when none). */
  lastSeq(threadId: string): number;
  /** Reject everything in flight, e.g. when the socket closes. */
  dispose(reason?: string): void;
}

/** Thread-scoped notifications carry the thread id in one of these places. */
export function threadIdOf(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const p = params as Record<string, unknown>;
  if (typeof p.threadId === "string") return p.threadId;
  for (const key of ["item", "turn"] as const) {
    const inner = p[key] as Record<string, unknown> | undefined;
    if (inner && typeof inner.threadId === "string") return inner.threadId;
  }
  const thread = p.thread as Record<string, unknown> | undefined;
  return thread && typeof thread.id === "string" ? thread.id : undefined;
}

export function createRpcPeer(opts: RpcPeerOptions): RpcPeer {
  let nextId = 1;
  const pending = new Map<
    string | number,
    { resolve(v: unknown): void; reject(e: Error): void; timer?: ReturnType<typeof setTimeout> }
  >();
  const handlers = new Map<string, Set<(params: unknown, meta: { seq?: number }) => void>>();
  const seqs = new Map<string, number>();

  const sendJson = (frame: unknown) => opts.send(JSON.stringify(frame));

  async function answerServerRequest(id: string | number, method: string, params: unknown) {
    const handler = opts.serverRequests?.[method as ServerRequestMethod];
    if (!handler) {
      sendJson({
        id,
        error: { code: ErrorCodes.methodNotFound, message: `no handler: ${method}` },
      });
      return;
    }
    try {
      const result = await handler(params as never);
      sendJson({ id, result });
    } catch (err) {
      sendJson({
        id,
        error: { code: ErrorCodes.internal, message: err instanceof Error ? err.message : "error" },
      });
    }
  }

  return {
    request(method, params, reqOpts) {
      const id = nextId++;
      const timeoutMs = reqOpts?.timeoutMs ?? opts.timeoutMs ?? 30_000;
      return new Promise((resolve, reject) => {
        const entry: {
          resolve(v: unknown): void;
          reject(e: Error): void;
          timer?: ReturnType<typeof setTimeout>;
        } = { resolve: resolve as (v: unknown) => void, reject };
        if (timeoutMs > 0) {
          entry.timer = setTimeout(() => {
            pending.delete(id);
            reject(new RpcRequestError(ErrorCodes.internal, `${method} timed out`));
          }, timeoutMs);
        }
        pending.set(id, entry);
        sendJson({ id, method, params });
      });
    },

    on(method, handler) {
      let set = handlers.get(method);
      if (!set) {
        set = new Set();
        handlers.set(method, set);
      }
      const h = handler as (params: unknown, meta: { seq?: number }) => void;
      set.add(h);
      return () => set.delete(h);
    },

    receive(data) {
      let raw = data;
      if (typeof data === "string") {
        try {
          raw = JSON.parse(data);
        } catch {
          return;
        }
      }
      const c = classifyFrame(raw);
      if (c.kind === "response") {
        const entry = c.frame.id === null ? undefined : pending.get(c.frame.id);
        if (!entry || c.frame.id === null) return;
        pending.delete(c.frame.id);
        if (entry.timer) clearTimeout(entry.timer);
        if ("error" in c.frame) {
          entry.reject(
            new RpcRequestError(c.frame.error.code, c.frame.error.message, c.frame.error.data),
          );
        } else {
          entry.resolve(c.frame.result);
        }
      } else if (c.kind === "request") {
        void answerServerRequest(c.frame.id, c.frame.method, c.frame.params);
      } else if (c.kind === "notification") {
        const { method, params, seq } = c.frame;
        if (seq !== undefined) {
          const threadId = threadIdOf(params);
          if (threadId) {
            if (seq <= (seqs.get(threadId) ?? 0)) return;
            seqs.set(threadId, seq);
          }
        }
        opts.onNotification?.(method, params, seq);
        for (const h of handlers.get(method) ?? []) h(params, seq === undefined ? {} : { seq });
      }
    },

    lastSeq: (threadId) => seqs.get(threadId) ?? 0,

    dispose(reason = "disposed") {
      for (const [id, entry] of pending) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new RpcRequestError(ErrorCodes.internal, reason));
        pending.delete(id);
      }
    },
  };
}
