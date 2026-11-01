/**
 * One Durable Object per chat thread: the "thread manager" from the Codex App Server
 * pattern. It owns the thread's sockets (Hibernation API), its notification log in DO
 * SQLite, and the agent loop. Every notification gets a monotonic per-thread `seq` and
 * is persisted, so a reconnecting client replays with `thread/resume { afterSeq }`.
 */
import { DurableObject } from "cloudflare:workers";
import { authorize } from "@pact/policy";
import {
  type ClientMethod,
  ClientRequests,
  ErrorCodes,
  type Item,
  type Money,
  type NotificationOf,
  Pact,
  type PactMember,
  PROTOCOL_VERSION,
  type ResultOf,
  RpcRequest,
  type ServerNotificationMethod,
  ServerNotifications,
  type SpendIntent,
  Thread,
} from "@pact/protocol";
import { ZodError, z } from "zod";
import { providerFor } from "../agent";
import { analyzeAgentText, CATALOG_VERSION, type StoredRef, systemPrompt } from "../agent/catalog";
import type { ChatMessage, ToolCall, ToolResult } from "../agent/provider";
import {
  type Member,
  runTool,
  TOOL_DEFS,
  type ToolContext,
  ToolError,
  type ToolOutcome,
} from "../agent/tools";
import { verifyAssertion } from "../auth/webauthn";
import type { Env } from "../env";
import { b64url, newId, nowIso } from "../ids";
import { commitMember, type PactRefData } from "../payments/pacts";

export type PactView = PactRefData & { merchant: string; category?: string };

export interface PaymentEventInput {
  kind: "charged" | "refunded" | "payoutSent" | "payoutFailed" | "chargeFailed" | "purchased";
  userId?: string;
  pactId?: string;
  amount: Money;
  paypalRef?: string;
}

export interface MemberStatusUpdate {
  pactId: string;
  userId: string;
  status: PactMember["status"];
}

export const SERVER_VERSION = "0.1.0";
const MAX_STEPS = 8;
const APPROVAL_TTL_MS = 15 * 60 * 1000;

interface Attachment {
  userId: string;
  initialized: boolean;
  /** Set by thread/start or thread/resume; only subscribed sockets get thread notifications. */
  subscribed: boolean;
}

interface PendingApproval {
  approvalId: string;
  itemId: string;
  turnId: string;
  approverId: string;
  call: ToolCall;
  /** Results of sibling tool calls from the same step, replayed to the model on resume. */
  siblingResults: ToolResult[];
  intent: SpendIntent;
  mandateId?: string;
  stepUp: boolean;
  challenge?: string;
  expiresAt: string;
}

class RpcFail extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** Per-request context. `defer` runs right after the response is sent, in the same tick. */
interface Call {
  ws: WebSocket;
  att: Attachment;
  defer(fn: () => void): void;
}

type Handler = (call: Call, params: never) => Promise<unknown> | unknown;

