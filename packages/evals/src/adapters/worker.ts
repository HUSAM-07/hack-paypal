/**
 * Worker adapter: the real worker agent (system prompt, tool schemas and
 * implementations, step loop with in-turn UI retry, catalog validation, Anthropic
 * provider) hosted in memory instead of a ThreadDO.
 *
 * Only the edges are fake, the same edges ThreadDO owns: storage is a Map, products
 * come from the scenario world, the clock is `world.now`, and spends settle against
 * `world.mandates`/`world.ledger` with the real `authorize()` (charges are simulated,
 * as in ThreadDO before PayPal). Tool args are recorded in the reference tools' shape
 * so scenario arg matchers and the policy replay grade both agents the same way.
 */
import { authorize } from "@pact/policy";
import type { Item, Money, Pact, SpendIntent } from "@pact/protocol";
import {
  analyzeAgentText,
  anthropicProvider,
  type ChatMessage,
  contextBlock,
  type FoundProduct,
  knownAmounts,
  type ModelProvider,
  memberMessage,
  type PactRefData,
  type Product,
  pactRefData,
  parseUiNodes,
  runAgentLoop,
  runTool,
  type StoredRef,
  signatureOf,
  spendResult,
  systemPrompt,
  TOOL_DEFS,
  type ToolCall,
  type ToolContext,
  ToolError,
  type ToolResult,
} from "@pact/worker/agent";
import type {
  AgentUnderTest,
  ThreadState,
  ToolCallRecord,
  TurnInput,
  TurnResult,
} from "../adapter";
import { findPerson, nextId, type World, type WorldProduct } from "../world";

export interface WorkerAdapterOptions {
  apiKey?: string;
  model?: string;
  /** Overrides the Anthropic provider (tests use a scripted one). */
  provider?: ModelProvider;
  maxSteps?: number;
  /** Overrides the worker's system prompt, for prompt experiments. */
  system?: string;
  /** Mirrors the worker's STEP_UP_ABOVE_MINOR default. */
  stepUpAboveMinor?: number;
}

interface Session {
  messages: ChatMessage[];
  refs: Map<string, StoredRef>;
  pendingApproval?: { approvalId: string; intent: SpendIntent } | undefined;
}

const REF = /^[a-z]+_[A-Za-z0-9]{4,40}$/;

