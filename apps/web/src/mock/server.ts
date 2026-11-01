import {
  type ClientMethod,
  ClientRequests,
  type Item,
  type Money,
  type Pact,
  type ServerNotificationMethod,
  type Thread,
} from "@pact/protocol";
import type { ActivityEntry, MandateData, TransferData } from "@/genui/refs";
import type { SocketLike } from "@/protocol/client";
import {
  COFFEE_MANDATE,
  coffeePactData,
  iso,
  ME,
  mandateFor,
  nameOf,
  PRODUCTS,
  ps6Pact,
  ps6PactData,
  SEED_ACTIVITY,
  THREADS,
  transferDraft,
  USERS,
  usd,
} from "./fixtures";

type Frame = { method: string; seq?: number; params: unknown };
type Refs = Record<string, { kind: string; data: unknown }>;

interface ThreadLog {
  thread: Thread;
  seq: number;
  log: Frame[];
  refs: Refs;
  pendingApprovals: Map<
    string,
    { itemId: string; turnId: string; onDecision: (approved: boolean) => void }
  >;
}

let idCounter = 0;
const rid = (prefix: string) =>
  `${prefix}_${(Date.now() % 1e8).toString(36)}${(idCounter++).toString(36).padStart(3, "0")}`;

const ref = (kind: string, data: unknown) => ({ kind, data });

/**
 * In-browser stand-in for the worker. Speaks the same JSON-RPC-lite protocol over a
 * fake socket, keeps a per-thread event log with `seq` so `thread/resume` replays
 * work, and runs scripted turns for the demo. Also backs the REST endpoints the web
 * app expects (`/api/wallet`, `/api/paypal/*`) through `MockApi`.
 */
export class MockServer {
  private threads = new Map<string, ThreadLog>();
  private sockets = new Set<MockSocket>();
  private subs = new Map<MockSocket, Set<string>>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  activity: ActivityEntry[] = [...SEED_ACTIVITY];
  mandates: MandateData[] = [COFFEE_MANDATE];
  /** >1 runs the script faster (tests / e2e). */
  speed = 1;

  constructor() {
    for (const t of THREADS)
      this.threads.set(t.id, { thread: t, seq: 0, log: [], refs: {}, pendingApprovals: new Map() });
    this.seedCoffee();
    this.seedPs6();
  }

  connect(): MockSocket {
    const s = new MockSocket(this);
    this.sockets.add(s);
    this.subs.set(s, new Set());
    this.later(() => s.open(), 60);
    return s;
  }

  /** Simulate a network drop on every socket (demo + tests). */
  dropAll() {
    for (const s of this.sockets) s.serverClose();
  }

  detach(s: MockSocket) {
    this.sockets.delete(s);
    this.subs.delete(s);
  }

  // ── RPC ──

