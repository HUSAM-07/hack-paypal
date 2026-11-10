import type { EngineClient, EngineJourney, EngineLift, EnginePayoutBatch } from "./engine";
import { type AgentRun, pickPair, type RunSource } from "./runs";

export interface Deps {
  engine: EngineClient;
  runs: RunSource;
}

// ───────────────────────── side-by-side runs (#28) ─────────────────────────

export interface RunView {
  run: AgentRun;
  /** The order as the engine recorded it; null until the capture webhook has landed. */
  journey: EngineJourney | null;
}

export interface DemoData {
  exposed: RunView | null;
  heldOut: RunView | null;
  engineError: string | null;
}

export async function loadDemo({ engine, runs }: Deps): Promise<DemoData> {
  const all = await runs.runs();
  let journeys: EngineJourney[] = [];
  let engineError: string | null = null;
  try {
    journeys = await engine.journeys(200);
  } catch (e) {
    engineError = e instanceof Error ? e.message : String(e);
  }
  const credited = new Set(
    journeys.filter((j) => j.commission.pending + j.commission.paid > 0).map((j) => j.orderId),
  );
  const { exposed, heldOut } = pickPair(all, credited);
  const view = (run: AgentRun | null): RunView | null =>
    run ? { run, journey: journeys.find((j) => j.orderId === run.orderId) ?? null } : null;
  return { exposed: view(exposed), heldOut: view(heldOut), engineError };
}

// ───────────────────────── payout moment (#29) ─────────────────────────

export interface PayoutData {
  creatorId: string;
  creatorName: string;
  receiver: string;
  amountMinor: number;
  currency: string;
  status: string;
  paypalBatchId: string | null;
  senderBatchId: string;
  /** PayPal's payout_item_id when the engine records it; otherwise our deterministic sender_item_id. */
  itemId: string;
  itemIdKind: "payout_item_id" | "sender_item_id";
  paidAt: string;
  /** What the credit ledger says this creator has been paid; must equal amountMinor. */
  ledgerPaidMinor: number | null;
  rival: { name: string; causedUnits: number; paidMinor: number } | null;
}

/** Mirrors the engine's sender_item_id rule (apps/engine/src/payouts.ts). */
function senderItemId(creatorId: string, senderBatchId: string): string {
  return `${creatorId}-${senderBatchId.slice(6, 14)}`.slice(0, 63);
}

function rivalOf(
  lift: EngineLift[],
  credits: { brandId: string; amountMinor: number; state: string }[],
): PayoutData["rival"] {
  const flat = lift.find((b) => b.causedUnits === 0);
  if (!flat) return null;
  const paid = credits
    .filter((c) => c.brandId === flat.brandId && c.state !== "voided")
    .reduce((a, c) => a + c.amountMinor, 0);
  return { name: flat.name, causedUnits: flat.causedUnits, paidMinor: paid };
}

export async function loadPayout({ engine }: Deps, creatorId?: string): Promise<PayoutData | null> {
  const batches = await engine.payouts();
  const sent: EnginePayoutBatch[] = batches
    .filter(
      (b) => b.items.length > 0 && (!creatorId || b.items.some((i) => i.creatorId === creatorId)),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const batch = sent[0];
  if (!batch) return null;
  const item = batch.items.find((i) => !creatorId || i.creatorId === creatorId);
  if (!item) return null;

  const [creators, lift] = await Promise.all([engine.credits(), engine.lift()]);
  const mine = creators.find((c) => c.creatorId === item.creatorId);
  const allCredits = creators.flatMap((c) => c.credits);
  return {
    creatorId: item.creatorId,
    creatorName: mine?.name ?? item.creatorId,
    receiver: item.receiver,
    amountMinor: item.amountMinor,
    currency: item.currency,
    status: batch.status,
    paypalBatchId: batch.paypalBatchId,
    senderBatchId: batch.senderBatchId,
    itemId: item.payoutItemId ?? senderItemId(item.creatorId, batch.senderBatchId),
    itemIdKind: item.payoutItemId ? "payout_item_id" : "sender_item_id",
    paidAt: batch.createdAt,
    ledgerPaidMinor: mine ? mine.totals.paid : null,
    rival: rivalOf(lift, allCredits),
  };
}
