import { Mandate, Money, Pact } from "@pact/protocol";
import { createContext, useContext } from "react";
import { z } from "zod";

/**
 * What `AgentMessageItem.refs[id]` resolves to. The worker stores `{ kind, data }`
 * per ref (see apps/worker ThreadDO). These schemas are the web's reading of that
 * data: anything that doesn't parse is treated as unknown and renders a skeleton,
 * so a malformed or missing ref can never surface a model-typed value.
 */
export const ProductData = z.object({
  title: z.string(),
  brand: z.string().optional(),
  price: Money,
  listPrice: Money.optional(),
  merchant: z.string(),
  category: z.string().optional(),
  url: z.string().optional(),
  imageUrl: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  features: z.array(z.string()).default([]),
  /** Optional labelled specs for ProductCompare rows. */
  specs: z.record(z.string(), z.string()).optional(),
});
export type ProductData = z.infer<typeof ProductData>;

export const PricePoint = z.object({ at: z.string(), price: Money });

export const PactData = z.object({
  pact: Pact,
  total: Money.optional(),
  shares: z
    .array(z.object({ userId: z.string(), share: Money }))
    .nullable()
    .optional(),
  /** Price-watch state for price-triggered pacts. */
  watch: z
    .object({ current: Money, history: z.array(PricePoint).default([]), checkedAt: z.string() })
    .optional(),
  product: ProductData.optional(),
  /** ISO timestamps of upcoming runs for scheduled pacts. */
  nextRuns: z.array(z.string()).optional(),
});
export type PactData = z.infer<typeof PactData>;

export const MandateData = z.object({
  mandate: Mandate,
  spent: Money.optional(),
  label: z.string().optional(),
});
export type MandateData = z.infer<typeof MandateData>;

export const TransferData = z.object({
  direction: z.enum(["send", "request"]),
  fromUserId: z.string(),
  fromName: z.string().optional(),
  counterpartyUserId: z.string().optional(),
  counterpartyEmail: z.string().optional(),
  counterpartyName: z.string().optional(),
  amount: Money,
  fee: Money.optional(),
  note: z.string().optional(),
  status: z.enum(["draft", "pending", "sent", "failed", "cancelled"]),
  createdAt: z.string(),
  eta: z.string().optional(),
});
export type TransferData = z.infer<typeof TransferData>;

export const ActivityEntry = z.object({
  id: z.string(),
  at: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  kind: z.enum([
    "charged",
    "refunded",
    "payoutSent",
    "payoutFailed",
    "chargeFailed",
    "purchased",
    "received",
    "pact",
  ]),
  amount: Money.optional(),
  direction: z.enum(["in", "out", "none"]).default("none"),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

export const ActivityData = z.object({ entries: z.array(ActivityEntry) });

const SCHEMAS = {
  product: ProductData,
  pact: PactData,
  mandate: MandateData,
  transfer: TransferData,
  activity: ActivityData,
} as const;
export type RefKind = keyof typeof SCHEMAS;
export type RefData<K extends RefKind> = z.infer<(typeof SCHEMAS)[K]>;

const StoredRef = z.object({ kind: z.string(), data: z.unknown() });

export type RefMap = Readonly<Record<string, unknown>>;

/** Server ref ids look like `product_ab12`; the prefix doubles as the kind. */
export function kindOf(refId: string): string | undefined {
  return /^([a-z]+)_[A-Za-z0-9]{4,40}$/.exec(refId)?.[1];
}

const cache = new WeakMap<object, Map<string, unknown>>();

/**
 * Resolve a ref to typed data, or `undefined` when the ref is unknown, of the wrong
 * kind, or fails validation. Results are memoized per refs object.
 */
export function resolveRef<K extends RefKind>(
  refs: RefMap,
  refId: string | undefined,
  kind: K,
): RefData<K> | undefined {
  if (!refId || kindOf(refId) !== kind) return undefined;
  let memo = cache.get(refs);
  if (!memo) {
    memo = new Map();
    cache.set(refs, memo);
  }
  const key = `${kind}:${refId}`;
  if (memo.has(key)) return memo.get(key) as RefData<K> | undefined;
  const stored = StoredRef.safeParse(refs[refId]);
  let out: RefData<K> | undefined;
  if (stored.success && stored.data.kind === kind) {
    const parsed = SCHEMAS[kind].safeParse(stored.data.data);
    if (parsed.success) out = parsed.data as RefData<K>;
    else console.warn(`[pact] ref ${refId} failed ${kind} validation`);
  }
  memo.set(key, out);
  return out;
}

export const RefsContext = createContext<RefMap>({});

/** Latest pact objects from `pactUpdate` items, so older cards stay live. */
export const LivePactsContext = createContext<Readonly<Record<string, z.infer<typeof Pact>>>>({});

export function useRefData<K extends RefKind>(refId: string | undefined, kind: K) {
  return resolveRef(useContext(RefsContext), refId, kind);
}