export class ThreadDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private active: { turnId: string; abort: AbortController } | undefined;
  /** Approvals mid-verification; guards against two concurrent approve calls. */
  private settling = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, method TEXT NOT NULL, params TEXT NOT NULL, item_id TEXT);
      CREATE INDEX IF NOT EXISTS events_item ON events(item_id);
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS refs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, status TEXT NOT NULL, author_id TEXT NOT NULL);
    `);
    // A turn can't survive an eviction (its model stream lived in memory). Close it out
    // so clients never wait on a turn that will not finish.
    const threadId = this.meta("threadId");
    for (const t of this.sql
      .exec<{ id: string }>("SELECT id FROM turns WHERE status = 'running'")
      .toArray()) {
      this.sql.exec("UPDATE turns SET status = 'failed' WHERE id = ?", t.id);
      if (threadId) this.emit("turn/completed", { threadId, turnId: t.id, status: "failed" });
    }
  }

  // ── Transport ──

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const userId = request.headers.get("x-pact-user");
    const threadId = request.headers.get("x-pact-thread");
    if (!userId || !threadId) return new Response("bad request", { status: 400 });

    const thread = this.thread();
    if (thread) {
      if (!thread.memberIds.includes(userId)) return new Response("forbidden", { status: 403 });
    } else {
      const creator = this.meta("creatorId");
      if (request.headers.get("x-pact-new") === "1" && !creator) {
        this.setMeta("threadId", threadId);
        this.setMeta("creatorId", userId);
      } else if (creator !== userId) {
        return new Response("not found", { status: 404 });
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({
      userId,
      initialized: false,
      subscribed: false,
    } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let id: string | number | null = null;
    try {
      if (typeof message !== "string" || message.length > 64_000) {
        throw new RpcFail(ErrorCodes.invalidRequest, "frames must be JSON text under 64KB");
      }
      let json: unknown;
      try {
        json = JSON.parse(message);
      } catch {
        throw new RpcFail(ErrorCodes.parseError, "invalid JSON");
      }
      const req = RpcRequest.safeParse(json);
      if (!req.success)
        throw new RpcFail(ErrorCodes.invalidRequest, "expected {id, method, params}");
      id = req.data.id;
      const method = req.data.method;
      if (!Object.hasOwn(ClientRequests, method)) {
        throw new RpcFail(ErrorCodes.methodNotFound, `unknown method ${method.slice(0, 64)}`);
      }
      const att = ws.deserializeAttachment() as Attachment;
      if (!att.initialized && method !== "initialize") {
        throw new RpcFail(ErrorCodes.notInitialized, "send initialize first");
      }
      if (att.initialized && method === "initialize") {
        throw new RpcFail(ErrorCodes.invalidRequest, "already initialized");
      }
      const spec = ClientRequests[method as ClientMethod];
      const params = spec.params.safeParse(req.data.params ?? {});
      if (!params.success)
        throw new RpcFail(ErrorCodes.invalidParams, z.prettifyError(params.error));
      const handler = this.handlers[method as ClientMethod] as Handler;
      const deferred: (() => void)[] = [];
      const result = await handler(
        { ws, att, defer: (fn) => deferred.push(fn) },
        params.data as never,
      );
      ws.send(JSON.stringify({ id, result }));
      for (const fn of deferred) fn();
    } catch (err) {
      const fail =
        err instanceof RpcFail ? err : new RpcFail(ErrorCodes.internal, "internal error");
      if (!(err instanceof RpcFail)) console.error("rpc handler failed", (err as Error)?.name);
      ws.send(JSON.stringify({ id, error: { code: fail.code, message: fail.message } }));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      // already closed
    }
    this.broadcastPresence(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
  }

  // ── RPC methods ──

  private handlers: {
    [M in ClientMethod]: (
      call: Call,
      params: z.infer<(typeof ClientRequests)[M]["params"]>,
    ) => Promise<ResultOf<M>> | ResultOf<M>;
  } = {
    initialize: ({ ws, att }, p) => {
      if (p.protocolVersion !== PROTOCOL_VERSION) {
        throw new RpcFail(
          ErrorCodes.invalidParams,
          `unsupported protocolVersion ${p.protocolVersion}`,
        );
      }
      this.setAttachment(ws, { ...att, initialized: true });
      return {
        serverVersion: SERVER_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        catalogVersion: CATALOG_VERSION,
        userId: att.userId,
      };
    },

    "thread/start": async ({ ws, att, defer }, p) => {
      if (this.thread())
        throw new RpcFail(ErrorCodes.invalidRequest, "thread already started; use thread/resume");
      if (this.meta("creatorId") !== att.userId)
        throw new RpcFail(ErrorCodes.forbidden, "not your thread");
      const threadId = this.meta("threadId") as string;
      const memberIds = [att.userId, ...new Set(p.memberIds.filter((m) => m !== att.userId))];
      if (memberIds.length > 1) {
        const found = await this.env.DB.prepare(
          `SELECT id FROM users WHERE id IN (${memberIds.map(() => "?").join(",")})`,
        )
          .bind(...memberIds)
          .all<{ id: string }>();
        if (found.results.length !== memberIds.length) {
          throw new RpcFail(ErrorCodes.invalidParams, "unknown memberIds");
        }
      }
      const thread = Thread.parse({
        id: threadId,
        title: p.title ?? "New thread",
        kind: memberIds.length > 1 ? "group" : "solo",
        memberIds,
        createdAt: nowIso(),
        archived: false,
      });
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT INTO threads (id, title, kind, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(thread.id, thread.title, thread.kind, att.userId, thread.createdAt),
        ...memberIds.map((m) =>
          this.env.DB.prepare("INSERT INTO thread_members (thread_id, user_id) VALUES (?, ?)").bind(
            thread.id,
            m,
          ),
        ),
      ]);
      this.setMeta("thread", JSON.stringify(thread));
      this.setAttachment(ws, { ...att, subscribed: true });
      this.emit("thread/started", { thread });
      defer(() => this.broadcastPresence());
      return { thread };
    },

    "thread/resume": ({ ws, att, defer }, p) => {
      const thread = this.boundThread(p.threadId);
      const lastSeq = this.lastSeq();
      this.setAttachment(ws, { ...att, subscribed: true });
      // Replay runs synchronously right after the response, so no live notification can
      // slip in between and arrive out of order.
      defer(() => {
        for (const row of this.sql
          .exec<{ seq: number; method: string; params: string }>(
            "SELECT seq, method, params FROM events WHERE seq > ? AND seq <= ? ORDER BY seq",
            p.afterSeq,
            lastSeq,
          )
          .toArray()) {
          ws.send(
            `{"method":${JSON.stringify(row.method)},"seq":${row.seq},"params":${row.params}}`,
          );
        }
        this.broadcastPresence();
      });
      return { thread, lastSeq };
    },

    "thread/list": async ({ att }, p) => {
      const rows = await this.env.DB.prepare(
        `SELECT t.id, t.title, t.kind, t.created_at, t.archived,
                (SELECT group_concat(user_id) FROM thread_members WHERE thread_id = t.id) AS members
         FROM threads t JOIN thread_members m ON m.thread_id = t.id
         WHERE m.user_id = ? AND (t.archived = 0 OR ?) ORDER BY t.created_at DESC LIMIT 200`,
      )
        .bind(att.userId, p.includeArchived ? 1 : 0)
        .all<{
          id: string;
          title: string;
          kind: string;
          created_at: string;
          archived: number;
          members: string;
        }>();
      return {
        threads: rows.results.map((r) =>
          Thread.parse({
            id: r.id,
            title: r.title,
            kind: r.kind,
            memberIds: r.members.split(","),
            createdAt: r.created_at,
            archived: r.archived === 1,
          }),
        ),
      };
    },

    "thread/archive": async (_call, p) => {
      const thread = this.boundThread(p.threadId);
      await this.env.DB.prepare("UPDATE threads SET archived = 1 WHERE id = ?")
        .bind(thread.id)
        .run();
      this.setMeta("thread", JSON.stringify({ ...thread, archived: true }));
      return {};
    },

    "turn/start": async ({ att, defer }, p) => {
      const thread = this.boundThread(p.threadId);
      if (thread.archived) throw new RpcFail(ErrorCodes.invalidRequest, "thread is archived");
      if (this.active) throw new RpcFail(ErrorCodes.invalidRequest, "a turn is already running");
      await this.rateLimit(att.userId);
      if (this.active) throw new RpcFail(ErrorCodes.invalidRequest, "a turn is already running");

      const turnId = newId("turn");
      const abort = new AbortController();
      this.active = { turnId, abort };
      this.sql.exec(
        "INSERT INTO turns (id, status, author_id) VALUES (?, 'running', ?)",
        turnId,
        att.userId,
      );
      this.supersedePendingApprovals();

      defer(() => {
        this.emit("turn/started", { threadId: thread.id, turnId, authorId: att.userId });
        const item = {
          ...this.base(turnId, "completed"),
          type: "userMessage" as const,
          authorId: att.userId,
          text: p.text,
          ...(p.uiState ? { uiState: p.uiState } : {}),
        };
        this.emitItem("item/started", item);
        this.emitItem("item/completed", item);
        this.ctx.waitUntil(this.runTurn(turnId, att.userId, p.text, p.uiState, abort.signal));
      });
      return { turnId };
    },

    "turn/interrupt": (_call, p) => {
      this.boundThread(p.threadId);
      if (this.active?.turnId !== p.turnId) {
        throw new RpcFail(ErrorCodes.invalidParams, "turn is not running");
      }
      this.active.abort.abort();
      return {};
    },

    "approval/respond": async ({ att, defer }, p) => {
      const thread = this.boundThread(p.threadId);
      const pending = this.pendingApproval(p.approvalId);
      if (!pending || this.settling.has(p.approvalId)) {
        throw new RpcFail(ErrorCodes.invalidParams, "unknown or already settled approval");
      }
      if (pending.approverId !== att.userId) {
        throw new RpcFail(
          ErrorCodes.forbidden,
          "only the addressed member can answer this approval",
        );
      }
      if (this.active) throw new RpcFail(ErrorCodes.invalidRequest, "a turn is already running");
      await this.rateLimit(att.userId);

      this.settling.add(p.approvalId);
      try {
        if (Date.parse(pending.expiresAt) < Date.now()) {
          this.settleApproval(pending, "expired");
          this.resumeAfterApproval(defer, thread.id, pending, att.userId, { status: "expired" });
          return { accepted: false };
        }
        if (p.decision === "approve" && pending.stepUp) {
          const ok = await verifyAssertion(
            this.env,
            att.userId,
            p.assertion,
            pending.challenge ?? "",
          );
          if (!ok) throw new RpcFail(ErrorCodes.unauthorized, "passkey step-up failed");
        }
        if (this.active || !this.pendingApproval(p.approvalId)) {
          throw new RpcFail(ErrorCodes.invalidRequest, "approval state changed; try again");
        }
        if (p.decision === "deny") {
          this.settleApproval(pending, "denied");
          this.resumeAfterApproval(defer, thread.id, pending, att.userId, { status: "declined" });
          return { accepted: true };
        }
        this.settleApproval(pending, "approved");
        const output = await this.executeSpend(
          pending.intent,
          pending.mandateId ?? `approval:${pending.approvalId}`,
          pending.turnId,
          "member_approval",
          pending.call,
        );
        this.resumeAfterApproval(defer, thread.id, pending, att.userId, output);
        return { accepted: true };
      } finally {
        this.settling.delete(p.approvalId);
      }
    },
  };

  // ── RPC from the Worker (DO RPC, not the socket protocol) ──

  /** Challenge for the step-up assertion; only the addressed approver can fetch it. */
  approvalChallenge(approvalId: string, userId: string): string | null {
    const a = this.pendingApproval(approvalId);
    return a && a.approverId === userId && a.challenge ? a.challenge : null;
  }

  // ── Agent loop ──

  private async runTurn(
    turnId: string,
    authorId: string,
    text: string,
    uiState: Record<string, unknown> | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const members = await this.members();
    const author = members.find((m) => m.userId === authorId);
    const diagnostics = this.meta("pendingDiagnostics");
    this.deleteMeta("pendingDiagnostics");
    // Member text is untrusted: wrap it so the model can tell data from instructions.
    const safe = (s: string) => s.replaceAll("</member_message", "<\\/member_message");
    let content = `<member_message author="${safe(author?.displayName ?? "member")}" user_id="${authorId}">\n${safe(text)}\n</member_message>`;
    if (uiState)
      content += `\n<ui_state>${safe(JSON.stringify(uiState)).slice(0, 4000)}</ui_state>`;
    if (diagnostics) content = `<ui_diagnostics>${diagnostics}</ui_diagnostics>\n${content}`;
    this.appendMessage({ role: "user", content });
    await this.loop(turnId, authorId, members, signal);
  }

  private resumeAfterApproval(
    defer: Call["defer"],
    threadId: string,
    a: PendingApproval,
    approverId: string,
    output: unknown,
  ): void {
    const abort = new AbortController();
    this.active = { turnId: a.turnId, abort };
    this.sql.exec("UPDATE turns SET status = 'running' WHERE id = ?", a.turnId);
    defer(() => {
      this.emit("turn/started", { threadId, turnId: a.turnId, authorId: approverId });
      this.appendMessage({
        role: "tool",
        results: [...a.siblingResults, { callId: a.call.id, name: a.call.name, output }],
      });
      this.ctx.waitUntil(
        this.members().then((members) =>
          this.loop(a.turnId, a.intent.userId, members, abort.signal),
        ),
      );
    });
  }

  private async loop(
    turnId: string,
    userId: string,
    members: Member[],
    signal: AbortSignal,
  ): Promise<void> {
    let status: "completed" | "interrupted" | "failed" | "awaitingApproval" = "completed";
    try {
      status = await this.steps(turnId, userId, members, signal);
    } catch (err) {
      console.error("turn failed", (err as Error)?.name);
      status = "failed";
      const item = {
        ...this.base(turnId, "completed"),
        type: "systemNotice" as const,
        level: "error" as const,
        text: "The agent hit an error and stopped. Try again in a moment.",
      };
      this.emitItem("item/started", item);
      this.emitItem("item/completed", item);
    } finally {
      this.active = undefined;
      this.sql.exec("UPDATE turns SET status = ? WHERE id = ?", status, turnId);
      const threadId = this.meta("threadId") as string;
      this.emit("turn/completed", { threadId, turnId, status });
    }
  }

  private async steps(
    turnId: string,
    userId: string,
    members: Member[],
    signal: AbortSignal,
  ): Promise<"completed" | "interrupted" | "awaitingApproval"> {
    const provider = providerFor(this.env);
    for (let step = 0; step < MAX_STEPS; step++) {
      let text = "";
      let item: (Item & { type: "agentMessage" }) | undefined;
      const calls: ToolCall[] = [];
      const stream = provider.stream({
        system: systemPrompt(),
        messages: this.loadMessages(),
        tools: TOOL_DEFS,
        signal,
      });
      try {
        for await (const ev of stream) {
          if (signal.aborted) break;
          if (ev.type === "text") {
            if (!item) {
              item = {
                ...this.base(turnId, "inProgress"),
                type: "agentMessage",
                text: "",
                refs: {},
                diagnostics: [],
              };
              this.emitItem("item/started", item);
            }
            text += ev.delta;
            this.emit(
              "item/agentMessage/delta",
              { threadId: item.threadId, itemId: item.id, delta: ev.delta },
              item.id,
            );
          } else if (ev.type === "toolCall") {
            calls.push(ev.call);
          }
        }
      } catch (err) {
        if (!signal.aborted) {
          if (item) this.completeAgentMessage(item, text, "failed");
          throw err;
        }
      }
      if (item) this.completeAgentMessage(item, text, signal.aborted ? "failed" : "completed");
      if (signal.aborted) {
        if (text) this.appendMessage({ role: "assistant", text, toolCalls: [] });
        return "interrupted";
      }
      this.appendMessage({ role: "assistant", text, toolCalls: calls });
      if (calls.length === 0) return "completed";

      const results: ToolResult[] = [];
      let pause: PendingApproval | undefined;
      for (const call of calls) {
        if (signal.aborted) {
          results.push({
            callId: call.id,
            name: call.name,
            output: { error: "interrupted" },
            isError: true,
          });
          continue;
        }
        const r = await this.executeTool(call, turnId, userId, members, pause !== undefined);
        if ("pause" in r) pause = r.pause;
        else results.push(r.result);
      }
      if (pause) {
        pause.siblingResults = results;
        this.sql.exec(
          "INSERT INTO approvals (id, status, json) VALUES (?, 'pending', ?)",
          pause.approvalId,
          JSON.stringify(pause),
        );
        return "awaitingApproval";
      }
      this.appendMessage({ role: "tool", results });
      if (signal.aborted) return "interrupted";
    }
    const notice = {
      ...this.base(turnId, "completed"),
      type: "systemNotice" as const,
      level: "warning" as const,
      text: "The agent stopped after too many steps.",
    };
    this.emitItem("item/started", notice);
    this.emitItem("item/completed", notice);
    return "completed";
  }

  private completeAgentMessage(
    item: Item & { type: "agentMessage" },
    text: string,
    status: "completed" | "failed",
  ) {
    const refs = this.loadRefs();
    const analysis = analyzeAgentText(text, refs);
    const used: Record<string, unknown> = {};
    for (const id of analysis.usedRefs) used[id] = refs.get(id);
    const done = {
      ...item,
      status,
      text,
      refs: used,
      diagnostics: analysis.diagnostics,
      ...(analysis.fallbackMarkdown ? { fallbackMarkdown: analysis.fallbackMarkdown } : {}),
    };
    if (analysis.diagnostics.length) {
      this.setMeta("pendingDiagnostics", JSON.stringify(analysis.diagnostics).slice(0, 4000));
    }
    this.emitItem("item/completed", done);
    // Deltas are redundant once the full text is stored; drop them to keep replay small.
    this.sql.exec(
      "DELETE FROM events WHERE method = 'item/agentMessage/delta' AND item_id = ?",
      item.id,
    );
  }

  private async executeTool(
    call: ToolCall,
    turnId: string,
    userId: string,
    members: Member[],
    alreadyPaused: boolean,
  ): Promise<{ result: ToolResult } | { pause: PendingApproval }> {
    const item = {
      ...this.base(turnId, "inProgress"),
      type: "toolCall" as const,
      name: call.name.slice(0, 64),
      summary: `Running ${call.name.slice(0, 64)}`,
      args: call.input,
    };
    this.emitItem("item/started", item);
    try {
      if (alreadyPaused && call.name === "requestSpend") {
        throw new ToolError(
          "only one spend can await approval at a time; ask again after it is answered",
        );
      }
      const outcome = await runTool(
        call.name,
        call.input,
        this.toolContext(turnId, userId, members),
      );
      if (outcome.kind === "result") {
        this.emitItem("item/completed", {
          ...item,
          status: "completed",
          summary: outcome.summary,
          result: outcome.output,
        });
        return { result: { callId: call.id, name: call.name, output: outcome.output } };
      }
      return await this.handleSpend(call, item, outcome, turnId);
    } catch (err) {
      const message =
        err instanceof ToolError
          ? err.message
          : err instanceof ZodError
            ? z.prettifyError(err)
            : "tool failed";
      if (!(err instanceof ToolError || err instanceof ZodError))
        console.error("tool failed", (err as Error)?.name);
      this.emitItem("item/completed", { ...item, status: "failed", error: message.slice(0, 1000) });
      return {
        result: { callId: call.id, name: call.name, output: { error: message }, isError: true },
      };
    }
  }

  private async handleSpend(
    call: ToolCall,
    toolItem: Item & { type: "toolCall" },
    outcome: ToolOutcome & { kind: "spend" },
    turnId: string,
  ): Promise<{ result: ToolResult } | { pause: PendingApproval }> {
    const { intent, decision } = outcome;
    const finish = (output: unknown) => {
      this.emitItem("item/completed", {
        ...toolItem,
        status: "completed",
        summary: outcome.summary,
        result: output,
      });
      return { result: { callId: call.id, name: call.name, output } };
    };

    if (decision.outcome === "allow") {
      return finish(await this.executeSpend(intent, decision.mandateId, turnId, "mandate", call));
    }
    if (decision.outcome === "deny") {
      const notice = {
        ...this.base(turnId, "completed"),
        type: "systemNotice" as const,
        level: "warning" as const,
        text: `Spend blocked by policy: ${decision.reasons.join(", ")}`,
      };
      this.emitItem("item/started", notice);
      this.emitItem("item/completed", notice);
      return finish({ status: "denied", reasons: decision.reasons });
    }

    const threshold = Number(this.env.STEP_UP_ABOVE_MINOR || "0");
    const stepUp =
      decision.reasons.includes("step_up_required") ||
      (threshold > 0 && intent.amount.amountMinor >= threshold);
    const approval: PendingApproval = {
      approvalId: newId("apr"),
      itemId: newId("item"),
      turnId,
      approverId: intent.userId,
      call,
      siblingResults: [],
      intent,
      ...(decision.mandateId ? { mandateId: decision.mandateId } : {}),
      stepUp,
      ...(stepUp ? { challenge: b64url(crypto.getRandomValues(new Uint8Array(32))) } : {}),
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    };
    this.emitItem("item/completed", {
      ...toolItem,
      status: "completed",
      summary: outcome.summary,
      result: {
        status: "awaitingApproval",
        approvalId: approval.approvalId,
        reasons: decision.reasons,
      },
    });
    this.emitItem("item/started", this.approvalItem(approval));
    return { pause: approval };
  }

  private approvalItem(a: PendingApproval, decision?: "approved" | "denied" | "expired"): Item {
    return {
      id: a.itemId,
      threadId: this.meta("threadId") as string,
      turnId: a.turnId,
      status: decision ? "completed" : "inProgress",
      createdAt: nowIso(),
      type: "approvalRequest",
      approvalId: a.approvalId,
      approverId: a.approverId,
      kind: "spend",
      summary: a.intent.description.slice(0, 300),
      amount: a.intent.amount,
      ...(a.intent.pactId ? { pactId: a.intent.pactId } : {}),
      stepUp: a.stepUp,
      ...(a.challenge ? { challenge: a.challenge } : {}),
      expiresAt: a.expiresAt,
      ...(decision ? { decision } : {}),
    };
  }

  private settleApproval(a: PendingApproval, decision: "approved" | "denied" | "expired"): void {
    this.sql.exec("UPDATE approvals SET status = ? WHERE id = ?", decision, a.approvalId);
    this.emitItem("item/completed", this.approvalItem(a, decision));
  }

  /** A new turn cancels approvals left hanging, so the model history stays well-formed. */
  private supersedePendingApprovals(): void {
    for (const row of this.sql
      .exec<{ json: string }>("SELECT json FROM approvals WHERE status = 'pending'")
      .toArray()) {
      const a = JSON.parse(row.json) as PendingApproval;
      this.settleApproval(a, "expired");
      this.appendMessage({
        role: "tool",
        results: [
          ...a.siblingResults,
          { callId: a.call.id, name: a.call.name, output: { status: "superseded" } },
        ],
      });
    }
  }

  /**
   * The single place a turn moves money. Reached only after `authorize()` allowed it or
   * the addressed member approved. UserDO re-checks policy against its own ledger and
   * charges with `PayPal-Request-Id: spend:<intent.id>`, so a replay can't double-charge.
   */
  private async executeSpend(
    intent: SpendIntent,
    mandateId: string,
    turnId: string,
    authorizedBy: "mandate" | "member_approval",
    call: ToolCall,
  ) {
    const threadId = this.meta("threadId") as string;
    const res = await this.userStub(intent.userId).chargeSpend({
      intent,
      mandateId,
      authorizedBy,
      threadId,
    });
    const pactId = intent.pactId;
    if (res.status === "pending") {
      this.notice(turnId, "info", "PayPal is still processing this payment.");
    } else {
      this.emitPayment(turnId, {
        kind: res.status === "charged" ? "charged" : "chargeFailed",
        userId: intent.userId,
        amount: intent.amount,
        ...(pactId ? { pactId } : {}),
        ...(res.paypalRef ? { paypalRef: res.paypalRef } : {}),
      });
    }
    let payoutStatus: string | undefined;
    if (res.status === "charged") {
      payoutStatus = await this.payTransfer(call, intent, res.paymentId, turnId);
      if (pactId) this.setMemberStatus(pactId, intent.userId, "charged", turnId);
    }
    return {
      status: res.status === "charged" ? "executed" : res.status,
      authorizedBy,
      amount: intent.amount as Money,
      ...(res.paypalRef ? { paymentRef: res.paypalRef } : {}),
      ...(res.reason ? { reason: res.reason } : {}),
      ...(res.simulated ? { simulated: true } : {}),
      ...(payoutStatus ? { payout: payoutStatus } : {}),
    };
  }

  /**
   * P2P send for a `transfer_` ref: the sender's charge already succeeded, so Payouts
   * forwards it to the recipient's PayPal (their linked wallet, or the drafted email).
   */
  private async payTransfer(
    call: ToolCall,
    intent: SpendIntent,
    chargeId: string,
    turnId: string,
  ): Promise<string | undefined> {
    const targetRef = (call.input as { targetRef?: unknown } | null)?.targetRef;
    if (typeof targetRef !== "string") return undefined;
    const ref = this.loadRefs().get(targetRef);
    if (ref?.kind !== "transfer") return undefined;
    const t = ref.data as {
      counterpartyUserId?: string;
      counterpartyEmail?: string;
      note?: string;
      status: string;
    };
    const receiver =
      t.counterpartyEmail ??
      (t.counterpartyUserId ? await this.userStub(t.counterpartyUserId).payoutReceiver() : null);
    const out = receiver
      ? await this.userStub(intent.userId).sendPayout({
          chargeId,
          userId: intent.userId,
          receiver,
          amount: intent.amount,
          note: t.note ?? "Sent with Pact",
          title: intent.description,
        })
      : { status: "failed" as const, reason: "recipient_not_linked" };
    this.putRef(targetRef, { ...t, status: out.status === "sent" ? "sent" : "failed" });
    this.emitPayment(turnId, {
      kind: out.status === "sent" ? "payoutSent" : "payoutFailed",
      userId: intent.userId,
      amount: intent.amount,
      ...("paypalRef" in out && out.paypalRef ? { paypalRef: out.paypalRef } : {}),
    });
    return out.status === "sent" ? "sent" : `failed:${out.reason ?? "unknown"}`;
  }

  // ── Pacts & payments, called by the REST routes, PactDO and webhooks (DO RPC) ──

  /** The pact as `userId` may see it, or null unless they're in both the thread and the pact. */
  pactForMember(pactId: string, userId: string): PactView | null {
    const thread = this.thread();
    if (!thread?.memberIds.includes(userId)) return null;
    const data = this.pactData(pactId);
    if (!data?.pact.members.some((m) => m.userId === userId)) return null;
    return { ...data, ...this.pactMerchant(data) };
  }

  /** Every member's share and mandate, for settlement. PactDO only; never sent to clients. */
  pactForSettlement(pactId: string): PactView | null {
    const data = this.pactData(pactId);
    return data ? { ...data, ...this.pactMerchant(data) } : null;
  }

  commitPactMember(
    pactId: string,
    userId: string,
    commit: { cap: Money; mandateId: string },
  ): PactRefData | null {
    const data = this.pactData(pactId);
    if (!data) return null;
    const next = commitMember(data, userId, commit, new Date());
    if (!next) return null;
    this.savePact(data, next, this.systemTurn(), "A member committed funding");
    return next;
  }

  /** Records payment items that happened outside a turn (REST capture, settlement, webhook). */
  recordPayments(events: PaymentEventInput[], memberStatus?: MemberStatusUpdate): void {
    if (!this.thread()) return;
    const turnId = this.systemTurn();
    for (const e of events) this.emitPayment(turnId, e);
    if (memberStatus) {
      this.setMemberStatus(memberStatus.pactId, memberStatus.userId, memberStatus.status, turnId);
    }
  }

  setPactState(
    pactId: string,
    to: Pact["state"],
    note: string,
    members: Record<string, PactMember["status"]> = {},
  ): void {
    const data = this.pactData(pactId);
    if (!data) return;
    const now = nowIso();
    const next: PactRefData = {
      ...data,
      pact: {
        ...data.pact,
        state: to,
        updatedAt: now,
        members: data.pact.members.map((m) => {
          const status = members[m.userId];
          return status ? { ...m, status } : m;
        }),
      },
    };
    this.savePact(data, next, this.systemTurn(), note);
  }

  private setMemberStatus(
    pactId: string,
    userId: string,
    status: PactMember["status"],
    turnId: string,
  ): void {
    const data = this.pactData(pactId);
    const member = data?.pact.members.find((m) => m.userId === userId);
    if (!data || !member || member.status === status) return;
    const members = data.pact.members.map((m) => (m.userId === userId ? { ...m, status } : m));
    const allPaid = members.every((m) => m.status === "charged" || m.status === "declined");
    const next: PactRefData = {
      ...data,
      pact: {
        ...data.pact,
        members,
        ...(allPaid && data.pact.action.kind === "collect" ? { state: "done" as const } : {}),
        updatedAt: nowIso(),
      },
    };
    this.savePact(data, next, turnId, `${member.displayName}: ${status}`);
  }

  private pactData(pactId: string): PactRefData | null {
    const ref = this.loadRefs().get(pactId);
    return ref?.kind === "pact" ? (ref.data as PactRefData) : null;
  }

  private savePact(prev: PactRefData, next: PactRefData, turnId: string, note: string): void {
    const pact = Pact.parse(next.pact);
    this.putRef(pact.id, { ...next, pact });
    const item = {
      ...this.base(turnId, "completed"),
      type: "pactUpdate" as const,
      pactId: pact.id,
      from: prev.pact.state,
      to: pact.state,
      pact,
      note: note.slice(0, 300),
    };
    this.emitItem("item/started", item);
    this.emitItem("item/completed", item);
  }

  private pactMerchant(data: PactRefData): { merchant: string; category?: string } {
    if (data.pact.action.kind === "purchase") {
      const product = this.loadRefs().get(data.pact.action.productRef)?.data as
        | { merchant?: string; category?: string }
        | undefined;
      if (product?.merchant) {
        return {
          merchant: product.merchant,
          ...(product.category ? { category: product.category } : {}),
        };
      }
    }
    return { merchant: "pact" };
  }

  private emitPayment(turnId: string, e: PaymentEventInput): void {
    const item = { ...this.base(turnId, "completed"), type: "paymentEvent" as const, ...e };
    this.emitItem("item/started", item);
    this.emitItem("item/completed", item);
  }

  private notice(turnId: string, level: "info" | "warning" | "error", text: string): void {
    const item = { ...this.base(turnId, "completed"), type: "systemNotice" as const, level, text };
    this.emitItem("item/started", item);
    this.emitItem("item/completed", item);
  }

  /** Items outside a turn still need a turn id; each out-of-band event gets its own. */
  private systemTurn(): string {
    return newId("turn");
  }

  private putRef(id: string, data: unknown): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO refs (id, kind, json) VALUES (?, ?, ?)",
      id,
      id.slice(0, id.indexOf("_")),
      JSON.stringify(data),
    );
  }

  private userStub(userId: string) {
    return this.env.USER.get(this.env.USER.idFromName(userId));
  }

  private toolContext(turnId: string, userId: string, members: Member[]): ToolContext {
    const threadId = this.meta("threadId") as string;
    const put = (id: string, data: unknown) => this.putRef(id, data);
    return {
      env: this.env,
      threadId,
      turnId,
      userId,
      members,
      putRef: (prefix, data) => {
        const id = newId(prefix);
        put(id, data);
        return id;
      },
      putRefWithId: put,
      getRef: (id) => this.loadRefs().get(id),
      loadPolicyState: (uid) => this.env.USER.get(this.env.USER.idFromName(uid)).policyState(),
      authorize: (intent, mandates, ledger) => authorize(intent, mandates, ledger),
    };
  }

  // ── Persistence & fan-out ──

  private emit<M extends ServerNotificationMethod>(
    method: M,
    params: NotificationOf<M>,
    itemId?: string,
  ): void {
    const checked = ServerNotifications[method].parse(params);
    const json = JSON.stringify(checked);
    const seq = this.sql
      .exec<{ seq: number }>(
        "INSERT INTO events (method, params, item_id) VALUES (?, ?, ?) RETURNING seq",
        method,
        json,
        itemId ?? null,
      )
      .one().seq;
    const frame = `{"method":${JSON.stringify(method)},"seq":${seq},"params":${json}}`;
    for (const ws of this.subscribers()) {
      try {
        ws.send(frame);
      } catch {
        // socket closing; it will resume from its last seq
      }
    }
  }

  private emitItem(method: "item/started" | "item/completed", item: Item): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO items (id, json) VALUES (?, ?)",
      item.id,
      JSON.stringify(item),
    );
    this.emit(method, { item }, item.id);
  }

  /** Presence is ephemeral state, not history: sent live and on resume, never replayed. */
  private broadcastPresence(closing?: WebSocket): void {
    const threadId = this.meta("threadId");
    if (!threadId) return;
    const sockets = this.subscribers().filter((ws) => ws !== closing);
    const online = [
      ...new Set(sockets.map((ws) => (ws.deserializeAttachment() as Attachment).userId)),
    ];
    const frame = JSON.stringify({
      method: "thread/presence",
      params: ServerNotifications["thread/presence"].parse({ threadId, onlineUserIds: online }),
    });
    for (const ws of sockets) {
      try {
        ws.send(frame);
      } catch {
        // ignore
      }
    }
  }

  private subscribers(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      if (ws.readyState !== WebSocket.OPEN) return false;
      return (ws.deserializeAttachment() as Attachment | null)?.subscribed === true;
    });
  }

  private setAttachment(ws: WebSocket, att: Attachment): void {
    ws.serializeAttachment(att);
  }

  private base(turnId: string, status: "inProgress" | "completed") {
    return {
      id: newId("item"),
      threadId: this.meta("threadId") as string,
      turnId,
      status,
      createdAt: nowIso(),
    };
  }

  private thread(): Thread | null {
    const raw = this.meta("thread");
    return raw ? (JSON.parse(raw) as Thread) : null;
  }

  private boundThread(threadId: string): Thread {
    const thread = this.thread();
    if (!thread) throw new RpcFail(ErrorCodes.invalidRequest, "thread not started");
    if (thread.id !== threadId) {
      throw new RpcFail(ErrorCodes.invalidParams, `this socket is bound to thread ${thread.id}`);
    }
    return thread;
  }

  private async members(): Promise<Member[]> {
    const ids = this.thread()?.memberIds ?? [];
    if (ids.length === 0) return [];
    const rows = await this.env.DB.prepare(
      `SELECT id, display_name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<{ id: string; display_name: string }>();
    return rows.results.map((r) => ({ userId: r.id, displayName: r.display_name }));
  }

  private async rateLimit(userId: string): Promise<void> {
    const { success } = await this.env.USER_LIMITER.limit({ key: userId });
    if (!success) throw new RpcFail(ErrorCodes.rateLimited, "slow down");
  }

  private pendingApproval(approvalId: string): PendingApproval | undefined {
    const row = this.sql
      .exec<{ json: string }>(
        "SELECT json FROM approvals WHERE id = ? AND status = 'pending'",
        approvalId,
      )
      .toArray()[0];
    return row ? (JSON.parse(row.json) as PendingApproval) : undefined;
  }

  private loadMessages(): ChatMessage[] {
    return this.sql
      .exec<{ json: string }>("SELECT json FROM messages ORDER BY id")
      .toArray()
      .map((r) => JSON.parse(r.json) as ChatMessage);
  }

  private appendMessage(m: ChatMessage): void {
    this.sql.exec("INSERT INTO messages (json) VALUES (?)", JSON.stringify(m));
  }

  private loadRefs(): Map<string, StoredRef> {
    const out = new Map<string, StoredRef>();
    for (const r of this.sql
      .exec<{ id: string; kind: string; json: string }>("SELECT * FROM refs")
      .toArray()) {
      out.set(r.id, { kind: r.kind, data: JSON.parse(r.json) });
    }
    return out;
  }

  private lastSeq(): number {
    return this.sql.exec<{ s: number | null }>("SELECT max(seq) AS s FROM events").one().s ?? 0;
  }

  private meta(key: string): string | undefined {
    return this.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
      .toArray()[0]?.value;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  private deleteMeta(key: string): void {
    this.sql.exec("DELETE FROM meta WHERE key = ?", key);
  }
}
