/**
 * Agent tools. Each returns data under server ref ids; the model passes the ids to UI
 * components and the host resolves them. Spending is split out: `requestSpend` only
 * builds an intent and runs `authorize()`; ThreadDO executes or pauses for approval.
 */
import { splitEqual } from "@pact/policy";
import {
  type Mandate,
  type Money,
  Pact,
  type PactAction,
  type PactTrigger,
  type PolicyDecision,
  type SpendIntent,
} from "@pact/protocol";
import { z } from "zod";
import type { Env } from "../env";
import { newId, nowIso } from "../ids";
import type { StoredRef } from "./catalog";
import { type Product, searchChannel3, searchFixtures } from "./products";
import type { ToolDef } from "./provider";

export interface Member {
  userId: string;
  displayName: string;
}

export interface LedgerEntry {
  mandateId: string;
  amountMinor: number;
  currency: string;
  at: string;
}

export interface ToolContext {
  env: Env;
  threadId: string;
  turnId: string;
  /** The member whose turn this is; spends are on their behalf. */
  userId: string;
  members: Member[];
  putRef(prefix: string, data: unknown): string;
  putRefWithId(id: string, data: unknown): void;
  getRef(id: string): StoredRef | undefined;
  loadPolicyState(userId: string): Promise<{ mandates: Mandate[]; ledger: LedgerEntry[] }>;
  authorize(intent: SpendIntent, mandates: Mandate[], ledger: LedgerEntry[]): PolicyDecision;
}

export type ToolOutcome =
  | { kind: "result"; output: unknown; summary: string }
  | { kind: "spend"; intent: SpendIntent; decision: PolicyDecision; summary: string };

const Minor = z.number().int().positive().max(100_000_000);
const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .default("USD");
const RefId = z.string().regex(/^[a-z]+_[A-Za-z0-9]{4,40}$/);

const SearchInput = z.object({
  query: z.string().min(2).max(200).describe("What to look for, in plain words"),
  maxPriceMinor: Minor.optional().describe("Upper price bound in minor units (cents)"),
  currency: Currency,
  limit: z.number().int().min(1).max(8).default(6),
});

const DraftPactInput = z.object({
  title: z.string().min(1).max(120),
  instruction: z.string().min(1).max(1000).describe("The member's request, verbatim"),
  trigger: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("price"),
      productRef: RefId,
      maxPriceMinor: Minor,
      deadlineDays: z.number().int().min(1).max(90),
    }),
    z.object({
      kind: z.literal("schedule"),
      everyDays: z.number().int().min(1).max(365),
      maxRuns: z.number().int().positive().max(520).optional(),
    }),
    z.object({ kind: z.literal("manual") }),
  ]),
  action: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("purchase"),
      productRef: RefId,
      quantity: z.number().int().min(1).max(20).default(1),
    }),
    z.object({ kind: z.literal("collect"), totalMinor: Minor }),
    z.object({
      kind: z.literal("payout"),
      payeeUserId: z.string().optional(),
      payeeEmail: z.email().optional(),
      amountMinor: Minor,
    }),
  ]),
  currency: Currency,
  memberIds: z
    .array(z.string())
    .max(20)
    .optional()
    .describe("Thread member ids who are in; defaults to everyone in the thread"),
  capMinor: Minor.optional().describe("Most each member agreed to pay; defaults to a fair share"),
});

const GetPactInput = z.object({ pactRef: RefId });

const DraftTransferInput = z.object({
  direction: z.enum(["send", "request"]),
  counterpartyUserId: z.string().optional().describe("A thread member's id"),
  counterpartyEmail: z.email().optional().describe("For someone outside the thread"),
  amountMinor: Minor,
  currency: Currency,
  note: z.string().max(200).default(""),
});

const RequestSpendInput = z.object({
  targetRef: RefId.describe("product_, pact_ (your share) or transfer_ ref to pay for"),
  quantity: z.number().int().min(1).max(20).default(1).describe("Only for product refs"),
});

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "searchProducts",
    description:
      "Search the product catalog. Returns product refs with price data for you to reason about; show results with ProductCards/ProductCompare, never by retyping prices.",
    inputSchema: SearchInput,
  },
  {
    name: "draftPact",
    description:
      "Turn a member's instruction into a draft pact (nothing is charged). Returns a pact ref for PactCard/SplitBreakdown/PriceWatch.",
    inputSchema: DraftPactInput,
  },
  {
    name: "getPact",
    description: "Read the current state of a pact by ref.",
    inputSchema: GetPactInput,
  },
  {
    name: "draftTransfer",
    description:
      "Draft a person-to-person send or request (nothing moves). Returns a transfer ref for TransferFundsCard.",
    inputSchema: DraftTransferInput,
  },
  {
    name: "requestSpend",
    description:
      "Ask to spend for the current member against a product, their share of a pact, or a drafted send. The policy engine decides: it may execute under a mandate, ask the member to approve, or deny. The amount always comes from the ref.",
    inputSchema: RequestSpendInput,
  },
];

