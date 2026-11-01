/**
 * The generative-UI catalog: the only components the model may emit (OpenUI Lang).
 *
 * Framework-agnostic: the worker uses these specs to build the system prompt and to
 * validate model output; the web app binds a React renderer to each name.
 *
 * Money rule: no prop carries a price, amount, payee or product title typed by the
 * model. Those arrive as `*Ref` ids that the server resolves from tool results into
 * `AgentMessageItem.refs`. A component given an unknown ref renders a skeleton, never
 * a model-supplied number.
 */
import { z } from "zod";

export const CATALOG_VERSION = "1";

const Ref = z.string().regex(/^[a-z]+_[A-Za-z0-9]{4,40}$/, "server ref id like product_ab12");

export interface ComponentSpec<P extends z.ZodType = z.ZodType> {
  description: string;
  props: P;
}

function spec<P extends z.ZodType>(description: string, props: P): ComponentSpec<P> {
  return { description, props };
}

export const catalog = {
  Stack: spec(
    "Root layout. Vertical list of blocks; use once at the root.",
    z.object({ children: z.array(z.unknown()).min(1).max(12) }),
  ),
  Text: spec(
    "Markdown prose. Keep it short; never write prices or amounts here, bind them via components.",
    z.object({ markdown: z.string().max(2000) }),
  ),
  Callout: spec(
    "One-line notice for warnings, policy outcomes or confirmations.",
    z.object({ tone: z.enum(["info", "success", "warning"]), text: z.string().max(240) }),
  ),
  ProductCards: spec(
    "Horizontal carousel of products found by searchProducts. Pass the refs the tool returned.",
    z.object({ productRefs: z.array(Ref).min(1).max(8), caption: z.string().max(120).optional() }),
  ),
  ProductCompare: spec(
    "Side-by-side comparison table of 2-4 products.",
    z.object({
      productRefs: z.array(Ref).min(2).max(4),
      highlight: z.array(z.string().max(40)).max(6).optional(),
    }),
  ),
  PactCard: spec(
    "Live card for a pact: members, each share and commitment, the condition and the state.",
    z.object({ pactRef: Ref }),
  ),
  PriceWatch: spec(
    "Target vs current price with history and deadline for a price-triggered pact.",
    z.object({ pactRef: Ref }),
  ),
  SplitBreakdown: spec(
    "Who pays what for a pact. Interactive: members can adjust weights; changes are sent back as uiState.",
    z.object({ pactRef: Ref, editable: z.boolean().default(false) }),
  ),
  ScheduleCard: spec("Upcoming runs of a scheduled pact.", z.object({ pactRef: Ref })),
  MandateCard: spec(
    "A spending mandate: caps, period, expiry, scope, revoke.",
    z.object({ mandateRef: Ref }),
  ),
  TransferFundsCard: spec(
    "Send or request money between people. Use a draft created by draftTransfer; the user confirms in the card.",
    z.object({ transferRef: Ref }),
  ),
  ActivityList: spec(
    "Recent payments and pact events for the user or a pact.",
    z.object({ scopeRef: Ref.optional() }),
  ),
  QuestionCard: spec(
    "Ask the user to choose. Selecting an option sends it as the next user message.",
    z.object({
      question: z.string().max(200),
      options: z.array(z.string().max(80)).min(2).max(5),
      allowCustom: z.boolean().default(false),
    }),
  ),
  PlanCard: spec(
    "What the agent will do next, as short steps, before it does anything with money.",
    z.object({ title: z.string().max(80), steps: z.array(z.string().max(140)).min(1).max(6) }),
  ),
} as const satisfies Record<string, ComponentSpec>;

export type ComponentName = keyof typeof catalog;
export type PropsOf<N extends ComponentName> = z.infer<(typeof catalog)[N]["props"]>;

/**
 * Items the host renders from protocol items; the model can never emit these.
 * Approvals in particular must not be forgeable by model output.
 */
export const HOST_ONLY = ["ApprovalSheet", "Receipt", "PactTimeline", "SystemNotice"] as const;

/** The only actions a generated component can trigger. Money never moves from here. */
export const Actions = {
  issueTurn: z.object({ text: z.string().min(1).max(2000) }),
  openProduct: z.object({ productRef: Ref }),
  /** Opens the host's commit flow (PayPal vault approval + mandate) for this member. */
  openCommit: z.object({ pactRef: Ref }),
  copy: z.object({ text: z.string().max(2000) }),
} as const;
export type ActionName = keyof typeof Actions;

export interface CatalogDiagnostic {
  code: "unknown_component" | "invalid_props" | "unknown_ref" | "host_only";
  component: string;
  message: string;
}

/** Validate one node from the parsed model output against the catalog. */
export function validateNode(
  name: string,
  props: unknown,
  knownRefs: ReadonlySet<string>,
): CatalogDiagnostic[] {
  if ((HOST_ONLY as readonly string[]).includes(name)) {
    return [
      { code: "host_only", component: name, message: `${name} is rendered by the host only` },
    ];
  }
  const entry = (catalog as Record<string, ComponentSpec>)[name];
  if (!entry)
    return [{ code: "unknown_component", component: name, message: `unknown component ${name}` }];
  const parsed = entry.props.safeParse(props);
  if (!parsed.success) {
    return [{ code: "invalid_props", component: name, message: z.prettifyError(parsed.error) }];
  }
  const missing = collectRefs(parsed.data).filter((r) => !knownRefs.has(r));
  return missing.map((r) => ({
    code: "unknown_ref",
    component: name,
    message: `ref ${r} was not produced by a tool`,
  }));
}

function collectRefs(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (k === "children") continue;
    if (k.endsWith("Ref") && typeof v === "string") out.push(v);
    else if (k.endsWith("Refs") && Array.isArray(v))
      out.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return out;
}