  receive(s: MockSocket, raw: string) {
    let msg: { id?: number | string; method?: string; params?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return s.deliver({ id: null, error: { code: -32700, message: "parse error" } });
    }
    const { id, method } = msg;
    if (id === undefined || !method) return;
    const spec = ClientRequests[method as ClientMethod];
    if (!spec)
      return s.deliver({ id, error: { code: -32601, message: `unknown method ${method}` } });
    const parsed = spec.params.safeParse(msg.params ?? {});
    if (!parsed.success)
      return s.deliver({ id, error: { code: -32602, message: "invalid params" } });
    const reply = (result: unknown) => this.later(() => s.deliver({ id, result }), 30);
    const fail = (code: number, message: string) =>
      this.later(() => s.deliver({ id, error: { code, message } }), 30);
    const p = parsed.data as Record<string, unknown>;

    switch (method as ClientMethod) {
      case "initialize":
        return reply({
          serverVersion: "mock-0.1",
          protocolVersion: 1,
          catalogVersion: "1",
          userId: ME,
        });
      case "thread/list":
        return reply({ threads: [...this.threads.values()].map((t) => t.thread) });
      case "thread/start": {
        const thread: Thread = {
          id: rid("thread"),
          title: (p.title as string) || "New pact",
          kind: (p.memberIds as string[]).length ? "group" : "solo",
          memberIds: [ME, ...(p.memberIds as string[])],
          createdAt: iso(),
          archived: false,
        };
        this.threads.set(thread.id, {
          thread,
          seq: 0,
          log: [],
          refs: {},
          pendingApprovals: new Map(),
        });
        this.subs.get(s)?.add(thread.id);
        reply({ thread });
        this.emit(thread.id, "thread/started", { thread });
        return;
      }
      case "thread/resume": {
        const t = this.threads.get(p.threadId as string);
        if (!t) return fail(-32602, "unknown thread");
        reply({ thread: t.thread, lastSeq: t.seq });
        const after = p.afterSeq as number;
        // Replay after the response, then go live.
        this.later(() => {
          for (const f of t.log) if ((f.seq ?? 0) > after) s.deliver(f);
          this.subs.get(s)?.add(t.thread.id);
        }, 40);
        return;
      }
      case "thread/archive":
        return reply({});
      case "turn/start": {
        const t = this.threads.get(p.threadId as string);
        if (!t) return fail(-32602, "unknown thread");
        const turnId = rid("turn");
        reply({ turnId });
        this.later(
          () =>
            this.runTurn(
              t,
              turnId,
              p.text as string,
              p.uiState as Record<string, unknown> | undefined,
            ),
          20,
        );
        return;
      }
      case "turn/interrupt":
        return reply({});
      case "approval/respond": {
        const t = this.threads.get(p.threadId as string);
        const pending = t?.pendingApprovals.get(p.approvalId as string);
        if (!t || !pending) return reply({ accepted: false });
        t.pendingApprovals.delete(p.approvalId as string);
        reply({ accepted: true });
        this.later(() => pending.onDecision(p.decision === "approve"), 120);
        return;
      }
    }
  }

  // ── event log ──

  private emit(threadId: string, method: ServerNotificationMethod, params: unknown) {
    const t = this.threads.get(threadId);
    if (!t) return;
    const frame: Frame = { method, seq: ++t.seq, params };
    t.log.push(frame);
    for (const [sock, set] of this.subs) if (set.has(threadId)) sock.deliver(frame);
  }

  private later(fn: () => void, ms: number) {
    const h = setTimeout(() => {
      this.timers.delete(h);
      fn();
    }, ms / this.speed);
    this.timers.add(h);
  }

  private wait(ms: number) {
    return new Promise<void>((r) => this.later(r, ms));
  }

  private base(t: ThreadLog, turnId: string) {
    return { id: rid("item"), threadId: t.thread.id, turnId, createdAt: iso() };
  }

  private startItem(item: Item) {
    this.emit(item.threadId, "item/started", { item });
  }

  private completeItem(item: Item) {
    this.emit(item.threadId, "item/completed", { item });
  }

  private async tool(t: ThreadLog, turnId: string, name: string, summary: string, ms = 700) {
    const item = {
      ...this.base(t, turnId),
      type: "toolCall" as const,
      name,
      summary,
      status: "inProgress" as const,
    };
    this.startItem(item);
    await this.wait(ms);
    this.completeItem({ ...item, status: "completed" });
  }

  /** Streams an agent message like the worker: refs arrive with the completed item. */
  private async say(t: ThreadLog, turnId: string, text: string, refIds: string[] = []) {
    const item = {
      ...this.base(t, turnId),
      type: "agentMessage" as const,
      status: "inProgress" as const,
      text: "",
      refs: {},
      diagnostics: [],
    };
    this.startItem(item);
    let i = 0;
    while (i < text.length) {
      const inFence = text.lastIndexOf("```", i) > text.lastIndexOf("\n\n", i);
      const n = inFence ? 18 + Math.floor(Math.random() * 14) : 3 + Math.floor(Math.random() * 6);
      this.emit(t.thread.id, "item/agentMessage/delta", {
        threadId: t.thread.id,
        itemId: item.id,
        delta: text.slice(i, i + n),
      });
      i += n;
      await this.wait(inFence ? 14 : 22);
    }
    const refs: Refs = {};
    for (const id of refIds) {
      const r = t.refs[id];
      if (r) refs[id] = r;
    }
    this.completeItem({ ...item, status: "completed", text, refs });
  }

  private notice(t: ThreadLog, turnId: string, level: "info" | "warning" | "error", text: string) {
    const item = {
      ...this.base(t, turnId),
      type: "systemNotice" as const,
      status: "completed" as const,
      level,
      text,
    };
    this.startItem(item);
    this.completeItem(item);
  }

