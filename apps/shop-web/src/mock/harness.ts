/**
 * MockHarness: the agent protocol served in the browser, so the app runs and demos with no
 * backend. It keeps a per-thread seq log (resume replays it), pauses turns on approvals sent as
 * server requests, broadcasts `state/snapshot|patch`, drives a fake browser session, and runs
 * scripted turns that exercise every widget: search, compare, research, open page, watch with
 * an auto-buy rule that fires on a demo clock, purchase with cooling-off and Undo.
 */
import {
  type ApprovalKind,
  type BrowserSession,
  ErrorCodes,
  type Item,
  type ItemOf,
  type Money,
  PROTOCOL_VERSION,
  type Thread,
  type Turn,
} from "@shop/agent-protocol";
import type { Offer, Order, ShopState, Watch } from "@shop/commerce/contract";
import { formatMoney } from "@shop/genui";
import { makeOffers, makeSources, priceHistory, usd } from "@shop/genui/fixtures";
import type { Connect, TransportHandlers } from "../protocol/transport";
import { livePage, pageScreenshot } from "./pages";

type Frame = {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};
type Conn = { h: TransportHandlers; initialized: boolean; subs: Set<string>; open: boolean };
type LogEntry = { seq: number; method: string; params: unknown };
type ThreadRec = {
  thread: Thread;
  log: LogEntry[];
  running: TurnCtx | undefined;
};
type TurnCtx = {
  threadId: string;
  turn: Turn;
  aborted: boolean;
  steer: string[];
  open: Map<string, Item>;
};

class Interrupted extends Error {}

const iso = (ms = Date.now()) => new Date(ms).toISOString();

export type MockOptions = {
  /** Multiplies every scripted delay (tests use 0). */
  speed?: number;
  /** Seconds from a watch with a rule being created to its price drop (the demo clock). */
  demoDropAfter?: number;
  /** Seed an older thread, a watch, an order and an away-summary entry. */
  seed?: boolean;
  /** Live price ticks on active watches, ms (0 disables). */
  tickMs?: number;
};

export class MockHarness {
  private conns = new Set<Conn>();
  private threads = new Map<string, ThreadRec>();
  private shop: ShopState;
  private version = 0;
  private offers = new Map<string, Offer>();
  private approvals = new Map<
    string,
    {
      item: ItemOf<"approvalRequest">;
      resolve: (r: { decision: "approve" | "deny"; edits?: Record<string, unknown> }) => void;
    }
  >();
  private serverReqs = new Map<string, string>(); // rpc id → approvalId
  private browser = new Map<string, BrowserSession>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private n = 0;
  private readonly speed: number;
  private readonly opts: Required<MockOptions>;

  constructor(opts: MockOptions = {}) {
    this.opts = { speed: 1, demoDropAfter: 9, seed: true, tickMs: 12_000, ...opts };
    this.speed = this.opts.speed;
    for (const o of makeOffers(Date.now())) this.offers.set(o.id, o);
    this.shop = {
      watches: [],
      orders: [],
      wallet: { connected: false },
      coolingOffMinutes: 10,
      stepUpAbove: usd(50000),
    };
    if (this.opts.seed) this.seed();
    if (this.opts.tickMs > 0) this.every(this.opts.tickMs, () => this.tickPrices());
  }

  /** Stop timers (tests, unmount). */
  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ── transport ──

  connect: Connect = (h) => {
    const c: Conn = { h, initialized: false, subs: new Set(), open: true };
    this.conns.add(c);
    this.later(0, () => c.open && h.onOpen());
    return {
      send: (frame) => {
        // Round-trip through JSON like a real socket, async like a real socket.
        const copy = JSON.parse(JSON.stringify(frame)) as Frame;
        this.later(0, () => c.open && void this.onFrame(c, copy));
      },
      close: () => this.drop(c),
    };
  };

  /** Simulate a network drop for every connection (the client reconnects and resumes). */
  dropAll() {
    for (const c of [...this.conns]) this.drop(c, true);
  }

  private drop(c: Conn, notify = false) {
    if (!c.open) return;
    c.open = false;
    this.conns.delete(c);
    if (notify) this.later(0, () => c.h.onClose({ unauthorized: false }));
    else c.h.onClose({ unauthorized: false });
  }

  private send(c: Conn, frame: unknown) {
    if (!c.open) return;
    const copy = JSON.parse(JSON.stringify(frame));
    this.later(0, () => c.open && c.h.onMessage(copy));
  }

  private async onFrame(c: Conn, f: Frame) {
    if (f.method && f.id !== undefined) {
      if (!c.initialized && f.method !== "initialize") {
        return this.send(c, {
          id: f.id,
          error: { code: ErrorCodes.notInitialized, message: "initialize first" },
        });
      }
      try {
        const result = await this.handle(c, f.method, (f.params ?? {}) as Record<string, unknown>);
        this.send(c, { id: f.id, result });
      } catch (e) {
        const err = e as { code?: number; message?: string };
        this.send(c, {
          id: f.id,
          error: { code: err.code ?? ErrorCodes.internal, message: err.message ?? "error" },
        });
      }
      return;
    }
    if (f.id !== undefined && ("result" in f || "error" in f)) {
      const approvalId = this.serverReqs.get(String(f.id));
      if (!approvalId) return;
      this.serverReqs.delete(String(f.id));
      const r = (f.result ?? { decision: "deny" }) as {
        decision: "approve" | "deny";
        edits?: Record<string, unknown>;
      };
      this.decide(approvalId, r);
    }
  }

  // ── emit ──

  private emitThread(threadId: string, method: string, params: unknown) {
    const rec = this.threads.get(threadId);
    if (!rec) return;
    const seq = rec.log.length + 1;
    rec.log.push({ seq, method, params });
    for (const c of this.conns)
      if (c.initialized && c.subs.has(threadId)) this.send(c, { method, seq, params });
  }

  private emitUser(method: string, params: unknown) {
    for (const c of this.conns) if (c.initialized) this.send(c, { method, params });
  }

