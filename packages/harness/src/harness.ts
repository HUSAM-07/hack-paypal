/**
 * The "Codex core": a thread manager and turn runner, independent of where it runs.
 *
 * It turns a model's stream into protocol items (started → delta → completed), persists every
 * thread-scoped notification with a per-thread seq (so clients can resume), runs tools, and
 * pauses a turn on approvals until a decision arrives from any surface.
 *
 * Work on one thread is serialised by a per-thread lock: a turn step, an approval decision and
 * an approval expiry never interleave, so an approval answered while its step is still running
 * is applied after the step parks the turn, never lost.
 */
import {
  ErrorCodes,
  type Item,
  type ItemOf,
  type Thread,
  type Turn,
  type TurnStatus,
} from "@shop/agent-protocol";
import { itemsToMessages } from "./history";
import type { ModelProvider, ModelToolCall } from "./model";
import type { ApprovalItem, StoredEvent, ThreadStore } from "./store";
import type { AnyTool, ToolContext } from "./tools";

export class HarnessError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "HarnessError";
  }
}

export interface Notification {
  method: string;
  params: unknown;
  /** Present on thread-scoped notifications. */
  seq?: number;
}

export interface HarnessDeps {
  userId: string;
  store: ThreadStore;
  model: ModelProvider;
  tools: readonly AnyTool[];
  systemPrompt(ctx: { threadId: string }): string;
  /** Live fan-out of every thread-scoped notification (already persisted, seq set). */
  publish(n: Notification): void;
  /** Send `approval/request` to connected clients. */
  requestApproval?(item: ApprovalItem): void;
  /** An approval is waiting; the host schedules its expiry. */
  onApprovalPending?(item: ApprovalItem): void;
  /** Checks a passkey assertion for step-up approvals. Absent: step-up approvals can't pass. */
  verifyStepUp?(item: ApprovalItem, assertion: unknown): boolean | Promise<boolean>;
  now?(): Date;
  newId?(prefix: string): string;
  maxSteps?: number;
  approvalTtlMs?: number;
}

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_APPROVAL_TTL_MS = 15 * 60_000;
export const DEFAULT_THREAD_TITLE = "New chat";

type ToolCallItem = ItemOf<"toolCall">;

interface RunningTurn {
  controller: AbortController;
  steers: string[];
}

