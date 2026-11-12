/**
 * ShopperAgent: the App Server. One Durable Object per user (name = authenticated user id),
 * speaking `@shop/agent-protocol` over its hibernating WebSockets. It hosts the thread manager
 * (`@shop/harness`) on SQLite, broadcasts product state as `state/snapshot` + versioned
 * `state/patch`, sends approval requests to every connected surface, and runs scheduled work.
 *
 * The Agents SDK's own protocol frames (identity, state sync) are switched off so clients only
 * ever see our frames.
 */
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import {
  type ClientMethod,
  ClientRequests,
  classifyFrame,
  diffJson,
  ErrorCodes,
  PROTOCOL_VERSION,
  type ResultOf,
  ServerRequests,
  threadIdOf,
} from "@shop/agent-protocol";
import {
  type ApprovalItem,
  buildSystemPrompt,
  createHarness,
  type Harness,
  HarnessError,
  type ModelEnv,
  type Notification,
  resolveModelProvider,
} from "@shop/harness";
import { Agent, type Connection, type WSMessage } from "agents";
import { z } from "zod";
import { createAguiTranslator, interpretRunInput } from "./agui";
import { commerceDomain } from "./commerce-domain";
import type { ShopDomain, ShopDomainContext } from "./domain";
import { SqlPrivateStore, SqlStateStore, type SqlTag, SqlThreadStore } from "./sql-store";
import { stubDomain } from "./stub-domain";

export interface ShopEnv extends ModelEnv {
  SHOPPER_AGENT: DurableObjectNamespace<ShopperAgent>;
  /** Max model steps per turn (default 8). */
  SHOP_MAX_STEPS?: string;
  /** Approval time-to-live in seconds (default 900). */
  SHOP_APPROVAL_TTL_SECONDS?: string;
  /** "stub" swaps the commerce domain for canned demo tools (protocol tests). */
  SHOP_DOMAIN?: string;
}

interface ConnState {
  initialized: boolean;
  /** Threads this socket receives thread-scoped notifications for. */
  threads: string[];
  client?: string;
}

const MAX_FRAME_BYTES = 64 * 1024;
const USER_AGENT = "cited-shop/0.1";

type Core = {
  harness: Harness;
  domain: ShopDomain<unknown>;
  state: SqlStateStore;
};

type Params<M extends ClientMethod> = Defined<z.output<(typeof ClientRequests)[M]["params"]>>;
type Handlers = {
  [M in ClientMethod]: (p: Params<M>, conn: Connection) => ResultOf<M> | Promise<ResultOf<M>>;
};

class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export class ShopperAgent extends Agent<ShopEnv> {
  static override options = { sendIdentityOnConnect: false };

  private core?: Core;
  /** In-process subscribers (AG-UI streams) to every notification. */
  private readonly listeners = new Set<(n: Notification) => void>();

  /** The product domain: `@shop/commerce`, or the canned stub when `SHOP_DOMAIN=stub` (tests). */
  protected createDomain(ctx: ShopDomainContext<never>): ShopDomain<unknown> {
    if (this.env.SHOP_DOMAIN === "stub") return stubDomain(ctx as never) as ShopDomain<unknown>;
    return commerceDomain(ctx as never) as ShopDomain<unknown>;
  }

  override shouldSendProtocolMessages(): boolean {
    return false;
  }

  get userId(): string {
    return this.name;
  }

  private get app(): Core {
    if (this.core) return this.core;
    const sql = this.sql.bind(this) as SqlTag;
    const store = new SqlThreadStore(sql);
    const state = new SqlStateStore(sql);
    const domainCtx = this.domainContext(state, new SqlPrivateStore(sql));
    const domain = this.createDomain(domainCtx as ShopDomainContext<never>);
    const env = this.env;
    const harness = createHarness({
      userId: this.userId,
      store,
      model: resolveModelProvider(env, {
        ...(domain.fakeRules ? { rules: domain.fakeRules } : {}),
        ...(domain.fakeScript ? { script: domain.fakeScript } : {}),
      }),
      tools: domain.tools,
      systemPrompt: () =>
        buildSystemPrompt({
          role: "CITED Shop's shopping agent, working for one signed-in user",
          tools: domain.tools,
          now: new Date(),
          exa: true,
          ...(domain.systemPrompt ? { domain: domain.systemPrompt } : {}),
        }),
      publish: (n) => this.publishThread(n),
      requestApproval: (item) => this.broadcastApproval(item),
      onApprovalPending: (item) => {
        void this.schedule(new Date(item.expiresAt), "expireApprovals");
      },
      ...(domain.verifyStepUp ? { verifyStepUp: domain.verifyStepUp } : {}),
      ...(env.SHOP_MAX_STEPS ? { maxSteps: Number(env.SHOP_MAX_STEPS) } : {}),
      ...(env.SHOP_APPROVAL_TTL_SECONDS
        ? { approvalTtlMs: Number(env.SHOP_APPROVAL_TTL_SECONDS) * 1000 }
        : {}),
    });
    this.core = { harness, domain, state };
    return this.core;
  }

