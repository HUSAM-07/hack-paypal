/**
 * What a tool or action runs against. The harness (`ShopperAgent`, workstream A) implements
 * `ShopContext` over its Durable Object: `ShopState` is broadcast to the client; `PrivateState`
 * stays on the server (vault id, mandates, ledger) and is never sent anywhere.
 */
import type { LedgerEntry } from "@pact/policy";
import type { Mandate, Money } from "@pact/protocol";
import type { ApprovalKind } from "@shop/agent-protocol";
import type { Checkout } from "./checkout";
import type { Offer, Order, ShopState, Watch } from "./contract";

export interface PrivateState {
  wallet?: { vaultId: string; customerId: string; payerEmail?: string; connectedAt: string };
  pendingWalletSetup?: { setupTokenId: string; attemptId: string; startedAt: string };
  mandates: Mandate[];
  ledger: LedgerEntry[];
  /** Offers the user has seen (search results), so tools can refer to them by id. */
  offers: Record<string, Offer>;
  checkouts: Record<string, Checkout>;
  /** Consecutive failed checks per watch, for backoff. */
  watchFailures: Record<string, number>;
}

export function initialPrivateState(): PrivateState {
  return { mandates: [], ledger: [], offers: {}, checkouts: {}, watchFailures: {} };
}

export type ScheduledTask =
  | { kind: "watch"; watchId: string }
  /** The cooling-off window of an order ends: capture (unless cancelled). */
  | { kind: "capture"; orderId: string };

export interface ApprovalAnswer {
  decision: "approved" | "denied" | "expired";
  /** The harness verified a passkey assertion for this approval. */
  stepUpVerified?: boolean;
  /** The `details` the user saw on the approval card (echoed back). */
  details?: unknown;
}

export interface ShopContext {
  userId: string;
  threadId?: string;
  getState(): ShopState | Promise<ShopState>;
  setState(next: ShopState): void | Promise<void>;
  getPrivate(): PrivateState | Promise<PrivateState>;
  setPrivate(next: PrivateState): void | Promise<void>;
  /** Run `onSchedule(task)` at `at` (ISO). Idempotent per task: re-scheduling replaces. */
  schedule(at: string, task: ScheduledTask): void | Promise<void>;
  unschedule?(task: ScheduledTask): void | Promise<void>;
  /** Present when the tool is re-run after its approval request was answered. */
  approval?: ApprovalAnswer;
}

/** What `needsApproval` returns: the harness turns it into an `ApprovalRequestItem`. */
export interface ApprovalSpec {
  kind: ApprovalKind;
  title: string;
  summary: string;
  amount?: Money;
  details: unknown;
  stepUp: boolean;
}

export async function updateState(
  ctx: ShopContext,
  fn: (s: ShopState) => ShopState,
): Promise<ShopState> {
  const next = fn(await ctx.getState());
  await ctx.setState(next);
  return next;
}

export async function updatePrivate(
  ctx: ShopContext,
  fn: (p: PrivateState) => PrivateState,
): Promise<PrivateState> {
  const next = fn(await ctx.getPrivate());
  await ctx.setPrivate(next);
  return next;
}

export function upsertWatch(s: ShopState, w: Watch): ShopState {
  const i = s.watches.findIndex((x) => x.id === w.id);
  const watches = [...s.watches];
  if (i >= 0) watches[i] = w;
  else watches.push(w);
  return { ...s, watches };
}

export function upsertOrder(s: ShopState, o: Order): ShopState {
  const i = s.orders.findIndex((x) => x.id === o.id);
  const orders = [...s.orders];
  if (i >= 0) orders[i] = o;
  else orders.unshift(o);
  return { ...s, orders };
}

const OFFER_CACHE_CAP = 200;

export function rememberOffers(p: PrivateState, offers: readonly Offer[]): PrivateState {
  const merged = { ...p.offers };
  for (const o of offers) {
    delete merged[o.id];
    merged[o.id] = o;
  }
  const keys = Object.keys(merged);
  for (const k of keys.slice(0, Math.max(0, keys.length - OFFER_CACHE_CAP))) delete merged[k];
  return { ...p, offers: merged };
}