  private pactUpdate(
    t: ThreadLog,
    turnId: string,
    pact: Pact,
    from: Pact["state"] | undefined,
    note?: string,
  ) {
    const item = {
      ...this.base(t, turnId),
      type: "pactUpdate" as const,
      status: "completed" as const,
      pactId: pact.id,
      ...(from ? { from } : {}),
      to: pact.state,
      pact,
      ...(note ? { note } : {}),
    };
    this.startItem(item);
    this.completeItem(item);
  }

  private payment(
    t: ThreadLog,
    turnId: string,
    kind: "charged" | "purchased" | "payoutSent",
    amount: Money,
    userId?: string,
    pactId?: string,
  ) {
    const item = {
      ...this.base(t, turnId),
      type: "paymentEvent" as const,
      status: "completed" as const,
      kind,
      amount,
      ...(userId ? { userId } : {}),
      ...(pactId ? { pactId } : {}),
      paypalRef: `${kind === "payoutSent" ? "PAYOUT" : "CAPTURE"}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    };
    this.startItem(item);
    this.completeItem(item);
  }

  private async approval(
    t: ThreadLog,
    turnId: string,
    a: {
      kind: "spend" | "payout" | "pactCommit";
      summary: string;
      amount: Money;
      pactId?: string;
      stepUp: boolean;
    },
  ): Promise<boolean> {
    const approvalId = rid("approval");
    const item = {
      ...this.base(t, turnId),
      type: "approvalRequest" as const,
      status: "inProgress" as const,
      approvalId,
      approverId: ME,
      kind: a.kind,
      summary: a.summary,
      amount: a.amount,
      ...(a.pactId ? { pactId: a.pactId } : {}),
      stepUp: a.stepUp,
      ...(a.stepUp ? { challenge: btoa(rid("chal")) } : {}),
      expiresAt: iso(15 * 60_000),
    };
    this.startItem(item);
    this.emit(t.thread.id, "turn/completed", {
      threadId: t.thread.id,
      turnId,
      status: "awaitingApproval",
    });
    return new Promise((resolve) => {
      t.pendingApprovals.set(approvalId, {
        itemId: item.id,
        turnId,
        onDecision: (approved) => {
          this.completeItem({
            ...item,
            status: "completed",
            decision: approved ? "approved" : "denied",
          });
          resolve(approved);
        },
      });
    });
  }

  private turnStart(t: ThreadLog, turnId: string, authorId = ME) {
    this.emit(t.thread.id, "turn/started", { threadId: t.thread.id, turnId, authorId });
  }

  private turnDone(t: ThreadLog, turnId: string) {
    this.emit(t.thread.id, "turn/completed", {
      threadId: t.thread.id,
      turnId,
      status: "completed",
    });
  }

  // ── scripted turns ──

  private async runTurn(
    t: ThreadLog,
    turnId: string,
    text: string,
    uiState?: Record<string, unknown>,
  ) {
    this.turnStart(t, turnId);
    const user = {
      ...this.base(t, turnId),
      type: "userMessage" as const,
      status: "completed" as const,
      authorId: ME,
      text,
      ...(uiState ? { uiState } : {}),
    };
    this.startItem(user);
    this.completeItem(user);
    await this.wait(350);

    const q = text.toLowerCase();
    const transferRef =
      typeof uiState?.confirmTransfer === "string" ? uiState.confirmTransfer : undefined;
    if (transferRef) return this.confirmTransfer(t, turnId, transferRef);
    const revoke = /revoke mandate (mandate_[a-z0-9]+)/i.exec(text)?.[1];
    if (revoke) return this.revokeTurn(t, turnId, revoke);
    if (/\b(send|pay|venmo)\b/.test(q) && /\$?\d/.test(q)) return this.draftP2P(t, turnId, q);
    if (/(every|weekly|standing|coffee|schedule)/.test(q)) return this.scheduleTurn(t, turnId);
    if (/(activity|history|spent)/.test(q)) return this.activityTurn(t, turnId);
    if (/(digital|disc|pro bundle|go with|that one|first one)/.test(q) || uiState?.split)
      return this.draftPs6(t, turnId, uiState);
    if (/(ps6|playstation|console|find|search|price)/.test(q)) return this.searchPs6(t, turnId);
    return this.fallback(t, turnId);
  }

  private async searchPs6(t: ThreadLog, turnId: string) {
    for (const [id, p] of Object.entries(PRODUCTS)) t.refs[id] = ref("product", p);
    await this.tool(t, turnId, "searchProducts", "Searched sandbox retailers for “PS6”", 900);
    await this.say(
      t,
      turnId,
      [
        "Three PS6 listings from sandbox retailers. The Digital Edition is the best value and it's already on sale.",
        "```openui-lang",
        "root = Stack([cards, compare, ask])",
        'cards = ProductCards(["product_ps6digi", "product_ps6disc", "product_ps6probn"], "PS6 · sandbox retailers")',
        'compare = ProductCompare(["product_ps6digi", "product_ps6disc", "product_ps6probn"], ["Storage", "Disc drive", "Controllers"])',
        'ask = QuestionCard("Which one should the pact buy?", ["Go with the Digital Edition", "The Disc version", "The Pro bundle"], true)',
        "```",
      ].join("\n"),
      Object.keys(PRODUCTS),
    );
    this.turnDone(t, turnId);
  }

  private ps6State: Record<string, Pact["members"][number]["status"]> = {};
  private ps6: Pact = ps6Pact("draft", {});

  private setPs6(t: ThreadLog, pact: Pact, current?: number) {
    this.ps6 = pact;
    t.refs.pact_ps6flat = ref("pact", ps6PactData(pact, current));
  }

  private async draftPs6(t: ThreadLog, turnId: string, uiState?: Record<string, unknown>) {
    t.refs.product_ps6digi = ref("product", PRODUCTS.product_ps6digi);
    await this.tool(
      t,
      turnId,
      "draftPact",
      "Drafted “PS6 Digital for the flat” for 3 members",
      800,
    );
    this.setPs6(t, ps6Pact("draft", {}));
    this.pactUpdate(t, turnId, this.ps6, undefined, "Draft created");
    const intro = uiState?.split
      ? "Updated the split. Everyone still stays under their cap."
      : "Here's the plan. Nothing moves until all three of you commit, and nobody pays more than their cap.";
    await this.say(
      t,
      turnId,
      [
        intro,
        "```openui-lang",
        "root = Stack([plan, card, watch, split])",
        'plan = PlanCard("PS6 group buy", ["Watch the Digital Edition until it drops below the target", "Each member commits up to their cap with PayPal", "When the price triggers, charge each share and place the order", "Post the receipt here"])',
        'card = PactCard("pact_ps6flat")',
        'watch = PriceWatch("pact_ps6flat")',
        'split = SplitBreakdown("pact_ps6flat", true)',
        "```",
      ].join("\n"),
      ["pact_ps6flat", "product_ps6digi"],
    );
    this.setPs6(t, { ...this.ps6, state: "collecting" });
    this.pactUpdate(t, turnId, this.ps6, "draft", "Collecting commitments");
    this.turnDone(t, turnId);
  }

  /** Called by MockApi after the PayPal save-payment approval succeeds. */
  async commit(threadId: string, pactId: string) {
    const t = this.threads.get(threadId);
    if (!t || pactId !== "pact_ps6flat") return;
    const turnId = rid("turn");
    this.turnStart(t, turnId, ME);
    const mandate = mandateFor(pactId);
    const md: MandateData = { mandate, spent: usd(0), label: "PS6 pact · one charge" };
    this.mandates = [md, ...this.mandates.filter((m) => m.mandate.id !== mandate.id)];
    t.refs[mandate.id] = ref("mandate", md);
    this.ps6State = { user_alex: "committed" };
    this.setPs6(t, ps6Pact("collecting", this.ps6State));
    this.pactUpdate(t, turnId, this.ps6, "collecting", "Alex committed");
    await this.say(
      t,
      turnId,
      [
        "You're in. PayPal is saved for this pact only, under this mandate:",
        "```openui-lang",
        "root = Stack([m, c])",
        'm = MandateCard("mandate_alexps6")',
        'c = Callout("info", "Waiting on Sam and Ari to commit.")',
        "```",
      ].join("\n"),
      [mandate.id],
    );
    this.turnDone(t, turnId);

    for (const who of ["user_sam", "user_ari"] as const) {
      await this.wait(1600);
      const tid = rid("turn");
      this.turnStart(t, tid, who);
      this.ps6State = { ...this.ps6State, [who]: "committed" };
      const all = Object.keys(this.ps6State).length === 3;
      this.setPs6(t, ps6Pact(all ? "armed" : "collecting", this.ps6State));
      this.pactUpdate(
        t,
        tid,
        this.ps6,
        all ? "collecting" : "collecting",
        `${nameOf(who).split(" ")[0]} committed`,
      );
      this.turnDone(t, tid);
    }
    await this.wait(600);
    const tid = rid("turn");
    this.turnStart(t, tid);
    await this.say(
      t,
      tid,
      [
        "Everyone's committed. The pact is armed and I'm watching the price.",
        "```openui-lang",
        "root = Stack([w])",
        'w = PriceWatch("pact_ps6flat")',
        "```",
      ].join("\n"),
      ["pact_ps6flat"],
    );
    this.turnDone(t, tid);
    await this.wait(4200);
    await this.priceTrigger(t);
  }

  private async priceTrigger(t: ThreadLog) {
    const turnId = rid("turn");
    this.turnStart(t, turnId);
    const price = 43_900;
    this.setPs6(t, { ...ps6Pact("triggered", this.ps6State) }, price);
    this.notice(
      t,
      turnId,
      "info",
      "Price alert: PS6 Digital Edition dropped below the target at Pact Sandbox Store.",
    );
    this.pactUpdate(t, turnId, this.ps6, "armed", "Price target hit");
    const shares = ps6PactData(this.ps6, price).shares ?? [];
    const mine = shares.find((s) => s.userId === ME)?.share ?? usd(0);
    const approved = await this.approval(t, turnId, {
      kind: "spend",
      summary: "Charge your share of the PS6 Digital Edition",
      amount: mine,
      pactId: this.ps6.id,
      stepUp: true,
    });
    const tid = rid("turn");
    this.turnStart(t, tid);
    if (!approved) {
      this.setPs6(t, { ...ps6Pact("armed", this.ps6State) }, price);
      this.pactUpdate(t, tid, this.ps6, "triggered", "Alex declined; still watching");
      await this.say(
        t,
        tid,
        "No problem, nothing was charged. I'll keep watching and ask again on the next drop.",
      );
      this.turnDone(t, tid);
      return;
    }
    this.setPs6(t, { ...ps6Pact("settling", this.ps6State) }, price);
    this.pactUpdate(t, tid, this.ps6, "triggered", "Charging shares");
    await this.tool(t, tid, "settlePact", "Authorizing 3 shares, then capturing", 1000);
    for (const s of shares) {
      this.payment(t, tid, "charged", s.share, s.userId, this.ps6.id);
      this.activity.unshift({
        id: rid("act"),
        at: iso(),
        title: s.userId === ME ? "PS6 pact · your share" : `${nameOf(s.userId)} · share`,
        subtitle: "Pact Sandbox Store",
        kind: "charged",
        amount: s.share,
        direction: s.userId === ME ? "out" : "none",
      });
      await this.wait(260);
    }
    await this.tool(t, tid, "placeOrder", "Placed the order with Pact Sandbox Store", 700);
    this.payment(t, tid, "purchased", usd(price), undefined, this.ps6.id);
    const done = ps6Pact("done", {
      user_alex: "charged",
      user_sam: "charged",
      user_ari: "charged",
    });
    this.setPs6(t, done, price);
    this.pactUpdate(t, tid, done, "settling", "Order placed");
    t.refs.activity_ps6flat = ref("activity", { entries: this.activity.slice(0, 4) });
    this.mandates = this.mandates.map((m) =>
      m.mandate.id === "mandate_alexps6"
        ? { ...m, spent: mine, mandate: { ...m.mandate, status: "exhausted" } }
        : m,
    );
    await this.say(
      t,
      tid,
      [
        "Done. Everyone paid their share and the PS6 is ordered.",
        "```openui-lang",
        "root = Stack([ok, card, act])",
        'ok = Callout("success", "Order placed. Each share stayed within its mandate.")',
        'card = PactCard("pact_ps6flat")',
        'act = ActivityList("activity_ps6flat")',
        "```",
      ].join("\n"),
      ["pact_ps6flat", "activity_ps6flat"],
    );
    this.turnDone(t, tid);
  }

  private async draftP2P(t: ThreadLog, turnId: string, q: string) {
    const to = /\bsam\b/.test(q) ? "user_sam" : /\bjo\b/.test(q) ? "user_jo" : "user_ari";
    const m = /\$?\s?(\d{1,5})(?:\.(\d{1,2}))?/.exec(q);
    const amountMinor = m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0) : 2_000;
    const note = /for (.+)$/.exec(q)?.[1]?.slice(0, 60) ?? "";
    await this.tool(t, turnId, "draftTransfer", `Drafted a send to ${nameOf(to)}`, 600);
    const id = rid("transfer").replace(/[^a-z0-9_]/gi, "");
    t.refs[id] = ref(
      "transfer",
      transferDraft(to, amountMinor, note ? note[0]!.toUpperCase() + note.slice(1) : ""),
    );
    await this.say(
      t,
      turnId,
      [
        `Drafted it. Check the details and confirm in the card; nothing moves until you approve.`,
        "```openui-lang",
        "root = Stack([tf])",
        `tf = TransferFundsCard("${id}")`,
        "```",
      ].join("\n"),
      [id],
    );
    this.turnDone(t, turnId);
  }

  private async confirmTransfer(t: ThreadLog, turnId: string, transferRef: string) {
    const r = t.refs[transferRef];
    if (!r) return this.fallback(t, turnId);
    const d = r.data as TransferData;
    const approved = await this.approval(t, turnId, {
      kind: "payout",
      summary: `Send to ${d.counterpartyName ?? d.counterpartyEmail}${d.note ? ` · ${d.note}` : ""}`,
      amount: d.amount,
      stepUp: d.amount.amountMinor >= 10_000,
    });
    const tid = rid("turn");
    this.turnStart(t, tid);
    if (!approved) {
      t.refs[transferRef] = ref("transfer", { ...d, status: "cancelled" });
      await this.say(t, tid, "Cancelled. Nothing was sent.");
      this.turnDone(t, tid);
      return;
    }
    await this.tool(t, tid, "sendPayout", "Charged your PayPal, then paid out", 900);
    this.payment(t, tid, "charged", d.amount, ME);
    this.payment(t, tid, "payoutSent", d.amount, d.counterpartyUserId);
    const sent: TransferData = { ...d, status: "sent" };
    t.refs[transferRef] = ref("transfer", sent);
    this.activity.unshift({
      id: rid("act"),
      at: iso(),
      title: d.counterpartyName ?? "Transfer",
      subtitle: d.note || "Sent with Pact",
      kind: "payoutSent",
      amount: d.amount,
      direction: "out",
    });
    await this.say(
      t,
      tid,
      [
        "Sent.",
        "```openui-lang",
        "root = Stack([tf])",
        `tf = TransferFundsCard("${transferRef}")`,
        "```",
      ].join("\n"),
      [transferRef],
    );
    this.turnDone(t, tid);
  }

  private async scheduleTurn(t: ThreadLog, turnId: string) {
    t.refs.pact_coffeefd = ref("pact", coffeePactData());
    t.refs.mandate_alexcoffee = ref("mandate", COFFEE_MANDATE);
    await this.tool(t, turnId, "getPact", "Read “Office coffee beans”", 500);
    await this.say(
      t,
      turnId,
      [
        "Your coffee standing order runs every two weeks. Here's what's coming up and the mandate it runs under.",
        "```openui-lang",
        "root = Stack([s, m])",
        's = ScheduleCard("pact_coffeefd")',
        'm = MandateCard("mandate_alexcoffee")',
        "```",
      ].join("\n"),
      ["pact_coffeefd", "mandate_alexcoffee"],
    );
    this.turnDone(t, turnId);
  }

  private async activityTurn(t: ThreadLog, turnId: string) {
    t.refs.activity_alexall = ref("activity", { entries: this.activity });
    await this.say(
      t,
      turnId,
      [
        "Here's your recent activity.",
        "```openui-lang",
        "root = Stack([a])",
        'a = ActivityList("activity_alexall")',
        "```",
      ].join("\n"),
      ["activity_alexall"],
    );
    this.turnDone(t, turnId);
  }

  private async revokeTurn(t: ThreadLog, turnId: string, mandateId: string) {
    const md = this.mandates.find((m) => m.mandate.id === mandateId);
    if (!md) return this.fallback(t, turnId);
    await this.tool(
      t,
      turnId,
      "revokeMandate",
      "Revoked the mandate and deleted its vault token",
      500,
    );
    const revoked: MandateData = { ...md, mandate: { ...md.mandate, status: "revoked" } };
    this.mandates = this.mandates.map((m) => (m.mandate.id === mandateId ? revoked : m));
    t.refs[mandateId] = ref("mandate", revoked);
    await this.say(
      t,
      turnId,
      [
        "Revoked. Pact can no longer charge under it.",
        "```openui-lang",
        "root = Stack([m])",
        `m = MandateCard("${mandateId}")`,
        "```",
      ].join("\n"),
      [mandateId],
    );
    this.turnDone(t, turnId);
  }

  private async fallback(t: ThreadLog, turnId: string) {
    await this.say(
      t,
      turnId,
      [
        "I run shared money agreements for the group: price-watch purchases, standing orders, split pay and sending money. What should we set up?",
        "```openui-lang",
        "root = Stack([q])",
        'q = QuestionCard("Try one of these", ["Find a PS6 and split it three ways", "Send Ari $20 for snacks", "Show the coffee standing order", "Show my activity"], true)',
        "```",
      ].join("\n"),
    );
    this.turnDone(t, turnId);
  }

  // ── seeds ──

  private seedCoffee() {
    const t = this.threads.get("thread_coffee")!;
    const turnId = "turn_seedcoffee";
    t.refs.pact_coffeefd = ref("pact", coffeePactData());
    t.refs.mandate_alexcoffee = ref("mandate", COFFEE_MANDATE);
    const at = iso(-2 * 86_400_000);
    const b = (id: string) => ({ id, threadId: t.thread.id, turnId, createdAt: at });
    this.emit(t.thread.id, "item/completed", {
      item: {
        ...b("item_seedc1"),
        type: "userMessage",
        status: "completed",
        authorId: "user_jo",
        text: "Can we automate the coffee run? $25 each every two weeks.",
      },
    });
    this.emit(t.thread.id, "item/completed", {
      item: {
        ...b("item_seedc2"),
        type: "agentMessage",
        status: "completed",
        text: [
          "Set up. It charges each member's share every 14 days under their own mandate.",
          "```openui-lang",
          "root = Stack([card, sched])",
          'card = PactCard("pact_coffeefd")',
          'sched = ScheduleCard("pact_coffeefd")',
          "```",
        ].join("\n"),
        refs: { pact_coffeefd: t.refs.pact_coffeefd },
        diagnostics: [],
      },
    });
    this.emit(t.thread.id, "item/completed", {
      item: {
        ...b("item_seedc3"),
        type: "paymentEvent",
        status: "completed",
        kind: "charged",
        userId: ME,
        pactId: "pact_coffeefd",
        amount: usd(2_500),
        paypalRef: "CAPTURE-7Q2K9F1M",
      },
    });
  }

  private seedPs6() {
    const t = this.threads.get("thread_ps6flat")!;
    this.emit(t.thread.id, "item/completed", {
      item: {
        id: "item_seedp1",
        threadId: t.thread.id,
        turnId: "turn_seedps6",
        createdAt: iso(-3_600_000),
        type: "systemNotice",
        status: "completed",
        level: "info",
        text: `${USERS.user_sam!.name} and ${USERS.user_ari!.name} joined. Pact can buy, split and pay for the group; every charge needs a mandate or your approval.`,
      },
    });
  }
}

const OPEN = 1;
const CLOSED = 3;

export class MockSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(private server: MockServer) {}

  open() {
    if (this.readyState !== 0) return;
    this.readyState = OPEN;
    this.onopen?.(new Event("open"));
  }

  send(data: string) {
    if (this.readyState !== OPEN) throw new Error("socket not open");
    this.server.receive(this, data);
  }

  deliver(frame: unknown) {
    if (this.readyState !== OPEN) return;
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }

  close() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.server.detach(this);
    this.onclose?.(new CloseEvent("close", { code: 1000 }));
  }

  serverClose() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.server.detach(this);
    this.onclose?.(new CloseEvent("close", { code: 1006 }));
  }
}
