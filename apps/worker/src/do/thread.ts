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
import {
  type AnalyzedMessage,
  analyzeAgentText,
  CATALOG_VERSION,
  formatMoney,
  type StoredRef,
  systemPrompt,
} from "../agent/catalog";
import { contextBlock, knownAmounts, memberMessage } from "../agent/context";
import { runAgentLoop } from "../agent/loop";
import { defaultProductSearch } from "../agent/products";
import type { ChatMessage, ToolCall, ToolResult } from "../agent/provider";
import { validTimeZone } from "../agent/time";
import {
  type Member,
  type PactRefData,
  runTool,
  spendResult,
  TOOL_DEFS,
  type ToolContext,
  ToolError,
  type ToolOutcome,
} from "../agent/tools";
import { verifyAssertion } from "../auth/webauthn";
import type { Env } from "../env";
import { b64url, newId, nowIso } from "../ids";

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

/** How an approval the model already narrated ended; it arrives as a host message. */
function approvalResult(a: PendingApproval, output: unknown): string {
  const result = {
    description: a.intent.description,
    amountDisplay: formatMoney(a.intent.amount),
    ...(output as Record<string, unknown>),
  };
  return `<approval_result approval_id="${a.approvalId}">${JSON.stringify(result)}</approval_result>`;
}

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
    let content = `${contextBlock({
      now: new Date(),
      timeZone: validTimeZone(this.env.TIMEZONE),
      members,
      pacts: this.threadPacts(),
      speakerId: authorId,
    })}\n${memberMessage(author, authorId, text, uiState)}`;
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
      this.appendMessage({ role: "user", content: approvalResult(a, output) });
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
    let item: (Item & { type: "agentMessage" }) | undefined;
    const end = await runAgentLoop(
      {
        provider: providerFor(this.env),
        system: systemPrompt(),
        tools: TOOL_DEFS,
        maxSteps: MAX_STEPS,
        messages: () => this.loadMessages(),
        append: (m) => this.appendMessage(m),
        startMessage: () => {
          item = {
            ...this.base(turnId, "inProgress"),
            type: "agentMessage",
            text: "",
            refs: {},
            diagnostics: [],
          };
          this.emitItem("item/started", item);
        },
        delta: (delta) => {
          if (!item) return;
          this.emit(
            "item/agentMessage/delta",
            { threadId: item.threadId, itemId: item.id, delta },
            item.id,
          );
        },
        analyze: (text) =>
          analyzeAgentText(text, this.loadRefs(), knownAmounts(this.loadMessages())),
        finishMessage: (text, analysis, status, rejected) => {
          if (item) this.completeAgentMessage(item, text, analysis, status, rejected);
          item = undefined;
        },
        executeTool: (call, paused) => this.executeTool(call, turnId, userId, members, paused),
      },
      signal,
    );
    if (end.paused) return "awaitingApproval";
    switch (end.status) {
      case "stepLimit": {
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
      default:
        return end.status;
    }
  }

  /**
   * A rejected message (invalid UI the model is about to resend) completes as failed
   * with no text, so clients drop what they streamed and nothing broken is stored.
   */
  private completeAgentMessage(
    item: Item & { type: "agentMessage" },
    text: string,
    analysis: AnalyzedMessage,
    status: "completed" | "failed",
    rejected: boolean,
  ) {
    const refs = this.loadRefs();
    const used: Record<string, unknown> = {};
    for (const id of analysis.usedRefs) used[id] = refs.get(id);
    const done = rejected
      ? {
          ...item,
          status: "failed" as const,
          text: "",
          refs: {},
          diagnostics: analysis.diagnostics,
        }
      : {
          ...item,
          status,
          text,
          refs: used,
          diagnostics: analysis.diagnostics,
          ...(analysis.fallbackMarkdown ? { fallbackMarkdown: analysis.fallbackMarkdown } : {}),
        };
    if (!rejected && analysis.diagnostics.length) {
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
  ): Promise<{ result: ToolResult; paused?: boolean }> {
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
  ): Promise<{ result: ToolResult; paused?: boolean }> {
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
      const charged = await this.executeSpend(intent, decision.mandateId, turnId, "mandate");
      return finish(spendResult(intent, decision, "executed", charged));
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
      return finish(spendResult(intent, decision, "denied"));
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
      intent,
      ...(decision.mandateId ? { mandateId: decision.mandateId } : {}),
      stepUp,
      ...(stepUp ? { challenge: b64url(crypto.getRandomValues(new Uint8Array(32))) } : {}),
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    };
    // Stored now, not at turn end: the model still narrates the pending approval, and a
    // failure while it does must not orphan an approval the member can already see.
    this.sql.exec(
      "INSERT INTO approvals (id, status, json) VALUES (?, 'pending', ?)",
      approval.approvalId,
      JSON.stringify(approval),
    );
    const output = spendResult(intent, decision, "awaiting_approval", {
      approvalId: approval.approvalId,
    });
    this.emitItem("item/completed", {
      ...toolItem,
      status: "completed",
      summary: outcome.summary,
      result: output,
    });
    this.emitItem("item/started", this.approvalItem(approval));
    return { result: { callId: call.id, name: call.name, output }, paused: true };
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

  /** A new turn cancels approvals left hanging, and tells the model they expired. */
  private supersedePendingApprovals(): void {
    for (const row of this.sql
      .exec<{ json: string }>("SELECT json FROM approvals WHERE status = 'pending'")
      .toArray()) {
      const a = JSON.parse(row.json) as PendingApproval;
      this.settleApproval(a, "expired");
      this.appendMessage({
        role: "user",
        content: approvalResult(a, { status: "expired", reason: "superseded by a new message" }),
      });
    }
  }

  /**
   * The single place money moves. Reached only after `authorize()` allowed it or the
   * addressed member approved. PayPal is not wired yet, so the charge is simulated;
   * the real call will use `PayPal-Request-Id: spend:<intent.id>` for safe retries.
   */
  private async executeSpend(
    intent: SpendIntent,
    mandateId: string,
    turnId: string,
    authorizedBy: "mandate" | "member_approval",
  ) {
    const user = this.env.USER.get(this.env.USER.idFromName(intent.userId));
    await user.recordCharge(intent.id, {
      mandateId,
      amountMinor: intent.amount.amountMinor,
      currency: intent.amount.currency,
      at: intent.at,
    });
    const paypalRef = `SIMULATED-${intent.id}`;
    const item = {
      ...this.base(turnId, "completed"),
      type: "paymentEvent" as const,
      kind: "charged" as const,
      userId: intent.userId,
      amount: intent.amount,
      paypalRef,
      ...(intent.pactId ? { pactId: intent.pactId } : {}),
    };
    this.emitItem("item/started", item);
    this.emitItem("item/completed", item);
    return {
      status: "executed",
      authorizedBy,
      amount: intent.amount as Money,
      paymentRef: paypalRef,
      simulated: true,
    };
  }

  private toolContext(turnId: string, userId: string, members: Member[]): ToolContext {
    const threadId = this.meta("threadId") as string;
    const put = (id: string, data: unknown) => {
      this.sql.exec(
        "INSERT OR REPLACE INTO refs (id, kind, json) VALUES (?, ?, ?)",
        id,
        id.slice(0, id.indexOf("_")),
        JSON.stringify(data),
      );
    };
    return {
      threadId,
      turnId,
      userId,
      members,
      timeZone: validTimeZone(this.env.TIMEZONE),
      now: () => new Date(),
      newId,
      searchProducts: (q) => defaultProductSearch(this.env.CHANNEL3_API_KEY, q),
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

  /** Pacts drafted in this thread; listed in the turn context and resolvable as refs. */
  private threadPacts(): PactRefData["pact"][] {
    return this.sql
      .exec<{ json: string }>("SELECT json FROM refs WHERE kind = 'pact' ORDER BY rowid")
      .toArray()
      .map((r) => (JSON.parse(r.json) as PactRefData).pact);
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