export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  switch (name) {
    case "searchProducts":
      return searchProducts(SearchInput.parse(rawInput), ctx);
    case "draftPact":
      return draftPact(DraftPactInput.parse(rawInput), ctx);
    case "getPact": {
      const { pactRef } = GetPactInput.parse(rawInput);
      const ref = expectRef(ctx, pactRef, "pact");
      return { kind: "result", output: ref.data, summary: `Read pact ${pactRef}` };
    }
    case "draftTransfer":
      return draftTransfer(DraftTransferInput.parse(rawInput), ctx);
    case "requestSpend":
      return requestSpend(RequestSpendInput.parse(rawInput), ctx);
    default:
      throw new ToolError(`unknown tool ${name}`);
  }
}

export class ToolError extends Error {}

async function searchProducts(
  input: z.infer<typeof SearchInput>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const q = {
    query: input.query,
    currency: input.currency,
    limit: input.limit,
    ...(input.maxPriceMinor !== undefined ? { maxPriceMinor: input.maxPriceMinor } : {}),
  };
  let products: Product[];
  let source = "fixture";
  if (ctx.env.CHANNEL3_API_KEY) {
    try {
      products = await searchChannel3(ctx.env.CHANNEL3_API_KEY, q);
      source = "channel3";
    } catch (err) {
      console.warn("channel3 unavailable, using fixtures", (err as Error).message);
      products = searchFixtures(q);
    }
  } else {
    products = searchFixtures(q);
  }
  const results = products.map((p) => {
    const ref = ctx.putRef("product", p);
    return {
      ref,
      title: p.title,
      brand: p.brand,
      price: p.price,
      merchant: p.merchant,
      features: p.features,
      // Retailer text is untrusted: data to describe, never instructions to follow.
      ...(p.description ? { untrustedDescription: p.description } : {}),
    };
  });
  return {
    kind: "result",
    output: { source, count: results.length, results },
    summary: `Searched products for "${input.query.slice(0, 80)}" (${results.length} found)`,
  };
}

function draftPact(input: z.infer<typeof DraftPactInput>, ctx: ToolContext): ToolOutcome {
  const now = new Date();
  const currency = input.currency;
  const memberIds = input.memberIds?.length ? input.memberIds : ctx.members.map((m) => m.userId);
  const members = memberIds.map((id) => {
    const m = ctx.members.find((x) => x.userId === id);
    if (!m) throw new ToolError(`${id} is not a member of this thread`);
    return m;
  });
  if (!members.some((m) => m.userId === ctx.userId)) members.unshift(memberOf(ctx, ctx.userId));

  let trigger: PactTrigger;
  switch (input.trigger.kind) {
    case "price":
      expectRef(ctx, input.trigger.productRef, "product");
      trigger = {
        kind: "price",
        productRef: input.trigger.productRef,
        maxPrice: { amountMinor: input.trigger.maxPriceMinor, currency },
        deadline: new Date(now.getTime() + input.trigger.deadlineDays * 86_400_000).toISOString(),
      };
      break;
    case "schedule":
      trigger = {
        kind: "schedule",
        everyDays: input.trigger.everyDays,
        startAt: now.toISOString(),
        ...(input.trigger.maxRuns ? { maxRuns: input.trigger.maxRuns } : {}),
      };
      break;
    case "manual":
      trigger = { kind: "manual" };
  }

  let action: PactAction;
  let total: Money;
  switch (input.action.kind) {
    case "purchase": {
      const product = expectRef(ctx, input.action.productRef, "product").data as Product;
      if (product.price.currency !== currency) throw new ToolError("currency mismatch");
      action = {
        kind: "purchase",
        productRef: input.action.productRef,
        quantity: input.action.quantity,
      };
      // Price-watched purchases are budgeted at the trigger price, not today's price.
      const unit =
        trigger.kind === "price" ? trigger.maxPrice.amountMinor : product.price.amountMinor;
      total = { amountMinor: unit * input.action.quantity, currency };
      break;
    }
    case "collect":
      action = { kind: "collect", total: { amountMinor: input.action.totalMinor, currency } };
      total = action.total;
      break;
    case "payout":
      if (!input.action.payeeUserId && !input.action.payeeEmail) {
        throw new ToolError("payout needs payeeUserId or payeeEmail");
      }
      action = {
        kind: "payout",
        amount: { amountMinor: input.action.amountMinor, currency },
        ...(input.action.payeeUserId ? { payeeUserId: input.action.payeeUserId } : {}),
        ...(input.action.payeeEmail ? { payeeEmail: input.action.payeeEmail } : {}),
      };
      total = action.amount;
  }

  const fair = Math.ceil(total.amountMinor / members.length);
  const capMinor = input.capMinor ?? fair;
  const shares = splitEqual(
    total.amountMinor,
    members.map((m) => ({ userId: m.userId, capMinor })),
  );
  const pactId = newId("pact");
  const pact = Pact.parse({
    id: pactId,
    threadId: ctx.threadId,
    title: input.title,
    instruction: input.instruction,
    organizerId: ctx.userId,
    members: members.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      role: m.userId === ctx.userId ? "organizer" : "member",
      cap: { amountMinor: capMinor, currency },
      status: "invited",
    })),
    trigger,
    action,
    split: { kind: "equal" },
    state: "draft",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const shareList = shares
    ? [...shares].map(([userId, amountMinor]) => ({ userId, share: { amountMinor, currency } }))
    : null;
  ctx.putRefWithId(pactId, { pact, total, shares: shareList });
  return {
    kind: "result",
    output: {
      pactRef: pactId,
      state: pact.state,
      total,
      shares: shareList,
      ...(shareList ? {} : { problem: "member caps cannot cover the total" }),
    },
    summary: `Drafted pact "${input.title.slice(0, 60)}"`,
  };
}