  // ── Product state ──

  private readState(state: SqlStateStore, domain?: ShopDomain<unknown>) {
    const d = domain ?? this.core?.domain;
    const stored = state.read();
    if (!stored || !d)
      return { version: stored?.version ?? 0, state: stored?.state ?? d?.initialState };
    if (d.stateSchema && !d.stateSchema.safeParse(stored.state).success) {
      return { version: stored.version, state: d.initialState };
    }
    return stored;
  }

  private domainContext(
    stateStore: SqlStateStore,
    privateStore: SqlPrivateStore,
  ): ShopDomainContext<unknown> {
    return {
      getPrivate: () => privateStore.read(),
      setPrivate: (value) => privateStore.write(value),
      userId: this.userId,
      env: this.env as unknown as Record<string, unknown>,
      now: () => new Date(),
      getState: () => this.readState(stateStore).state,
      updateState: (fn) => {
        const cur = this.readState(stateStore);
        const next = fn(cur.state);
        const ops = diffJson(cur.state, next);
        if (ops.length === 0) return next;
        const version = cur.version + 1;
        stateStore.write(version, next);
        this.publishUser({
          method: "state/patch",
          params: { version, baseVersion: cur.version, ops },
        });
        return next;
      },
      notify: (entry) =>
        this.publishUser({
          method: "inbox/added",
          params: { id: `inb_${crypto.randomUUID()}`, at: new Date().toISOString(), ...entry },
        }),
      schedule: async (when, payload) =>
        (await this.schedule(when, "runDomainSchedule", payload)).id,
      cancelSchedule: (id) => this.cancelSchedule(id),
      startTurn: async ({ threadId, text, origin, title }) => {
        const { harness } = this.app;
        const id = threadId ?? harness.startThread(title ? { title } : {}).id;
        const { turn, done } = harness.startTurn({ threadId: id, text, origin });
        void this.keepAliveWhile(() => done);
        return turn;
      },
    };
  }

  // ── Fan-out ──

  private connState(conn: Connection): ConnState {
    return (conn.state as ConnState | null) ?? { initialized: false, threads: [] };
  }

  private send(conn: Connection, frame: unknown) {
    try {
      conn.send(JSON.stringify(frame));
    } catch {
      // The socket closed under us; the client resumes with afterSeq.
    }
  }

  private publishThread(n: Notification) {
    const threadId = threadIdOf(n.params);
    for (const conn of this.getConnections()) {
      const s = this.connState(conn);
      if (s.initialized && threadId && s.threads.includes(threadId)) this.send(conn, n);
    }
    for (const l of this.listeners) l(n);
  }

  private publishUser(n: Notification) {
    for (const conn of this.getConnections()) {
      if (this.connState(conn).initialized) this.send(conn, n);
    }
    for (const l of this.listeners) l(n);
  }

  private approvalFrame(item: ApprovalItem) {
    return { id: item.approvalId, method: "approval/request", params: { item } };
  }

  private broadcastApproval(item: ApprovalItem) {
    for (const conn of this.getConnections()) {
      if (this.connState(conn).initialized) this.send(conn, this.approvalFrame(item));
    }
  }

  private subscribe(conn: Connection, threadId: string) {
    const s = this.connState(conn);
    if (!s.threads.includes(threadId)) {
      conn.setState({ ...s, threads: [...s.threads, threadId].slice(-50) });
    }
  }

  // ── WebSocket protocol ──

  override onConnect(conn: Connection) {
    conn.setState({ initialized: false, threads: [] } satisfies ConnState);
  }

  override async onMessage(conn: Connection, message: WSMessage) {
    if (typeof message !== "string" || message.length > MAX_FRAME_BYTES) {
      this.send(conn, {
        id: null,
        error: { code: ErrorCodes.invalidRequest, message: "frame too large or binary" },
      });
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      this.send(conn, {
        id: null,
        error: { code: ErrorCodes.parseError, message: "invalid JSON" },
      });
      return;
    }
    const frame = classifyFrame(raw);
    if (frame.kind === "invalid") {
      this.send(conn, {
        id: null,
        error: { code: ErrorCodes.invalidRequest, message: "invalid frame" },
      });
      return;
    }
    if (frame.kind === "notification") return;
    if (frame.kind === "response") {
      await this.onClientResponse(conn, frame.frame);
      return;
    }
    const { id, method, params } = frame.frame;
    try {
      const result = await this.dispatch(conn, method, params);
      this.send(conn, { id, result });
      if (method === "initialize") this.afterInitialize(conn);
      if (method === "thread/resume") this.replay(conn, params);
    } catch (err) {
      this.send(conn, { id, error: toRpcError(err) });
    }
  }