export function workerAdapter(opts: WorkerAdapterOptions): AgentUnderTest {
  const modelId = opts.model ?? "claude-sonnet-5-5";
  const provider =
    opts.provider ??
    (() => {
      if (!opts.apiKey) throw new Error("workerAdapter needs apiKey or provider");
      return anthropicProvider(opts.apiKey, modelId);
    })();
  const system = opts.system ?? systemPrompt();
  const sessions = new WeakMap<World, Session>();

  return {
    name: `worker:${opts.provider ? provider.name : modelId}`,
    parseUi: parseUiNodes,
    async runTurn(input: TurnInput): Promise<TurnResult> {
      const { threadState, userId, text, uiState } = input;
      const { world } = threadState;
      let session = sessions.get(world);
      if (!session) {
        session = seed(threadState);
        sessions.set(world, session);
      }
      const s = session;

      // Like ThreadDO.supersedePendingApprovals: a new turn expires a hanging approval.
      if (s.pendingApproval) {
        s.messages.push({
          role: "user",
          content: `<approval_result approval_id="${s.pendingApproval.approvalId}">${JSON.stringify({ description: s.pendingApproval.intent.description, status: "expired", reason: "superseded by a new message" })}</approval_result>`,
        });
        s.pendingApproval = undefined;
      }
      s.messages.push({
        role: "user",
        content: `${turnContext(world, s, userId)}\n${memberMessage(member(world, userId), userId, text, uiState)}`,
      });

      const turnId = `turn_${threadState.items.length}`;
      let n = 0;
      const base = () => ({
        id: `${turnId}_item${n++}`,
        threadId: threadState.thread.id,
        turnId,
        status: "completed" as const,
        createdAt: world.now,
      });
      const items: Item[] = [];
      const calls: ToolCallRecord[] = [];
      const ctx = toolContext(threadState, s, userId, turnId);
      let messageItem: ReturnType<typeof base> | undefined;

      const executeTool = async (
        call: ToolCall,
        alreadyPaused: boolean,
      ): Promise<{ result: ToolResult; paused?: boolean }> => {
        const done = (output: unknown, isError = false) => {
          items.push({
            ...base(),
            status: isError ? "failed" : "completed",
            type: "toolCall",
            name: call.name,
            summary: call.name,
            args: call.input,
            ...(isError
              ? { error: String((output as { error: unknown }).error) }
              : { result: output }),
          });
          calls.push({
            name: call.name,
            args: isError ? call.input : canonicalArgs(call, output, s),
            result: output,
          });
          return { callId: call.id, name: call.name, output, ...(isError ? { isError } : {}) };
        };
        try {
          if (alreadyPaused && call.name === "requestSpend") {
            throw new ToolError(
              "only one spend can await approval at a time; ask again after it is answered",
            );
          }
          const outcome = await runTool(call.name, call.input, ctx);
          if (outcome.kind === "result") return { result: done(outcome.output) };

          const { intent, decision } = outcome;
          if (decision.outcome === "allow") {
            world.ledger.push({
              mandateId: decision.mandateId,
              amountMinor: intent.amount.amountMinor,
              currency: intent.amount.currency,
              at: world.now,
            });
            world.spends.push({ intent, status: "executed" });
            const paymentRef = `SIMULATED-${intent.id}`;
            const result = done(
              spendResult(intent, decision, "executed", {
                authorizedBy: "mandate",
                paymentRef,
                simulated: true,
              }),
            );
            items.push({
              ...base(),
              type: "paymentEvent",
              kind: "charged",
              userId: intent.userId,
              amount: intent.amount,
              paypalRef: paymentRef,
              ...(intent.pactId ? { pactId: intent.pactId } : {}),
            });
            return { result };
          }
          if (decision.outcome === "deny") {
            world.spends.push({ intent, status: "denied" });
            items.push({
              ...base(),
              type: "systemNotice",
              level: "warning",
              text: `Spend blocked by policy: ${decision.reasons.join(", ")}`,
            });
            return { result: done(spendResult(intent, decision, "denied")) };
          }
          const approvalId = nextId(world, "approval");
          world.spends.push({ intent, status: "awaiting_approval", approvalId });
          s.pendingApproval = { approvalId, intent };
          const result = done(spendResult(intent, decision, "awaiting_approval", { approvalId }));
          const threshold = opts.stepUpAboveMinor ?? 20_000;
          items.push({
            ...base(),
            status: "inProgress",
            type: "approvalRequest",
            approvalId,
            approverId: intent.userId,
            kind: "spend",
            summary: intent.description.slice(0, 300),
            amount: intent.amount,
            ...(intent.pactId ? { pactId: intent.pactId } : {}),
            stepUp:
              decision.reasons.includes("step_up_required") ||
              intent.amount.amountMinor >= threshold,
            expiresAt: new Date(Date.parse(world.now) + 15 * 60_000).toISOString(),
          });
          return { result, paused: true };
        } catch (err) {
          const message =
            err instanceof ToolError
              ? err.message
              : err instanceof Error && err.name === "ZodError"
                ? err.message.slice(0, 1000)
                : "tool failed";
          return { result: done({ error: message }, true) };
        }
      };

      await runAgentLoop(
        {
          provider,
          system,
          tools: TOOL_DEFS,
          maxSteps: opts.maxSteps ?? 8,
          messages: () => s.messages,
          append: (m) => s.messages.push(m),
          startMessage: () => {
            messageItem = base();
          },
          delta: () => {},
          analyze: (msg) => analyzeAgentText(msg, s.refs, knownAmounts(s.messages)),
          finishMessage: (msg, analysis, status, rejected) => {
            const at = messageItem ?? base();
            messageItem = undefined;
            const refs: Record<string, unknown> = {};
            for (const id of analysis.usedRefs) refs[id] = s.refs.get(id);
            items.push(
              rejected
                ? {
                    ...at,
                    status: "failed",
                    type: "agentMessage",
                    text: "",
                    refs: {},
                    diagnostics: analysis.diagnostics,
                  }
                : {
                    ...at,
                    status,
                    type: "agentMessage",
                    text: msg,
                    refs,
                    diagnostics: analysis.diagnostics,
                    ...(analysis.fallbackMarkdown
                      ? { fallbackMarkdown: analysis.fallbackMarkdown }
                      : {}),
                  },
            );
          },
          executeTool,
        },
        new AbortController().signal,
      );
      return { items, toolCalls: calls };
    },
  };
}