function draftTransfer(input: z.infer<typeof DraftTransferInput>, ctx: ToolContext): ToolOutcome {
  if (!input.counterpartyUserId && !input.counterpartyEmail) {
    throw new ToolError("needs counterpartyUserId or counterpartyEmail");
  }
  if (input.counterpartyUserId) memberOf(ctx, input.counterpartyUserId);
  if (input.counterpartyUserId === ctx.userId) throw new ToolError("cannot transfer to yourself");
  const transfer = {
    direction: input.direction,
    fromUserId: ctx.userId,
    counterpartyUserId: input.counterpartyUserId,
    counterpartyEmail: input.counterpartyEmail,
    amount: { amountMinor: input.amountMinor, currency: input.currency },
    note: input.note,
    status: "draft",
    createdAt: nowIso(),
  };
  const ref = ctx.putRef("transfer", transfer);
  return {
    kind: "result",
    output: { transferRef: ref, ...transfer },
    summary: `Drafted a ${input.direction} transfer`,
  };
}

async function requestSpend(
  input: z.infer<typeof RequestSpendInput>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const ref = ctx.getRef(input.targetRef);
  if (!ref) throw new ToolError(`unknown ref ${input.targetRef}`);

  let amount: Money;
  let merchant: string;
  let category: string | undefined;
  let description: string;
  let pactId: string | undefined;
  switch (ref.kind) {
    case "product": {
      const p = ref.data as Product;
      amount = { amountMinor: p.price.amountMinor * input.quantity, currency: p.price.currency };
      merchant = p.merchant;
      category = p.category;
      description = `${input.quantity} × ${p.title}`.slice(0, 500);
      break;
    }
    case "pact": {
      const d = ref.data as {
        pact: Pact;
        shares: { userId: string; share: Money }[] | null;
      };
      const mine = d.shares?.find((s) => s.userId === ctx.userId);
      if (!mine) throw new ToolError("you have no share in this pact");
      amount = mine.share;
      pactId = d.pact.id;
      merchant = "pact";
      if (d.pact.action.kind === "purchase") {
        const product = ctx.getRef(d.pact.action.productRef)?.data as Product | undefined;
        if (product) {
          merchant = product.merchant;
          category = product.category;
        }
      }
      description = `Your share of "${d.pact.title}"`;
      break;
    }
    case "transfer": {
      const t = ref.data as { direction: string; amount: Money; fromUserId: string };
      if (t.direction !== "send") throw new ToolError("only send transfers are paid by you");
      if (t.fromUserId !== ctx.userId)
        throw new ToolError("this transfer belongs to another member");
      amount = t.amount;
      merchant = "p2p";
      description = "Person-to-person send";
      break;
    }
    default:
      throw new ToolError(`cannot spend against a ${ref.kind} ref`);
  }

  const intent: SpendIntent = {
    id: newId("spend"),
    userId: ctx.userId,
    amount,
    merchant,
    description,
    initiatedBy: "agent",
    at: nowIso(),
    ...(category ? { category } : {}),
    ...(pactId ? { pactId } : {}),
  };
  const { mandates, ledger } = await ctx.loadPolicyState(ctx.userId);
  const decision = ctx.authorize(intent, mandates, ledger);
  return {
    kind: "spend",
    intent,
    decision,
    summary: `Requested spend: ${description.slice(0, 100)}`,
  };
}

function expectRef(ctx: ToolContext, id: string, kind: string): StoredRef {
  const ref = ctx.getRef(id);
  if (!ref || ref.kind !== kind) throw new ToolError(`${id} is not a known ${kind} ref`);
  return ref;
}

function memberOf(ctx: ToolContext, userId: string): Member {
  const m = ctx.members.find((x) => x.userId === userId);
  if (!m) throw new ToolError(`${userId} is not a member of this thread`);
  return m;
}