  /** A client answered a server request: today only `approval/request`, keyed by approval id. */
  private async onClientResponse(
    conn: Connection,
    frame: { id: string | number | null; result?: unknown },
  ) {
    if (!this.connState(conn).initialized || typeof frame.id !== "string" || !("result" in frame))
      return;
    const parsed = ServerRequests["approval/request"].result.safeParse(frame.result);
    if (!parsed.success) return;
    const r = await this.app.harness.respondApproval({
      approvalId: frame.id,
      ...stripUndefined(parsed.data),
    });
    if (r.done) void this.keepAliveWhile(() => r.done as Promise<unknown>);
  }

  private afterInitialize(conn: Connection) {
    const { state } = this.app;
    const s = this.readState(state);
    this.send(conn, { method: "state/snapshot", params: { version: s.version, state: s.state } });
    // A surface that connects later can still answer what's waiting.
    for (const a of this.app.harness.pendingApprovals()) this.send(conn, this.approvalFrame(a));
  }

  /**
   * Replay and subscribe in one synchronous block: no live frame can reach this socket between
   * them, so the client sees every seq once and in order.
   */
  private replay(conn: Connection, rawParams: unknown) {
    const p = ClientRequests["thread/resume"].params.parse(rawParams);
    for (const e of this.app.harness.replay(p.threadId, p.afterSeq)) {
      this.send(conn, { method: e.method, seq: e.seq, params: e.params });
    }
    this.subscribe(conn, p.threadId);
  }

  private async dispatch(conn: Connection, method: string, rawParams: unknown): Promise<unknown> {
    if (!Object.hasOwn(ClientRequests, method)) {
      throw new RpcFailure(ErrorCodes.methodNotFound, `unknown method: ${method}`);
    }
    const m = method as ClientMethod;
    if (m !== "initialize" && !this.connState(conn).initialized) {
      throw new RpcFailure(ErrorCodes.notInitialized, "send initialize first");
    }
    const parsed = ClientRequests[m].params.safeParse(rawParams ?? {});
    if (!parsed.success)
      throw new RpcFailure(ErrorCodes.invalidParams, z.prettifyError(parsed.error));
    const handler = this.handlers[m] as (p: unknown, conn: Connection) => unknown;
    return handler(stripUndefined(parsed.data as object), conn);
  }

  private readonly handlers: Handlers = {
    initialize: (p, conn) => {
      const cs = this.connState(conn);
      if (cs.initialized) throw new RpcFailure(ErrorCodes.invalidRequest, "already initialized");
      conn.setState({ ...cs, initialized: true, client: p.clientInfo.name } satisfies ConnState);
      return {
        userAgent: USER_AGENT,
        protocolVersion: PROTOCOL_VERSION,
        userId: this.userId,
        capabilities: [...(this.app.domain.capabilities ?? [])],
      };
    },
    "thread/start": (p, conn) => {
      const thread = this.app.harness.startThread(p);
      this.subscribe(conn, thread.id);
      return { thread };
    },
    // Subscribing happens after the response, together with the replay (see onMessage).
    "thread/resume": (p) => ({
      thread: this.app.harness.getThread(p.threadId),
      lastSeq: this.app.harness.lastSeq(p.threadId),
    }),
    "thread/fork": (p, conn) => {
      const thread = this.app.harness.forkThread(p);
      this.subscribe(conn, thread.id);
      return { thread };
    },
    "thread/list": (p) => this.app.harness.listThreads(p),
    "thread/read": (p) => this.app.harness.readThread(p.threadId),
    "thread/archive": (p) => {
      this.app.harness.archiveThread(p.threadId, p.archived);
      return {};
    },
    "turn/start": (p, conn) => {
      this.subscribe(conn, p.threadId);
      const { turn, done } = this.app.harness.startTurn(p);
      void this.keepAliveWhile(() => done);
      return { turn };
    },
    "turn/steer": (p) => ({ accepted: this.app.harness.steer(p) }),
    "turn/interrupt": async (p) => {
      await this.app.harness.interrupt(p);
      return {};
    },
    "approval/respond": async (p) => {
      const r = await this.app.harness.respondApproval(p);
      if (r.done) void this.keepAliveWhile(() => r.done as Promise<unknown>);
      return { accepted: r.accepted };
    },
    "action/invoke": async (p) => {
      const action = this.app.domain.actions[p.name];
      if (!action || !Object.hasOwn(this.app.domain.actions, p.name)) {
        throw new RpcFailure(ErrorCodes.notFound, `unknown action: ${p.name}`);
      }
      const args = action.args.safeParse(p.args ?? {});
      if (!args.success)
        throw new RpcFailure(ErrorCodes.invalidParams, z.prettifyError(args.error));
      const result = await action.run(args.data);
      return result === undefined ? {} : { result };
    },
    "browser/takeControl": () => {
      throw new RpcFailure(ErrorCodes.methodNotFound, "the browser pane isn't available yet");
    },
    "browser/handBack": () => {
      throw new RpcFailure(ErrorCodes.methodNotFound, "the browser pane isn't available yet");
    },
  };