export interface Harness {
  startThread(opts?: { title?: string; id?: string }): Thread;
  getThread(threadId: string): Thread;
  listThreads(opts: { includeArchived: boolean; limit: number; cursor?: string }): {
    threads: Thread[];
    nextCursor?: string;
  };
  readThread(threadId: string): { thread: Thread; turns: Turn[]; items: Item[] };
  archiveThread(threadId: string, archived: boolean): Thread;
  forkThread(opts: { threadId: string; turnId?: string; title?: string }): Thread;
  /** Persisted thread-scoped notifications after `afterSeq`, for `thread/resume`. */
  replay(threadId: string, afterSeq: number): StoredEvent[];
  lastSeq(threadId: string): number;
  startTurn(opts: {
    threadId: string;
    text: string;
    uiState?: Record<string, unknown>;
    origin?: Turn["origin"];
  }): { turn: Turn; done: Promise<Turn> };
  steer(opts: { threadId: string; turnId: string; text: string }): boolean;
  interrupt(opts: { threadId: string; turnId: string }): Promise<void>;
  respondApproval(opts: {
    approvalId: string;
    decision: "approve" | "deny";
    assertion?: unknown;
    edits?: Record<string, unknown>;
  }): Promise<{ accepted: boolean; done?: Promise<Turn> }>;
  /** Resolve every pending approval past its `expiresAt` as expired. */
  expireApprovals(): Promise<void>;
  pendingApprovals(): ApprovalItem[];
  activeTurn(threadId: string): Turn | undefined;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";
const errorMessage = (e: unknown) => clip(e instanceof Error ? e.message : String(e), 500);

export function createHarness(deps: HarnessDeps): Harness {
  const { store } = deps;
  const now = () => deps.now?.() ?? new Date();
  const iso = () => now().toISOString();
  const newId =
    deps.newId ?? ((p: string) => `${p}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`);
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const approvalTtlMs = deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
  const tools = new Map(deps.tools.map((t) => [t.name, t]));
  const running = new Map<string, RunningTurn>();
  const locks = new Map<string, Promise<unknown>>();

  function withLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(threadId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.catch(() => undefined);
    locks.set(threadId, settled);
    void settled.then(() => {
      if (locks.get(threadId) === settled) locks.delete(threadId);
    });
    return next;
  }

  function emit(threadId: string, method: string, params: unknown, itemId?: string) {
    const seq = store.appendEvent(threadId, method, params, itemId);
    deps.publish({ method, params, seq });
  }

  function requireThread(threadId: string): Thread {
    const t = store.getThread(threadId);
    if (!t) throw new HarnessError(ErrorCodes.notFound, `thread not found: ${threadId}`);
    return t;
  }

  function touchThread(threadId: string, patch: Partial<Thread> = {}) {
    const t = { ...requireThread(threadId), ...patch, updatedAt: iso() };
    store.updateThread(t);
    emit(threadId, "thread/updated", { thread: t });
  }

  function startItem(item: Item) {
    store.putItem(item);
    emit(item.threadId, "item/started", { item }, item.id);
  }

  function completeItem(item: Item) {
    const done = { ...item, completedAt: item.completedAt ?? iso() } as Item;
    store.putItem(done);
    emit(done.threadId, "item/completed", { item: done }, done.id);
    store.compactDeltas(done.threadId, done.id);
    return done;
  }

  function finishTurn(turn: Turn, status: TurnStatus, error?: string): Turn {
    const done: Turn = { ...turn, status, completedAt: iso(), ...(error ? { error } : {}) };
    store.putTurn(done);
    running.delete(turn.id);
    emit(turn.threadId, "turn/completed", { turn: done });
    touchThread(turn.threadId);
    return done;
  }

  function setTurnStatus(turn: Turn, status: TurnStatus): Turn {
    const t: Turn = { ...turn, status };
    store.putTurn(t);
    emit(turn.threadId, "turn/updated", { turn: t });
    return t;
  }

  function notice(turn: Turn, level: "info" | "warning" | "error", text: string) {
    const item: Item = {
      type: "systemNotice",
      id: newId("ntc"),
      threadId: turn.threadId,
      turnId: turn.id,
      status: "completed",
      createdAt: iso(),
      level,
      text: clip(text, 500),
    };
    startItem(item);
    completeItem(item);
  }

  function addUserMessage(turn: Turn, text: string, uiState?: Record<string, unknown>) {
    const item: Item = {
      type: "userMessage",
      id: newId("msg"),
      threadId: turn.threadId,
      turnId: turn.id,
      status: "completed",
      createdAt: iso(),
      text,
      ...(uiState ? { uiState } : {}),
    };
    startItem(item);
    completeItem(item);
  }

  function toolContext(item: ToolCallItem, signal: AbortSignal): ToolContext {
    return {
      userId: deps.userId,
      threadId: item.threadId,
      turnId: item.turnId,
      toolCallId: item.id,
      signal,
      now,
      progress(label, fraction) {
        emit(
          item.threadId,
          "item/toolCall/progress",
          {
            threadId: item.threadId,
            itemId: item.id,
            label: clip(label, 120),
            ...(fraction === undefined ? {} : { fraction: Math.min(1, Math.max(0, fraction)) }),
          },
          item.id,
        );
      },
    };
  }

  async function execute(
    item: ToolCallItem,
    tool: AnyTool,
    args: unknown,
    signal: AbortSignal,
    approval?: ToolContext["approval"],
  ): Promise<void> {
    const ctx = toolContext(item, signal);
    try {
      const raw = await tool.run(args, approval ? { ...ctx, approval } : ctx);
      if (signal.aborted) throw new Error("interrupted");
      const parsed = tool.result.safeParse(raw);
      if (!parsed.success) {
        completeItem({ ...item, status: "failed", error: "The tool returned an invalid result." });
        return;
      }
      completeItem({ ...item, status: "completed", result: parsed.data });
    } catch (err) {
      completeItem({
        ...item,
        status: "failed",
        error: signal.aborted ? "interrupted" : errorMessage(err),
      });
    }
  }

  /** Returns true when the call is now waiting on an approval. */
  async function handleCall(
    turn: Turn,
    call: ModelToolCall,
    signal: AbortSignal,
  ): Promise<boolean> {
    const tool = tools.get(call.name);
    const base: ToolCallItem = {
      type: "toolCall",
      id: newId("tc"),
      threadId: turn.threadId,
      turnId: turn.id,
      status: "inProgress",
      createdAt: iso(),
      name: clip(call.name, 64),
      summary: "",
      args: call.input,
    };
    if (!tool) {
      startItem({ ...base, summary: `Unknown tool ${base.name}` });
      completeItem({
        ...base,
        summary: `Unknown tool ${base.name}`,
        status: "failed",
        error: `${base.name} is not a tool.`,
      });
      return false;
    }
    const parsed = tool.args.safeParse(call.input ?? {});
    if (!parsed.success) {
      const failed = { ...base, summary: `Invalid ${tool.name} call` };
      startItem(failed);
      completeItem({
        ...failed,
        status: "failed",
        error: clip(`Invalid arguments: ${parsed.error.message}`, 500),
      });
      return false;
    }
    const item: ToolCallItem = {
      ...base,
      args: parsed.data,
      summary: clip(tool.summarize(parsed.data), 300),
    };
    startItem(item);

    let spec: Awaited<ReturnType<NonNullable<AnyTool["needsApproval"]>>>;
    try {
      spec = await tool.needsApproval?.(parsed.data, toolContext(item, signal));
    } catch (err) {
      completeItem({ ...item, status: "failed", error: errorMessage(err) });
      return false;
    }
    if (!spec) {
      await execute(item, tool, parsed.data, signal);
      return false;
    }
    const approvalId = newId("ap");
    const approval: ApprovalItem = {
      type: "approvalRequest",
      id: approvalId,
      approvalId,
      threadId: turn.threadId,
      turnId: turn.id,
      status: "inProgress",
      createdAt: iso(),
      kind: spec.kind ?? "tool",
      toolCallId: item.id,
      title: clip(spec.title, 120),
      summary: clip(spec.summary, 500),
      ...(spec.amount ? { amount: spec.amount } : {}),
      ...(spec.details === undefined ? {} : { details: spec.details }),
      stepUp: spec.stepUp ?? false,
      expiresAt: new Date(now().getTime() + (spec.ttlMs ?? approvalTtlMs)).toISOString(),
    };
    startItem(approval);
    deps.requestApproval?.(approval);
    deps.onApprovalPending?.(approval);
    return true;
  }

  function pendingIn(turn: Turn): ApprovalItem[] {
    return store
      .listItems(turn.threadId, turn.id)
      .filter((i): i is ApprovalItem => i.type === "approvalRequest" && i.decision === undefined);
  }

  /** One model step. Returns the tool calls the model made, or a terminal status. */
  async function step(
    turn: Turn,
    rt: RunningTurn,
  ): Promise<{ calls: ModelToolCall[] } | { end: TurnStatus; error?: string }> {
    const signal = rt.controller.signal;
    let message: ItemOf<"agentMessage"> | undefined;
    let reasoning: ItemOf<"reasoning"> | undefined;
    const citations: { n: number; url: string; title: string }[] = [];
    const calls: ModelToolCall[] = [];

    const closeReasoning = () => {
      if (reasoning) completeItem({ ...reasoning, status: "completed" });
      reasoning = undefined;
    };
    const closeMessage = (status: "completed" | "failed") => {
      closeReasoning();
      if (message) {
        completeItem({
          ...message,
          status,
          ...(citations.length > 0 ? { citations } : {}),
        });
      }
      message = undefined;
    };

    try {
      const stream = deps.model.stream({
        system: deps.systemPrompt({ threadId: turn.threadId }),
        messages: itemsToMessages(store.listItems(turn.threadId), deps.tools),
        tools: deps.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.args,
        })),
        signal,
      });
      for await (const ev of stream) {
        if (signal.aborted) break;
        if (ev.type === "reasoning") {
          if (!reasoning) {
            reasoning = {
              type: "reasoning",
              id: newId("rsn"),
              threadId: turn.threadId,
              turnId: turn.id,
              status: "inProgress",
              createdAt: iso(),
              summary: "",
            };
            startItem(reasoning);
          }
          reasoning.summary += ev.delta;
          emit(
            turn.threadId,
            "item/reasoning/delta",
            { threadId: turn.threadId, itemId: reasoning.id, delta: ev.delta },
            reasoning.id,
          );
        } else if (ev.type === "text") {
          closeReasoning();
          if (!message) {
            message = {
              type: "agentMessage",
              id: newId("msg"),
              threadId: turn.threadId,
              turnId: turn.id,
              status: "inProgress",
              createdAt: iso(),
              text: "",
            };
            startItem(message);
          }
          message.text += ev.delta;
          emit(
            turn.threadId,
            "item/agentMessage/delta",
            { threadId: turn.threadId, itemId: message.id, delta: ev.delta },
            message.id,
          );
        } else if (ev.type === "source") {
          if (!citations.some((c) => c.url === ev.url)) {
            citations.push({
              n: citations.length + 1,
              url: ev.url,
              title: clip(ev.title || ev.url, 300),
            });
          }
        } else if (ev.type === "toolCall") {
          calls.push(ev.call);
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        closeMessage("failed");
        notice(turn, "error", `The model failed: ${errorMessage(err)}`);
        return { end: "failed", error: errorMessage(err) };
      }
    }
    if (signal.aborted) {
      closeMessage("completed");
      return { end: "interrupted" };
    }
    closeMessage("completed");
    return { calls };
  }

  /** Run steps until the turn ends or parks on an approval. Caller holds the thread lock. */
  async function loop(turn: Turn): Promise<Turn> {
    const rt: RunningTurn = running.get(turn.id) ?? {
      controller: new AbortController(),
      steers: [],
    };
    running.set(turn.id, rt);
    try {
      for (let i = 0; i < maxSteps; i++) {
        for (const text of rt.steers.splice(0)) addUserMessage(turn, text);
        const r = await step(turn, rt);
        if ("end" in r) return finishTurn(turn, r.end, r.error);
        if (r.calls.length === 0) {
          if (rt.steers.length > 0) continue;
          return finishTurn(turn, "completed");
        }
        for (const call of r.calls) {
          if (rt.controller.signal.aborted) break;
          await handleCall(turn, call, rt.controller.signal);
        }
        if (rt.controller.signal.aborted) return finishTurn(turn, "interrupted");
        if (pendingIn(turn).length > 0) {
          running.delete(turn.id);
          return setTurnStatus(turn, "awaitingApproval");
        }
      }
      notice(
        turn,
        "warning",
        `Stopped after ${maxSteps} steps. Ask me to continue if you need more.`,
      );
      return finishTurn(turn, "completed");
    } catch (err) {
      notice(turn, "error", `Something went wrong: ${errorMessage(err)}`);
      return finishTurn(turn, "failed", errorMessage(err));
    }
  }

  /** Record a decision and run or decline the gated tool. Caller holds the thread lock. */
  async function applyDecision(
    approval: ApprovalItem,
    decision: "approved" | "denied" | "expired",
    edits?: Record<string, unknown>,
  ): Promise<void> {
    completeItem({
      ...approval,
      decision,
      status: decision === "approved" ? "completed" : "declined",
    });
    const call = approval.toolCallId
      ? store.getItem(approval.threadId, approval.toolCallId)
      : undefined;
    if (call?.type !== "toolCall" || call.status !== "inProgress") return;
    const tool = tools.get(call.name);
    if (decision === "approved" && tool) {
      const rt = running.get(approval.turnId) ?? { controller: new AbortController(), steers: [] };
      running.set(approval.turnId, rt);
      await execute(call, tool, call.args, rt.controller.signal, {
        decision: "approved",
        ...(edits ? { edits } : {}),
      });
      return;
    }
    completeItem({
      ...call,
      status: "declined",
      error: decision === "expired" ? "The approval expired." : "The user declined.",
    });
  }

  /** After a decision: continue the turn once nothing in it is still waiting. */
  async function continueIfReady(threadId: string, turnId: string): Promise<Turn> {
    const turn = store.getTurn(threadId, turnId);
    if (!turn) throw new HarnessError(ErrorCodes.notFound, `turn not found: ${turnId}`);
    if (turn.status !== "awaitingApproval" || pendingIn(turn).length > 0) return turn;
    return loop(setTurnStatus(turn, "inProgress"));
  }

  /**
   * Two lock sections: the decision (and the gated tool) first, so the caller learns quickly
   * whether it counted; then the continuation, which may run the model for a while.
   */
  async function resolve(
    approval: ApprovalItem,
    decision: "approved" | "denied" | "expired",
    edits?: Record<string, unknown>,
  ): Promise<{ accepted: boolean; done?: Promise<Turn> }> {
    const accepted = await withLock(approval.threadId, async () => {
      const current = store.getItem(approval.threadId, approval.id);
      if (current?.type !== "approvalRequest" || current.decision !== undefined) return false;
      await applyDecision(current, decision, edits);
      return true;
    });
    if (!accepted) return { accepted };
    const done = withLock(approval.threadId, () =>
      continueIfReady(approval.threadId, approval.turnId),
    );
    return { accepted, done };
  }

  /**
   * A turn persisted as inProgress with no live loop and no queued work was cut off by a restart
   * (Durable Object eviction). Close it so the thread isn't blocked forever.
   */
  function recoverOrphan(threadId: string): Turn | undefined {
    const active = activeTurn(threadId);
    if (active?.status !== "inProgress" || running.has(active.id) || locks.has(threadId)) {
      return active;
    }
    for (const item of store.listItems(threadId, active.id)) {
      if (item.type === "approvalRequest" && item.decision === undefined) {
        completeItem({ ...item, decision: "expired", status: "declined" });
      } else if (item.status === "inProgress") {
        completeItem({ ...item, status: "failed" } as Item);
      }
    }
    finishTurn(active, "interrupted", "The agent restarted before this turn finished.");
    return undefined;
  }

  function activeTurn(threadId: string): Turn | undefined {
    return store
      .listTurns(threadId)
      .find((t) => t.status === "inProgress" || t.status === "awaitingApproval");
  }

  return {
    startThread(opts = {}) {
      const at = iso();
      const thread: Thread = {
        id: opts.id ?? newId("thr"),
        title: clip(opts.title?.trim() || DEFAULT_THREAD_TITLE, 120),
        createdAt: at,
        updatedAt: at,
        archived: false,
        preview: "",
      };
      store.insertThread(thread);
      emit(thread.id, "thread/started", { thread });
      return thread;
    },

    getThread: requireThread,

    listThreads({ includeArchived, limit, cursor }) {
      const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const threads = store.listThreads({ includeArchived, limit: limit + 1, offset });
      const more = threads.length > limit;
      return {
        threads: threads.slice(0, limit),
        ...(more ? { nextCursor: String(offset + limit) } : {}),
      };
    },

    readThread(threadId) {
      const thread = requireThread(threadId);
      return { thread, turns: store.listTurns(threadId), items: store.listItems(threadId) };
    },

    archiveThread(threadId, archived) {
      requireThread(threadId);
      touchThread(threadId, { archived });
      return requireThread(threadId);
    },

    forkThread({ threadId, turnId, title }) {
      const source = requireThread(threadId);
      const turns = store.listTurns(threadId);
      let upTo = turns.length;
      if (turnId) {
        const i = turns.findIndex((t) => t.id === turnId);
        if (i < 0) throw new HarnessError(ErrorCodes.notFound, `turn not found: ${turnId}`);
        upTo = i + 1;
      }
      const copied = turns
        .slice(0, upTo)
        .filter((t) => t.status !== "inProgress" && t.status !== "awaitingApproval");
      const at = iso();
      const lastTurn = copied[copied.length - 1];
      const fork: Thread = {
        id: newId("thr"),
        title: clip(title?.trim() || `${source.title} (fork)`, 120),
        createdAt: at,
        updatedAt: at,
        archived: false,
        preview: source.preview,
        forkedFrom: { threadId, ...(lastTurn ? { turnId: lastTurn.id } : {}) },
      };
      store.insertThread(fork);
      emit(fork.id, "thread/started", { thread: fork });
      for (const t of copied) {
        const turn: Turn = { ...t, threadId: fork.id };
        store.putTurn(turn);
        emit(fork.id, "turn/started", { turn });
        for (const original of store.listItems(threadId, t.id)) {
          let item = { ...original, threadId: fork.id } as Item;
          // Only finished history is copied; anything left open can't be resumed in the fork.
          if (item.type === "approvalRequest" && item.decision === undefined) {
            item = { ...item, decision: "expired", status: "declined" };
          } else if (item.status === "inProgress") {
            item = { ...item, status: "failed" } as Item;
          }
          store.putItem(item);
          emit(fork.id, "item/started", { item }, item.id);
          emit(fork.id, "item/completed", { item }, item.id);
        }
        emit(fork.id, "turn/completed", { turn });
      }
      return fork;
    },

    replay: (threadId, afterSeq) => {
      requireThread(threadId);
      return store.eventsAfter(threadId, afterSeq);
    },

    startTurn({ threadId, text, uiState, origin = "user" }) {
      const thread = requireThread(threadId);
      const active = recoverOrphan(threadId);
      if (active?.status === "inProgress") {
        throw new HarnessError(
          ErrorCodes.turnInProgress,
          "a turn is already running on this thread",
        );
      }
      const turn: Turn = {
        id: newId("turn"),
        threadId,
        status: "inProgress",
        startedAt: iso(),
        origin,
      };
      store.putTurn(turn);
      running.set(turn.id, { controller: new AbortController(), steers: [] });
      emit(threadId, "turn/started", { turn });
      addUserMessage(turn, text, uiState);
      touchThread(threadId, {
        preview: clip(firstLine(text), 200),
        archived: false,
        ...(thread.title === DEFAULT_THREAD_TITLE ? { title: clip(firstLine(text), 60) } : {}),
      });
      const done = withLock(threadId, async () => {
        // A new message supersedes a turn parked on an approval: its approvals are denied.
        const parked = active && store.getTurn(threadId, active.id);
        if (parked?.status === "awaitingApproval") {
          for (const a of pendingIn(parked)) await applyDecision(a, "denied");
          finishTurn(parked, "interrupted");
        }
        return loop(turn);
      });
      return { turn, done };
    },

    steer({ turnId, text }) {
      const rt = running.get(turnId);
      if (!rt || rt.controller.signal.aborted) return false;
      rt.steers.push(text);
      return true;
    },

    async interrupt({ threadId, turnId }) {
      const turn = store.getTurn(threadId, turnId);
      if (!turn) throw new HarnessError(ErrorCodes.notFound, `turn not found: ${turnId}`);
      running.get(turnId)?.controller.abort();
      recoverOrphan(threadId);
      await withLock(threadId, async () => {
        const t = store.getTurn(threadId, turnId);
        if (t?.status !== "awaitingApproval") return;
        for (const a of pendingIn(t)) await applyDecision(a, "denied");
        finishTurn(t, "interrupted");
      });
    },

    async respondApproval({ approvalId, decision, assertion, edits }) {
      const approval = store.listPendingApprovals().find((a) => a.approvalId === approvalId);
      if (!approval) return { accepted: false };
      if (new Date(approval.expiresAt).getTime() <= now().getTime()) {
        const r = await resolve(approval, "expired");
        await r.done;
        return { accepted: false };
      }
      if (decision === "approve" && approval.stepUp) {
        const ok = assertion !== undefined && (await deps.verifyStepUp?.(approval, assertion));
        if (!ok) return { accepted: false };
      }
      return resolve(approval, decision === "approve" ? "approved" : "denied", edits);
    },

    async expireApprovals() {
      const due = store
        .listPendingApprovals()
        .filter((a) => new Date(a.expiresAt).getTime() <= now().getTime());
      for (const a of due) await (await resolve(a, "expired")).done;
    },

    lastSeq: (threadId) => store.lastSeq(threadId),
    pendingApprovals: () => store.listPendingApprovals(),
    activeTurn,
  };
}