function toolContext(state: ThreadState, s: Session, userId: string, turnId: string): ToolContext {
  const { world } = state;
  const put = (id: string, data: unknown) =>
    s.refs.set(id, { kind: id.slice(0, id.indexOf("_")), data });
  return {
    threadId: state.thread.id,
    turnId,
    userId,
    members: world.members.map(({ userId: id, displayName }) => ({ userId: id, displayName })),
    contacts: world.contacts,
    timeZone: world.timezone,
    now: () => new Date(world.now),
    newId: (prefix) => nextId(world, prefix),
    async searchProducts(q) {
      const words = q.query.toLowerCase().split(/\W+/).filter(Boolean);
      const hits = world.products.filter((p) => {
        const hay = [p.title, p.category ?? "", ...p.tags].join(" ").toLowerCase();
        return (
          words.some((w) => w.length > 1 && hay.includes(w)) &&
          p.price.currency === q.currency &&
          (q.maxPriceMinor === undefined || p.price.amountMinor <= q.maxPriceMinor)
        );
      });
      const products: FoundProduct[] = hits
        .slice(0, q.limit)
        .map((p) => ({ ...product(p), ref: p.ref }));
      return { source: "fixture", products };
    },
    putRef: (prefix, data) => {
      const id = nextId(world, prefix);
      put(id, data);
      return id;
    },
    putRefWithId: put,
    getRef: (id) => s.refs.get(id),
    loadPolicyState: async (uid) => ({
      mandates: world.mandates.filter((m) => m.userId === uid),
      ledger: world.ledger,
    }),
    authorize: (intent, mandates, ledger) =>
      authorize(intent, mandates, ledger, new Date(world.now)),
  };
}

function product(p: WorldProduct): Product {
  return {
    title: p.title,
    brand: "",
    price: p.price,
    merchant: p.merchant,
    category: p.category ?? "general",
    url: `https://example.com/${p.ref}`,
    features: p.tags,
    ...(p.description ? { description: p.description } : {}),
    source: "fixture",
  };
}

function pactData(world: World, pact: Pact): PactRefData {
  const a = pact.action;
  const p = a.kind === "purchase" ? world.products.find((x) => x.ref === a.productRef) : undefined;
  let total: Money;
  if (a.kind === "purchase") {
    // Budgeted like the worker's draftPact: price watches at the trigger price.
    const unit =
      pact.trigger.kind === "price"
        ? pact.trigger.maxPrice.amountMinor
        : (p?.price.amountMinor ?? 0);
    total = { amountMinor: unit * a.quantity, currency: p?.price.currency ?? "USD" };
  } else total = a.kind === "collect" ? a.total : a.amount;
  return pactRefData(pact, total, {
    now: new Date(world.now),
    ...(p ? { product: product(p) } : {}),
  });
}

/**
 * What ThreadDO would hold after the seeded history: the thread's pacts, plus every
 * product, pact and transfer a history tool call returned (refs exist only once a
 * tool produced them, as in production).
 */
function seed(state: ThreadState): Session {
  const { world } = state;
  const s: Session = { messages: [], refs: new Map() };
  const resolve = (id: string): StoredRef | undefined => {
    const p = world.products.find((x) => x.ref === id);
    if (p) return { kind: "product", data: product(p) };
    const pact = world.draftPacts[id] ?? world.pacts.find((x) => x.id === id);
    if (pact) return { kind: "pact", data: pactData(world, pact) };
    const t = world.transfers[id];
    if (t) {
      return {
        kind: "transfer",
        data: {
          direction: t.direction,
          fromUserId: t.fromUserId,
          counterpartyUserId: t.counterparty.userId,
          counterpartyEmail: t.counterparty.email,
          amount: t.amount,
          note: t.note ?? "",
          status: "draft",
          createdAt: world.now,
        },
      };
    }
    return undefined;
  };
  const add = (id: string) => {
    const ref = s.refs.has(id) ? undefined : resolve(id);
    if (ref) s.refs.set(id, ref);
  };
  for (const pact of world.pacts) {
    add(pact.id);
    if (pact.action.kind === "purchase") add(pact.action.productRef);
  }

  const push = (m: ChatMessage) => {
    const last = s.messages.at(-1);
    if (last?.role === "user" && m.role === "user") last.content += `\n${m.content}`;
    else s.messages.push(m);
  };
  for (const item of state.items) {
    if (item.type === "userMessage") {
      push({
        role: "user",
        content: `${turnContext(world, s, item.authorId)}\n${memberMessage(member(world, item.authorId), item.authorId, item.text, item.uiState)}`,
      });
    } else if (item.type === "toolCall") {
      for (const id of idsIn(item.result)) add(id);
      push({
        role: "assistant",
        text: "",
        toolCalls: [{ id: item.id, name: item.name, input: item.args ?? {} }],
      });
      push({
        role: "tool",
        results: [{ callId: item.id, name: item.name, output: item.result ?? null }],
      });
    } else if (item.type === "agentMessage") {
      push({ role: "assistant", text: jsonUiToOpenUi(item.text) || "(no reply)", toolCalls: [] });
    }
  }
  return s;
}