  // ── Scheduled work (method names are schedule callbacks) ──

  async expireApprovals() {
    await this.app.harness.expireApprovals();
  }

  async runDomainSchedule(payload: unknown) {
    await this.keepAliveWhile(async () => {
      await this.app.domain.onSchedule?.(payload);
    });
  }

  // ── AG-UI over HTTP (SSE) ──

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/agui"))
      return this.handleAgui(request);
    // Read-only product state for the apps home (/home); never mutates or runs a turn.
    if (request.method === "GET" && url.pathname.endsWith("/state"))
      return Response.json(this.readState(this.app.state, this.app.domain).state ?? null);
    return new Response("not found", { status: 404 });
  }

  private async handleAgui(request: Request): Promise<Response> {
    let input: RunAgentInput;
    try {
      input = (await request.json()) as RunAgentInput;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    if (
      typeof input?.threadId !== "string" ||
      typeof input.runId !== "string" ||
      !Array.isArray(input.messages)
    ) {
      return Response.json({ error: "invalid_run_input" }, { status: 400 });
    }
    const threadIdOk = /^[A-Za-z0-9_-]{1,128}$/.test(input.threadId);
    if (!threadIdOk) return Response.json({ error: "invalid_thread_id" }, { status: 400 });
    const command = interpretRunInput(input);
    if (command.kind === "invalid")
      return Response.json({ error: command.message }, { status: 400 });

    const { harness, state } = this.app;
    const encoder = new EventEncoder({
      accept: request.headers.get("accept") ?? "text/event-stream",
    });
    const stream = new TransformStream<string, string>();
    const writer = stream.writable.getWriter();
    const translator = createAguiTranslator({
      threadId: input.threadId,
      runId: input.runId,
      pendingApprovals: (turn) =>
        harness
          .pendingApprovals()
          .filter((a) => a.threadId === turn.threadId && a.turnId === turn.id),
    });

    let close: () => void = () => {};
    const ended = new Promise<void>((resolve) => {
      close = resolve;
    });
    const write = (events: ReturnType<typeof translator.translate>) => {
      for (const e of events) void writer.write(encoder.encodeSSE(e));
      if (translator.finished) close();
    };
    const listener = (n: Notification) => {
      const threadId = threadIdOf(n.params);
      if (threadId && threadId !== input.threadId) return;
      write(translator.translate(n.method, n.params));
    };

    write(translator.start(this.readState(state).state));
    this.listeners.add(listener);
    const run = async () => {
      try {
        if (!threadExists(harness, input.threadId)) harness.startThread({ id: input.threadId });
        if (command.kind === "resume") {
          let done: Promise<unknown> | undefined;
          for (const a of command.answers) {
            const r = await harness.respondApproval(stripUndefined(a));
            done = r.done ?? done;
          }
          if (!done) {
            write([{ type: EventType.RUN_ERROR, message: "Nothing to resume." }]);
            close();
          }
        } else {
          harness.startTurn({ threadId: input.threadId, text: command.text });
        }
        await ended;
      } catch (err) {
        if (!translator.finished) {
          void writer.write(
            encoder.encodeSSE({ type: EventType.RUN_ERROR, message: toRpcError(err).message }),
          );
        }
      } finally {
        this.listeners.delete(listener);
        await writer.close().catch(() => {});
      }
    };
    void this.keepAliveWhile(run);
    return new Response(stream.readable.pipeThrough(new TextEncoderStream()), {
      headers: {
        "content-type": encoder.getContentType(),
        "cache-control": "no-cache",
      },
    });
  }
}

function threadExists(harness: Harness, threadId: string): boolean {
  try {
    harness.getThread(threadId);
    return true;
  } catch {
    return false;
  }
}

function toRpcError(err: unknown): { code: number; message: string } {
  if (err instanceof RpcFailure || err instanceof HarnessError)
    return { code: err.code, message: err.message };
  if (err instanceof z.ZodError)
    return { code: ErrorCodes.invalidParams, message: z.prettifyError(err) };
  return { code: ErrorCodes.internal, message: "internal error" };
}

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/** Zod output types carry `T | undefined` for optional keys; exactOptionalPropertyTypes wants them gone. */
function stripUndefined<T extends object>(o: T): Defined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}