  private patch(ops: { op: "add" | "replace" | "remove"; path: string; value?: unknown }[]) {
    const baseVersion = this.version;
    this.version += 1;
    this.emitUser("state/patch", { version: this.version, baseVersion, ops });
  }

  // ── requests ──

  private async handle(c: Conn, method: string, p: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize": {
        c.initialized = true;
        this.send(c, {
          method: "state/snapshot",
          params: { version: this.version, state: this.shop },
        });
        for (const s of this.browser.values())
          this.send(c, { method: "browser/updated", params: { session: s } });
        if (this.opts.seed && !this.greeted) {
          this.greeted = true;
          this.later(1200, () => this.seedInbox());
        }
        return {
          userAgent: "shop-mock/0.1",
          protocolVersion: PROTOCOL_VERSION,
          userId: "usr_demo",
          capabilities: ["browserRun", "autoBuy", "webSearch", "mock"],
        };
      }
      case "state/get":
        return { version: this.version, state: this.shop };
      case "thread/list":
        return {
          threads: [...this.threads.values()]
            .map((r) => r.thread)
            .filter((t) => p.includeArchived || !t.archived)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        };
      case "thread/start": {
        const thread = this.newThread(String(p.title ?? "New chat"));
        this.emitUser("thread/started", { thread });
        return { thread };
      }
      case "thread/resume": {
        const rec = this.mustThread(p.threadId);
        c.subs.add(rec.thread.id);
        const after = Number(p.afterSeq ?? 0);
        for (const e of rec.log)
          if (e.seq > after) this.send(c, { method: e.method, seq: e.seq, params: e.params });
        // Re-ask open approvals on this connection.
        for (const a of this.approvals.values())
          if (a.item.threadId === rec.thread.id) this.askApproval(a.item, c);
        return { thread: rec.thread, lastSeq: rec.log.length };
      }
      case "thread/read": {
        const rec = this.mustThread(p.threadId);
        return { thread: rec.thread, turns: [], items: [] };
      }
      case "thread/archive": {
        const rec = this.mustThread(p.threadId);
        rec.thread = { ...rec.thread, archived: p.archived !== false };
        this.emitUser("thread/updated", { thread: rec.thread });
        return {};
      }
      case "turn/start": {
        const rec = this.mustThread(p.threadId);
        if (rec.running) throw { code: ErrorCodes.turnInProgress, message: "A turn is running" };
        const turn = this.startTurn(
          rec,
          String(p.text),
          (p.uiState ?? undefined) as Record<string, unknown> | undefined,
          "user",
        );
        return { turn };
      }
      case "turn/steer": {
        const rec = this.mustThread(p.threadId);
        if (!rec.running || rec.running.turn.id !== p.turnId) return { accepted: false };
        const text = String(p.text);
        rec.running.steer.push(text);
        const item = this.item(rec.running, { type: "userMessage", text, status: "completed" });
        this.emitThread(rec.thread.id, "item/started", { item });
        this.emitThread(rec.thread.id, "item/completed", { item });
        return { accepted: true };
      }
      case "turn/interrupt": {
        const rec = this.mustThread(p.threadId);
        if (rec.running && rec.running.turn.id === p.turnId) {
          rec.running.aborted = true;
          for (const a of [...this.approvals.values()])
            if (a.item.turnId === p.turnId) this.decide(a.item.approvalId, { decision: "deny" });
        }
        return {};
      }
      case "approval/respond": {
        if (!this.approvals.has(String(p.approvalId))) return { accepted: false };
        this.decide(String(p.approvalId), {
          decision: p.decision as "approve" | "deny",
          ...(p.edits ? { edits: p.edits as Record<string, unknown> } : {}),
        });
        return { accepted: true };
      }
      case "action/invoke":
        return {
          result: await this.action(String(p.name), (p.args ?? {}) as Record<string, unknown>),
        };
      case "browser/takeControl": {
        const s = this.browser.get(String(p.sessionId));
        if (!s) throw { code: ErrorCodes.notFound, message: "No such browser session" };
        const offer = this.offerForUrl(s.url);
        const next: BrowserSession = {
          ...s,
          controller: "user",
          liveViewUrl: livePage(offer),
          updatedAt: iso(),
        };
        this.setBrowser(next);
        return { liveViewUrl: next.liveViewUrl };
      }
      case "browser/handBack": {
        const s = this.browser.get(String(p.sessionId));
        if (!s) throw { code: ErrorCodes.notFound, message: "No such browser session" };
        const { liveViewUrl: _, ...rest } = s;
        this.setBrowser({ ...rest, controller: "agent", updatedAt: iso() });
        return {};
      }
      default:
        throw { code: ErrorCodes.methodNotFound, message: `Unknown method ${method}` };
    }
  }

  private greeted = false;

  private mustThread(id: unknown): ThreadRec {
    const rec = this.threads.get(String(id));
    if (!rec) throw { code: ErrorCodes.notFound, message: "No such thread" };
    return rec;
  }

  private newThread(title: string): Thread {
    const id = `thr_${++this.n}`;
    const thread: Thread = {
      id,
      title: title || "New chat",
      createdAt: iso(),
      updatedAt: iso(),
      archived: false,
      preview: "",
    };
    this.threads.set(id, { thread, log: [], running: undefined });
    return thread;
  }

  // ── actions (widget buttons) ──

  private async action(name: string, a: Record<string, unknown>): Promise<unknown> {
    await this.sleep(250);
    switch (name) {
      case "watch.pause":
      case "watch.resume":
      case "watch.cancel":
      case "watch.approveReview": {
        const status: Watch["status"] =
          name === "watch.pause" ? "paused" : name === "watch.cancel" ? "cancelled" : "active";
        const w = this.updateWatch(String(a.watchId), (w) => ({
          ...w,
          status,
          reviewReason: undefined,
        }));
        return { watch: w };
      }
      case "order.cancel": {
        const o = this.findOrder(String(a.orderId));
        if (o.status !== "coolingOff")
          throw { code: ErrorCodes.conflict, message: "The undo window has closed." };
        return {
          order: this.updateOrder(o.id, (o) => ({ ...o, status: "voided", updatedAt: iso() })),
        };
      }
      case "order.captureNow": {
        const o = this.findOrder(String(a.orderId));
        if (o.status !== "coolingOff")
          throw { code: ErrorCodes.conflict, message: "Already settled." };
        return { order: this.capture(o.id) };
      }
      case "wallet.startConnect":
        return { setupTokenId: `VST-${Math.random().toString(36).slice(2, 10).toUpperCase()}` };
      case "wallet.completeConnect": {
        if (!a.setupTokenId)
          throw { code: ErrorCodes.invalidParams, message: "Missing setup token" };
        this.shop = {
          ...this.shop,
          wallet: { connected: true, label: "PayPal · d•••@example.com", connectedAt: iso() },
        };
        this.patch([{ op: "replace", path: "/wallet", value: this.shop.wallet }]);
        return { wallet: this.shop.wallet };
      }
      case "wallet.disconnect":
        this.shop = { ...this.shop, wallet: { connected: false } };
        this.patch([{ op: "replace", path: "/wallet", value: this.shop.wallet }]);
        return { wallet: this.shop.wallet };
      case "settings.update": {
        const m = Number(a.coolingOffMinutes);
        if (Number.isInteger(m) && m >= 0 && m <= 1440) {
          this.shop = { ...this.shop, coolingOffMinutes: m };
          this.patch([{ op: "replace", path: "/coolingOffMinutes", value: m }]);
        }
        return { coolingOffMinutes: this.shop.coolingOffMinutes };
      }
      default:
        throw { code: ErrorCodes.methodNotFound, message: `Unknown action ${name}` };
    }
  }

  private findOrder(id: string): Order {
    const o = this.shop.orders.find((x) => x.id === id);
    if (!o) throw { code: ErrorCodes.notFound, message: "No such order" };
    return o;
  }

  private updateWatch(id: string, fn: (w: Watch) => Watch): Watch {
    const i = this.shop.watches.findIndex((w) => w.id === id);
    if (i < 0) throw { code: ErrorCodes.notFound, message: "No such watch" };
    const next = JSON.parse(JSON.stringify(fn(this.shop.watches[i] as Watch))) as Watch;
    this.shop = { ...this.shop, watches: this.shop.watches.map((w, j) => (j === i ? next : w)) };
    this.patch([{ op: "replace", path: `/watches/${i}`, value: next }]);
    return next;
  }

  private updateOrder(id: string, fn: (o: Order) => Order): Order {
    const i = this.shop.orders.findIndex((o) => o.id === id);
    const next = fn(this.shop.orders[i] as Order);
    this.shop = { ...this.shop, orders: this.shop.orders.map((o, j) => (j === i ? next : o)) };
    this.patch([{ op: "replace", path: `/orders/${i}`, value: next }]);
    return next;
  }

  private addOrder(order: Order) {
    this.shop = { ...this.shop, orders: [order, ...this.shop.orders] };
    this.patch([{ op: "add", path: "/orders/0", value: order }]);
    if (order.coolingOffEndsAt) {
      const ms = Date.parse(order.coolingOffEndsAt) - Date.now();
      this.timer(ms, () => {
        const cur = this.shop.orders.find((o) => o.id === order.id);
        if (cur?.status !== "coolingOff") return;
        this.capture(order.id);
        this.emitUser("inbox/added", {
          id: `inb_${++this.n}`,
          level: "success",
          title: `Paid: ${cur.offer.title.split(",")[0]}`,
          body: `The undo window ended and PayPal captured ${formatMoney(cur.total)}.`,
          at: iso(),
          ...(cur.watchId ? {} : {}),
        });
      });
    }
  }

  private capture(id: string): Order {
    return this.updateOrder(id, (o) => ({
      ...o,
      status: "captured",
      paypal: {
        ...o.paypal,
        captureId: `3C${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
      },
      updatedAt: iso(),
    }));
  }

  // ── approvals ──

  private askApproval(item: ItemOf<"approvalRequest">, only?: Conn) {
    for (const c of only ? [only] : this.conns) {
      if (!c.initialized || !c.subs.has(item.threadId)) continue;
      const id = `srv_${++this.n}`;
      this.serverReqs.set(id, item.approvalId);
      this.send(c, { id, method: "approval/request", params: { item } });
    }
  }

  private decide(
    approvalId: string,
    r: { decision: "approve" | "deny"; edits?: Record<string, unknown> },
  ) {
    const a = this.approvals.get(approvalId);
    if (!a) return;
    this.approvals.delete(approvalId);
    for (const [rid, aid] of this.serverReqs) if (aid === approvalId) this.serverReqs.delete(rid);
    a.resolve(r);
  }

  private async approval(
    t: TurnCtx,
    kind: ApprovalKind,
    fields: {
      title: string;
      summary: string;
      amount?: Money;
      details?: unknown;
      stepUp?: boolean;
      toolCallId?: string;
    },
  ) {
    const approvalId = `apr_${++this.n}`;
    const item = this.item(t, {
      type: "approvalRequest",
      approvalId,
      kind,
      title: fields.title,
      summary: fields.summary,
      stepUp: fields.stepUp ?? false,
      expiresAt: iso(Date.now() + 10 * 60_000),
      ...(fields.amount ? { amount: fields.amount } : {}),
      ...(fields.details ? { details: fields.details } : {}),
      ...(fields.toolCallId ? { toolCallId: fields.toolCallId } : {}),
    }) as ItemOf<"approvalRequest">;
    this.emitThread(t.threadId, "item/started", { item });
    t.turn = { ...t.turn, status: "awaitingApproval" };
    this.emitThread(t.threadId, "turn/started", { turn: t.turn });
    const decision = await new Promise<{
      decision: "approve" | "deny";
      edits?: Record<string, unknown>;
    }>((resolve) => {
      this.approvals.set(approvalId, { item, resolve });
      this.askApproval(item);
    });
    const done = {
      ...item,
      status: "completed" as const,
      completedAt: iso(),
      decision: decision.decision === "approve" ? ("approved" as const) : ("denied" as const),
    };
    t.open.delete(item.id);
    this.emitThread(t.threadId, "item/completed", { item: done });
    t.turn = { ...t.turn, status: "inProgress" };
    this.emitThread(t.threadId, "turn/started", { turn: t.turn });
    if (t.aborted) throw new Interrupted();
    return decision;
  }

  // ── turns ──

  private startTurn(
    rec: ThreadRec,
    text: string,
    uiState: Record<string, unknown> | undefined,
    origin: Turn["origin"],
  ): Turn {
    const turn: Turn = {
      id: `trn_${++this.n}`,
      threadId: rec.thread.id,
      status: "inProgress",
      startedAt: iso(),
      origin,
    };
    const t: TurnCtx = {
      threadId: rec.thread.id,
      turn,
      aborted: false,
      steer: [],
      open: new Map(),
    };
    rec.running = t;
    rec.thread = {
      ...rec.thread,
      updatedAt: iso(),
      ...(origin === "user" ? { preview: text.slice(0, 200) } : {}),
    };
    if (rec.log.length === 0 && origin === "user")
      rec.thread = { ...rec.thread, title: titleFor(text) };
    this.emitUser("thread/updated", { thread: rec.thread });
    this.emitThread(rec.thread.id, "turn/started", { turn });
    if (origin === "user") {
      const item = this.item(t, {
        type: "userMessage",
        text,
        status: "completed",
        ...(uiState ? { uiState } : {}),
      });
      this.emitThread(rec.thread.id, "item/started", { item });
      this.emitThread(rec.thread.id, "item/completed", { item });
    }
    void this.run(rec, t, text, uiState);
    return turn;
  }

  private async run(rec: ThreadRec, t: TurnCtx, text: string, uiState?: Record<string, unknown>) {
    let status: Turn["status"] = "completed";
    try {
      await this.script(t, text, uiState);
      if (t.steer.length)
        await this.say(t, `Noted: “${t.steer.join("; ")}”. I'll keep that in mind from here.`);
    } catch (e) {
      status = e instanceof Interrupted ? "interrupted" : "failed";
      for (const item of t.open.values()) {
        const failed =
          item.type === "toolCall"
            ? { ...item, status: "failed" as const, error: "Stopped", completedAt: iso() }
            : { ...item, status: "completed" as const, completedAt: iso() };
        this.emitThread(t.threadId, "item/completed", { item: failed });
      }
    }
    rec.running = undefined;
    this.emitThread(t.threadId, "turn/completed", {
      turn: { ...t.turn, status, completedAt: iso() },
    });
  }

  private item(t: TurnCtx, fields: Record<string, unknown>): Item {
    const item = {
      id: `itm_${++this.n}`,
      threadId: t.threadId,
      turnId: t.turn.id,
      createdAt: iso(),
      status: "inProgress",
      ...fields,
    } as Item;
    if (item.status === "inProgress") t.open.set(item.id, item);
    return item;
  }

  private async step(t: TurnCtx, ms: number) {
    await this.sleep(ms);
    if (t.aborted) throw new Interrupted();
  }

  private async think(t: TurnCtx, summary: string) {
    const item = this.item(t, { type: "reasoning", summary: "" }) as ItemOf<"reasoning">;
    this.emitThread(t.threadId, "item/started", { item });
    for (const chunk of chunks(summary, 6)) {
      await this.step(t, 70);
      this.emitThread(t.threadId, "item/reasoning/delta", {
        threadId: t.threadId,
        itemId: item.id,
        delta: chunk,
      });
    }
    await this.step(t, 400);
    t.open.delete(item.id);
    this.emitThread(t.threadId, "item/completed", {
      item: { ...item, summary, status: "completed", completedAt: iso() },
    });
  }

  private async say(
    t: TurnCtx,
    text: string,
    citations?: { n: number; url: string; title: string }[],
  ) {
    const item = this.item(t, { type: "agentMessage", text: "" }) as ItemOf<"agentMessage">;
    this.emitThread(t.threadId, "item/started", { item });
    for (const chunk of chunks(text, 3)) {
      await this.step(t, 28);
      this.emitThread(t.threadId, "item/agentMessage/delta", {
        threadId: t.threadId,
        itemId: item.id,
        delta: chunk,
      });
    }
    t.open.delete(item.id);
    this.emitThread(t.threadId, "item/completed", {
      item: {
        ...item,
        text,
        status: "completed",
        completedAt: iso(),
        ...(citations ? { citations } : {}),
      },
    });
  }

  private async tool<R>(
    t: TurnCtx,
    name: string,
    args: unknown,
    summary: string,
    progress: string[],
    run: () => R | Promise<R>,
  ): Promise<R> {
    const item = this.item(t, { type: "toolCall", name, summary, args }) as ItemOf<"toolCall">;
    this.emitThread(t.threadId, "item/started", { item });
    for (const [i, label] of progress.entries()) {
      await this.step(t, i === 0 ? 150 : 650);
      this.emitThread(t.threadId, "item/toolCall/progress", {
        threadId: t.threadId,
        itemId: item.id,
        label,
        fraction: (i + 1) / (progress.length + 1),
      });
    }
    await this.step(t, 600);
    try {
      const result = await run();
      t.open.delete(item.id);
      this.emitThread(t.threadId, "item/completed", {
        item: { ...item, status: "completed", result, completedAt: iso() },
      });
      return result;
    } catch (e) {
      if (e instanceof Interrupted) throw e;
      t.open.delete(item.id);
      this.emitThread(t.threadId, "item/completed", {
        item: { ...item, status: "failed", error: (e as Error).message, completedAt: iso() },
      });
      throw e;
    }
  }

  private async declinedTool(t: TurnCtx, name: string, args: unknown, summary: string) {
    const item = this.item(t, {
      type: "toolCall",
      name,
      summary,
      args,
      status: "declined",
      completedAt: iso(),
    });
    this.emitThread(t.threadId, "item/started", { item });
    this.emitThread(t.threadId, "item/completed", { item });
  }

  // ── scripts ──

  private async script(t: TurnCtx, text: string, uiState?: Record<string, unknown>) {
    const s = text.toLowerCase();
    const intent = typeof uiState?.intent === "string" ? uiState.intent : undefined;
    const offerId = typeof uiState?.offerId === "string" ? uiState.offerId : undefined;

    if (intent === "buy_offer" || (/\bbuy\b/.test(s) && !/(watch|when|drops?|under \$)/.test(s)))
      return this.scriptBuy(t, offerId);
    if (intent === "create_watch" || /(watch|tell me when|drops?|alert)/.test(s))
      return this.scriptWatch(t, s, offerId);
    if (/\b(fail|break)\b/.test(s)) return this.scriptFail(t);
    if (/(undo|cancel).*(order|purchase)/.test(s)) return this.scriptCancelOrder(t);
    if (/\b(my )?orders?\b/.test(s)) return this.scriptListOrders(t);
    if (/\b(my )?watch(es|list)\b/.test(s)) return this.scriptListWatches(t);
    if (/compare/.test(s)) return this.scriptCompare(t);
    if (/(open|show me|visit|page|site)/.test(s)) return this.scriptOpenPage(t, offerId);
    if (/(which|better|\bvs\b|versus|review|worth)/.test(s)) return this.scriptResearch(t, text);
    return this.scriptSearch(t, text);
  }

  private async scriptSearch(t: TurnCtx, text: string) {
    await this.think(
      t,
      "Looking for current offers. PayPal sellers first, since those can be bought here, then the open web for price checks.",
    );
    const offers = [...this.offers.values()];
    await this.tool(
      t,
      "search_products",
      {
        query: text.slice(0, 120),
        objective: "Current offers for the requested product, in stock, with prices.",
      },
      `Searched shops for “${text.slice(0, 60)}”`,
      ["Searching PayPal sellers", "Searching the web", "Reading offers"],
      () => ({ offers, sources: makeSources() }),
    );
    await this.say(
      t,
      "I found **5 offers**. The best one you can buy right here is the **Sony WH-1000XM6** from Northwind Audio, a PayPal seller, at a quarter off list [1]. Bluebird has the same model but only on their own site [2].\n\nWant me to **compare the top three**, or **watch the price** and buy it if it drops?",
      makeSources().slice(0, 2),
    );
  }

  private async scriptCompare(t: TurnCtx) {
    const ids = ["off_xm6_northwind", "off_qcu_harbor", "off_m4_northwind"];
    await this.think(t, "Comparing noise cancelling, battery, comfort and how each can be bought.");
    await this.tool(
      t,
      "compare_offers",
      { offerIds: ids },
      "Compared 3 headphones",
      ["Reading spec sheets", "Lining up prices"],
      () => ({
        offers: ids.map((id) => this.offers.get(id) as Offer),
        rows: [
          { label: "Noise cancelling", values: ["Best in class", "Excellent", "Very good"] },
          { label: "Battery", values: ["30 h", "24 h", "60 h"] },
          { label: "Weight", values: ["254 g", "250 g", "293 g"] },
          { label: "Multipoint", values: ["Yes", "Yes", "Yes"] },
          { label: "Returns", values: ["30 days", "30 days", "30 days"] },
        ],
        pick: "off_xm6_northwind",
        reason: "Strongest noise cancelling, light, and buyable with PayPal at a quarter off list.",
      }),
    );
    await this.say(
      t,
      "My pick is the **Sony XM6**. If battery life matters most, the Momentum 4 lasts twice as long for less.",
    );
  }

  private async scriptResearch(t: TurnCtx, text: string) {
    const sources = makeSources();
    await this.tool(
      t,
      "web_research",
      {
        question: text.slice(0, 300),
        objective: "Independent comparisons of noise cancelling, comfort and battery.",
      },
      "Researched reviews",
      ["Searching reviews", "Reading 3 sources"],
      () => ({
        answer:
          "The Sony XM6 blocks more low-frequency noise, which matters most on planes and trains [3]. The Bose QC Ultra is slightly more comfortable over long sessions and has the better spatial audio mode [3]. Both last a full working day; Sony quotes 30 hours per charge [1].\n\nFor commuting the Sony is the safer choice; for long desk sessions the Bose is worth a try.",
        sources,
      }),
    );
    await this.say(
      t,
      "Short version: **Sony for blocking noise, Bose for comfort.** Want me to watch the Sony's price?",
    );
  }

  private async scriptOpenPage(t: TurnCtx, offerId?: string) {
    const offer = this.offers.get(offerId ?? "off_xm6_northwind") as Offer;
    const sessionId = `brs_${++this.n}`;
    await this.tool(
      t,
      "open_page",
      { url: offer.url },
      `Opened ${offer.merchant.domain}`,
      ["Starting a browser", "Loading the page"],
      async () => {
        this.setBrowser({
          sessionId,
          url: offer.url,
          title: offer.title,
          controller: "agent",
          screenshotUrl: pageScreenshot(offer, "Agent is reading this page"),
          updatedAt: iso(),
        });
        await this.step(t, 900);
        this.setBrowser({
          sessionId,
          url: offer.url,
          title: offer.title,
          controller: "agent",
          screenshotUrl: pageScreenshot(offer),
          updatedAt: iso(),
        });
        return {
          url: offer.url,
          title: offer.title,
          excerpt: `${offer.title}. ${offer.highlights.join(" ")} Free shipping. 30-day returns. Pay with PayPal at checkout.`,
          sessionId,
        };
      },
    );
    await this.say(
      t,
      "The page is open in the browser pane. It matches the listing: in stock, free shipping. You can **take control** there if you want to look around yourself.",
    );
  }

  private async scriptWatch(t: TurnCtx, s: string, offerId?: string) {
    const offer = this.offers.get(offerId ?? "off_xm6_northwind") as Offer;
    const amounts = [...s.matchAll(/\$\s?(\d{2,5})(?:\.(\d{2}))?/g)].map(
      (m) => Number(m[1]) * 100 + Number(m[2] ?? 0),
    );
    const target = usd(amounts[0] ?? Math.round((offer.price.amountMinor * 0.93) / 100) * 100);
    const wantsBuy = /\bbuy\b/.test(s) && offer.buyable;
    const maxUnit = usd(amounts[1] ?? target.amountMinor);

    await this.think(
      t,
      wantsBuy
        ? "Setting a watch with an auto-buy rule. The rule needs the user's OK once, with hard limits."
        : "Setting a price watch; checking the live price first.",
    );
    const check = await this.tool(
      t,
      "check_price",
      { offerId: offer.id },
      "Checked the live price",
      ["Reading the page’s price data"],
      () => ({
        offerId: offer.id,
        url: offer.url,
        price: offer.price,
        shipping: offer.shipping ?? usd(0),
        inStock: true,
        method: "jsonLd" as const,
        checkedAt: iso(),
      }),
    );

    const watchId = `wat_${++this.n}`;
    const rule = wantsBuy
      ? {
          maxUnitPrice: maxUnit,
          maxTotal: usd(maxUnit.amountMinor + 2000),
          quantity: 1,
          expiresAt: iso(Date.now() + 30 * 86_400_000),
        }
      : undefined;
    const call = this.item(t, {
      type: "toolCall",
      name: "create_watch",
      summary: "Price watch",
      args: {
        offerId: offer.id,
        targetPrice: target,
        everyMinutes: 60,
        ...(rule ? { autoBuy: rule } : {}),
      },
    }) as ItemOf<"toolCall">;
    this.emitThread(t.threadId, "item/started", { item: call });

    let autoBuy: Watch["autoBuy"];
    if (rule) {
      const d = await this.approval(t, "autoBuyRule", {
        title: `Auto-buy ${offer.title.split(",")[0]}`,
        summary:
          "I'll re-check price, stock and variant right before buying. Every purchase still gets a 10-minute undo window.",
        details: { offer, rule },
        toolCallId: call.id,
      });
      if (d.decision === "approve") {
        const e = (d.edits ?? {}) as Partial<typeof rule>;
        autoBuy = { ...rule, ...e, mandateId: `mdt_${++this.n}` };
      }
    }
    await this.step(t, 500);
    const now = Date.now();
    const watch: Watch = {
      id: watchId,
      offer,
      targetPrice: target,
      ...(autoBuy ? { autoBuy } : {}),
      status: "active",
      everyMinutes: 60,
      lastCheck: check,
      nextCheckAt: iso(now + 60 * 60_000),
      history: priceHistory(
        offer.listPrice?.amountMinor ?? offer.price.amountMinor + 4000,
        offer.price.amountMinor,
        16,
        now,
      ),
      threadId: t.threadId,
      createdAt: iso(now),
    };
    this.shop = { ...this.shop, watches: [watch, ...this.shop.watches] };
    this.patch([{ op: "add", path: "/watches/0", value: watch }]);
    t.open.delete(call.id);
    this.emitThread(t.threadId, "item/completed", {
      item: { ...call, status: "completed", result: { watch }, completedAt: iso() },
    });

    await this.say(
      t,
      autoBuy
        ? `Watching it hourly. If it drops to your limit I'll **buy it with PayPal** and give you **${this.shop.coolingOffMinutes} minutes to undo** before any money moves.`
        : rule
          ? "Watching without auto-buy. I'll tell you when it hits your target."
          : "Watching it hourly. I'll tell you when it hits your target.",
    );
    // Demo clock: the price drops a few seconds later.
    this.timer(this.opts.demoDropAfter * 1000 * this.speed, () => void this.fireWatch(watchId));
  }

  private async fireWatch(watchId: string) {
    const w = this.shop.watches.find((x) => x.id === watchId);
    if (!w || w.status !== "active" || !w.threadId) return;
    const rec = this.threads.get(w.threadId);
    if (!rec || rec.running) return void this.timer(3000, () => void this.fireWatch(watchId));
    const dropTo = usd(
      Math.min(w.targetPrice.amountMinor, w.autoBuy?.maxUnitPrice.amountMinor ?? Infinity) - 100,
    );
    const check = {
      ...(w.lastCheck as NonNullable<Watch["lastCheck"]>),
      price: dropTo,
      checkedAt: iso(),
    };
    this.updateWatch(w.id, (x) => ({
      ...x,
      status: "triggered",
      lastCheck: check,
      history: [...x.history, { at: iso(), amountMinor: dropTo.amountMinor }],
      offer: { ...x.offer, price: dropTo },
    }));
    this.emitUser("inbox/added", {
      id: `inb_${++this.n}`,
      threadId: w.threadId,
      level: w.autoBuy ? "success" : "actionRequired",
      title: `${w.offer.title.split(",")[0]} hit ${formatMoney(dropTo)}`,
      body: w.autoBuy
        ? "Your auto-buy rule covered it; the undo window is open."
        : "At your target. Want me to buy it?",
      at: iso(),
    });
    const t = this.startTurnScheduled(rec);
    try {
      await this.think(
        t,
        w.autoBuy
          ? "Price is under the rule's limit. Re-verifying price, stock and variant before authorizing."
          : "Target reached; telling the user.",
      );
      const live = await this.tool(
        t,
        "check_price",
        { offerId: w.offer.id },
        "Re-checked the live price",
        ["Reading the page’s price data", "Comparing with the trailing median"],
        () => check,
      );
      if (!w.autoBuy) {
        await this.say(
          t,
          `The ${w.offer.title.split(",")[0]} is at your target now. Say **buy it** and I'll set up the purchase.`,
        );
      } else {
        const order = await this.tool(
          t,
          "buy_offer",
          { offerId: w.offer.id, quantity: 1 },
          "Bought under your auto-buy rule",
          ["Authorizing with PayPal"],
          () => {
            const o = this.newOrder({ ...w.offer, price: live.price }, 1, w.id);
            return { order: o };
          },
        );
        this.updateWatch(w.id, (x) => ({ ...x, status: "completed" }));
        await this.say(
          t,
          `Bought under your rule. PayPal has **authorized** it; nothing is charged until the undo window closes. Changed your mind? Hit **Undo purchase**.`,
        );
        void order;
      }
    } catch {
      /* interrupted */
    }
    this.finishTurn(rec, t);
  }

  private startTurnScheduled(rec: ThreadRec): TurnCtx {
    const turn: Turn = {
      id: `trn_${++this.n}`,
      threadId: rec.thread.id,
      status: "inProgress",
      startedAt: iso(),
      origin: "schedule",
    };
    const t: TurnCtx = {
      threadId: rec.thread.id,
      turn,
      aborted: false,
      steer: [],
      open: new Map(),
    };
    rec.running = t;
    rec.thread = { ...rec.thread, updatedAt: iso() };
    this.emitUser("thread/updated", { thread: rec.thread });
    this.emitThread(rec.thread.id, "turn/started", { turn });
    return t;
  }

  private finishTurn(rec: ThreadRec, t: TurnCtx) {
    rec.running = undefined;
    this.emitThread(t.threadId, "turn/completed", {
      turn: { ...t.turn, status: t.aborted ? "interrupted" : "completed", completedAt: iso() },
    });
  }

  private newOrder(offer: Offer, quantity: number, watchId?: string): Order {
    const total = usd(offer.price.amountMinor * quantity + (offer.shipping?.amountMinor ?? 0));
    const mins = this.shop.coolingOffMinutes;
    const order: Order = {
      id: `ord_${++this.n}`,
      offer,
      quantity,
      total,
      status: mins > 0 ? "coolingOff" : "captured",
      ...(mins > 0 ? { coolingOffEndsAt: iso(Date.now() + mins * 60_000) } : {}),
      paypal: {
        orderId: `5O${Math.random().toString(36).slice(2, 16).toUpperCase()}`,
        authorizationId: `0V${Math.random().toString(36).slice(2, 16).toUpperCase()}`,
        ...(mins > 0
          ? {}
          : { captureId: `3C${Math.random().toString(36).slice(2, 12).toUpperCase()}` }),
      },
      ...(watchId ? { watchId } : {}),
      createdAt: iso(),
      updatedAt: iso(),
    };
    this.addOrder(order);
    return order;
  }

  private async scriptBuy(t: TurnCtx, offerId?: string) {
    const offer = this.offers.get(offerId ?? "off_xm6_northwind") as Offer;
    if (!offer.buyable) {
      await this.say(
        t,
        `${offer.merchant.name} doesn't take PayPal through us, so I can't buy it for you. Use **Buy at merchant** on the card, or I can watch the price instead.`,
      );
      return;
    }
    const total = usd(offer.price.amountMinor + (offer.shipping?.amountMinor ?? 0));
    await this.think(
      t,
      "A one-off purchase outside any rule: asking first, with the server-checked total.",
    );
    const d = await this.approval(t, "purchase", {
      title: `Buy ${offer.title.split(",")[0]}`,
      summary: `From ${offer.merchant.name}. PayPal authorizes now and captures after the undo window.`,
      amount: total,
      details: { offer, quantity: 1, total, coolingOffMinutes: this.shop.coolingOffMinutes },
      stepUp: total.amountMinor > this.shop.stepUpAbove.amountMinor,
    });
    if (d.decision !== "approve") {
      await this.declinedTool(
        t,
        "buy_offer",
        { offerId: offer.id, quantity: 1 },
        "Purchase declined",
      );
      await this.say(t, "OK, not buying. Nothing was authorized.");
      return;
    }
    await this.tool(
      t,
      "buy_offer",
      { offerId: offer.id, quantity: 1 },
      `Bought ${offer.title.split(",")[0]}`,
      ["Re-checking price and stock", "Authorizing with PayPal"],
      () => ({
        order: this.newOrder(offer, 1),
      }),
    );
    await this.say(
      t,
      this.shop.coolingOffMinutes > 0
        ? `Done. PayPal **authorized** it; you have **${this.shop.coolingOffMinutes} minutes to undo** before it's captured.`
        : "Done. PayPal captured the payment.",
    );
  }

  private async scriptCancelOrder(t: TurnCtx) {
    const o = this.shop.orders.find((x) => x.status === "coolingOff");
    if (!o) return this.say(t, "There's no order in its undo window right now.");
    await this.tool(
      t,
      "cancel_order",
      { orderId: o.id },
      "Voided the authorization",
      ["Voiding with PayPal"],
      () => ({
        order: this.updateOrder(o.id, (x) => ({ ...x, status: "voided", updatedAt: iso() })),
      }),
    );
    await this.say(t, "Cancelled. The authorization is voided and no money moved.");
  }

  private async scriptListOrders(t: TurnCtx) {
    await this.tool(t, "list_orders", {}, "Listed your orders", [], () => ({
      orders: this.shop.orders,
    }));
    await this.say(t, this.shop.orders.length ? "Here are your orders." : "No orders yet.");
  }

  private async scriptListWatches(t: TurnCtx) {
    await this.tool(t, "list_watches", {}, "Listed your watches", [], () => ({
      watches: this.shop.watches,
    }));
    await this.say(
      t,
      this.shop.watches.length
        ? "Here's what I'm watching for you."
        : "Nothing on the watchlist yet.",
    );
  }

  private async scriptFail(t: TurnCtx) {
    try {
      await this.tool(
        t,
        "search_products",
        { query: "anything", objective: "demo a failure" },
        "Search failed",
        ["Searching"],
        () => {
          throw new Error("The search provider timed out. Nothing was charged.");
        },
      );
    } catch (e) {
      if (e instanceof Interrupted) throw e;
    }
    await this.say(t, "The search provider didn't answer in time. Try again in a moment.");
  }

  // ── browser ──

  private setBrowser(s: BrowserSession) {
    this.browser.set(s.sessionId, s);
    this.emitUser("browser/updated", { session: s });
  }

  private offerForUrl(url: string): Offer {
    return (
      [...this.offers.values()].find((o) => o.url === url) ??
      (this.offers.get("off_xm6_northwind") as Offer)
    );
  }

  // ── seed + live prices ──

  private seed() {
    const now = Date.now();
    const rec = this.threads.get(this.newThread("Momentum 4 under $230").id) as ThreadRec;
    const offer = this.offers.get("off_m4_northwind") as Offer;
    const tid = rec.thread.id;
    const turn: Turn = {
      id: "trn_seed",
      threadId: tid,
      status: "completed",
      startedAt: iso(now - 86_400_000),
      completedAt: iso(now - 86_400_000 + 9000),
      origin: "user",
    };
    const base = {
      threadId: tid,
      turnId: turn.id,
      status: "completed" as const,
      createdAt: iso(now - 86_400_000),
    };
    const watch: Watch = {
      id: "wat_seed_m4",
      offer,
      targetPrice: usd(22995),
      status: "active",
      everyMinutes: 120,
      lastCheck: {
        offerId: offer.id,
        url: offer.url,
        price: offer.price,
        inStock: true,
        method: "paypalCatalogue",
        checkedAt: iso(now - 20 * 60_000),
      },
      nextCheckAt: iso(now + 100 * 60_000),
      history: priceHistory(34995, offer.price.amountMinor, 24, now, 2 * 3_600_000),
      threadId: tid,
      createdAt: iso(now - 86_400_000),
    };
    const push = (method: string, params: unknown) =>
      rec.log.push({ seq: rec.log.length + 1, method, params });
    push("turn/started", { turn: { ...turn, status: "inProgress" } });
    push("item/completed", {
      item: {
        ...base,
        id: "itm_seed_u",
        type: "userMessage",
        text: "Tell me when the Sennheiser Momentum 4 drops under $230",
      },
    });
    push("item/completed", {
      item: {
        ...base,
        id: "itm_seed_w",
        type: "toolCall",
        name: "create_watch",
        summary: "Price watch",
        args: {},
        result: { watch },
      },
    });
    push("item/completed", {
      item: {
        ...base,
        id: "itm_seed_m",
        type: "agentMessage",
        text: "Watching it every two hours. I'll tell you when it's under your target.",
      },
    });
    push("turn/completed", { turn });
    rec.thread = {
      ...rec.thread,
      preview: "Tell me when the Sennheiser Momentum 4 drops under $230",
      updatedAt: iso(now - 3_600_000),
      createdAt: iso(now - 86_400_000),
    };

    const qc = this.offers.get("off_qcu_harbor") as Offer;
    const past: Order = {
      id: "ord_seed_qc",
      offer: qc,
      quantity: 1,
      total: qc.price,
      status: "captured",
      paypal: {
        orderId: "5O190127TN364715T",
        authorizationId: "0VF52814937998046",
        captureId: "3C679366HH908993F",
      },
      createdAt: iso(now - 6 * 86_400_000),
      updatedAt: iso(now - 6 * 86_400_000),
    };
    this.shop = { ...this.shop, watches: [watch], orders: [past] };
  }

  private seedInbox() {
    const tid = [...this.threads.values()][0]?.thread.id;
    this.emitUser("inbox/added", {
      id: "inb_seed_1",
      ...(tid ? { threadId: tid } : {}),
      level: "info",
      title: "Momentum 4 fell 4% overnight",
      body: "Still above your $229.95 target. Watching.",
      at: iso(Date.now() - 5 * 3_600_000),
    });
    this.emitUser("inbox/added", {
      id: "inb_seed_2",
      level: "success",
      title: "Bose QC Ultra delivered",
      body: "Harbor Sound marked it delivered.",
      at: iso(Date.now() - 2 * 3_600_000),
    });
  }

  private tickPrices() {
    this.shop.watches.forEach((w, i) => {
      if (w.status !== "active") return;
      const cur = w.lastCheck?.price.amountMinor ?? w.offer.price.amountMinor;
      const drift = Math.round(cur * (Math.random() * 0.03 - 0.015));
      const next = Math.max(w.targetPrice.amountMinor + 100, cur + drift);
      const updated: Watch = {
        ...w,
        lastCheck: {
          ...(w.lastCheck ?? {
            url: w.offer.url,
            method: "jsonLd" as const,
            price: w.offer.price,
            checkedAt: iso(),
          }),
          price: usd(next),
          checkedAt: iso(),
        },
        history: [...w.history.slice(-60), { at: iso(), amountMinor: next }],
        nextCheckAt: iso(Date.now() + w.everyMinutes * 60_000),
      };
      this.shop = {
        ...this.shop,
        watches: this.shop.watches.map((x, j) => (j === i ? updated : x)),
      };
      this.patch([{ op: "replace", path: `/watches/${i}`, value: updated }]);
    });
  }

  // ── timing ──

  private sleep(ms: number) {
    return new Promise<void>((r) => this.timer(ms * this.speed, r));
  }

  private later(ms: number, fn: () => void) {
    this.timer(ms, fn);
  }

  private timer(ms: number, fn: () => void) {
    const t = setTimeout(
      () => {
        this.timers.delete(t);
        fn();
      },
      Math.max(0, ms),
    );
    this.timers.add(t);
  }

  private every(ms: number, fn: () => void) {
    const loop = () =>
      this.timer(ms, () => {
        fn();
        loop();
      });
    loop();
  }
}

function chunks(text: string, words: number): string[] {
  const parts = text.split(/(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += words * 2)
    out.push(parts.slice(i, i + words * 2).join(""));
  return out;
}

function titleFor(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}