function turnContext(world: World, s: Session, speakerId: string): string {
  const pacts = [...s.refs.values()]
    .filter((r) => r.kind === "pact")
    .map((r) => (r.data as PactRefData).pact);
  return contextBlock({
    now: new Date(world.now),
    timeZone: world.timezone,
    members: world.members,
    contacts: world.contacts,
    pacts,
    speakerId,
  });
}

function member(world: World, userId: string) {
  return findPerson(world, userId);
}

function idsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && REF.test(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) idsIn(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) idsIn(v, out);
  return out;
}

/**
 * The worker's tool input mapped to the reference tools' arg shape, which the
 * scenario matchers and the policy replay are written against. Pacts use the
 * server-resolved draft, so defaults and caps the server filled in are what's graded.
 */
function canonicalArgs(call: ToolCall, result: unknown, s: Session): unknown {
  const a = (call.input ?? {}) as Record<string, unknown>;
  const money = (amountMinor: unknown) => ({ amountMinor, currency: a.currency ?? "USD" });
  switch (call.name) {
    case "searchProducts":
      return {
        query: a.query,
        ...(a.maxPriceMinor !== undefined ? { maxPrice: money(a.maxPriceMinor) } : {}),
      };
    case "draftPact": {
      const ref = (result as { pactRef?: string }).pactRef;
      const pact = ref ? (s.refs.get(ref)?.data as PactRefData | undefined)?.pact : undefined;
      if (!pact) return a;
      return {
        title: pact.title,
        instruction: pact.instruction,
        members: pact.members.map((m) => ({ userId: m.userId, cap: m.cap })),
        trigger: pact.trigger,
        action: pact.action,
        split: pact.split,
      };
    }
    case "draftTransfer":
      return {
        direction: a.direction,
        counterparty: a.counterpartyUserId
          ? { userId: a.counterpartyUserId }
          : { email: a.counterpartyEmail },
        amount: money(a.amountMinor),
        ...(a.note ? { note: a.note } : {}),
      };
    case "requestSpend": {
      const target = String(a.targetRef);
      const ref = s.refs.get(target);
      const reason = "agent spend";
      if (ref?.kind === "pact") {
        const { pact } = ref.data as PactRefData;
        return pact.action.kind === "purchase"
          ? {
              productRef: pact.action.productRef,
              quantity: pact.action.quantity,
              pactRef: target,
              reason,
            }
          : { pactRef: target, reason };
      }
      if (ref?.kind === "product") return { productRef: target, quantity: a.quantity ?? 1, reason };
      return { transferRef: target, reason };
    }
    default:
      return a;
  }
}

const UI_FENCE = /```ui\s*\n([\s\S]*?)```/g;

/**
 * Seeded history is written in the reference adapter's JSON `ui` format; the worker
 * agent must see its own OpenUI Lang, or it may imitate the wrong format.
 */
export function jsonUiToOpenUi(text: string): string {
  return text.replace(UI_FENCE, (_, json: string) => {
    let root: unknown;
    try {
      root = JSON.parse(json);
    } catch {
      return "";
    }
    const lines: string[] = [];
    let n = 0;
    const value = (v: unknown): string => {
      if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`;
      if (
        v &&
        typeof v === "object" &&
        typeof (v as { component?: unknown }).component === "string"
      ) {
        // Children land before parents; OpenUI Lang hoists references.
        const name = `n${++n}`;
        lines.push(
          `${name} = ${call(v as { component: string; props?: Record<string, unknown> })}`,
        );
        return name;
      }
      return v === undefined ? "null" : JSON.stringify(v);
    };
    const call = (node: { component: string; props?: Record<string, unknown> }) => {
      const props = node.props ?? {};
      const args = (signatureOf(node.component) ?? Object.keys(props)).map((k) => props[k]);
      while (args.length && args.at(-1) === undefined) args.pop();
      return `${node.component}(${args.map(value).join(", ")})`;
    };
    const rootExpr = call(root as { component: string; props?: Record<string, unknown> });
    return `\`\`\`openui-lang\nroot = ${rootExpr}\n${lines.join("\n")}\n\`\`\``;
  });
}
