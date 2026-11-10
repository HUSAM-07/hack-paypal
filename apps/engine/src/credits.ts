/**
 * The credit ledger on D1. The maths (lift, Shapley, caps, voids) live in
 * `@pact/attribution` as pure functions; this module loads rows, runs them and writes back.
 */
import {
  applyVoid,
  type CoalitionValue,
  createCredits,
  depositBalance,
  type ReviewFlag,
  type VoidEvent,
} from "@pact/attribution";
import type { AttributedSale, Credit } from "@pact/protocol";
import type { Env } from "./env";
import { brandLiftData, evaluateBrand } from "./lift";
import { aggregateDeposit, type Brand, listBrands, listDeposits } from "./programme";

type Row = Record<string, unknown>;

const toCredit = (r: Row): Credit => ({
  id: r.id as string,
  captureId: r.capture_id as string,
  creatorId: r.creator_id as string,
  brandId: r.brand_id as string,
  upc: r.upc as string,
  amount: { amountMinor: r.amount_minor as number, currency: r.currency as string },
  state: r.state as Credit["state"],
  ...(r.void_reason ? { voidReason: r.void_reason as NonNullable<Credit["voidReason"]> } : {}),
  holdUntil: r.hold_until as string,
  ...(r.payout_batch_id ? { payoutBatchId: r.payout_batch_id as string } : {}),
});

export interface StoredCredit extends Credit {
  payoutStatus: string | null;
}

export async function loadCredits(env: Env): Promise<Credit[]> {
  const { results } = await env.DB.prepare("SELECT * FROM credits ORDER BY id").all<Row>();
  return results.map(toCredit);
}

export async function loadStoredCredits(env: Env): Promise<StoredCredit[]> {
  const { results } = await env.DB.prepare("SELECT * FROM credits ORDER BY id").all<Row>();
  return results.map((r) => ({
    ...toCredit(r),
    payoutStatus: (r.payout_status as string) ?? null,
  }));
}

/** Write the difference between two ledger states: new rows are inserted, changed rows updated. */
export async function persistCredits(
  env: Env,
  before: readonly Credit[],
  after: readonly Credit[],
  now: string,
): Promise<void> {
  const prior = new Map(before.map((c) => [c.id, JSON.stringify(c)]));
  const stmts: D1PreparedStatement[] = [];
  for (const c of after) {
    const was = prior.get(c.id);
    if (was === JSON.stringify(c)) continue;
    if (was === undefined) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO credits (id, capture_id, creator_id, brand_id, upc, amount_minor, currency,
             state, void_reason, hold_until, payout_batch_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          c.id,
          c.captureId,
          c.creatorId,
          c.brandId,
          c.upc,
          c.amount.amountMinor,
          c.amount.currency,
          c.state,
          c.voidReason ?? null,
          c.holdUntil,
          c.payoutBatchId ?? null,
          now,
        ),
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `UPDATE credits SET amount_minor = ?, state = ?, void_reason = ?, payout_batch_id = ?
           WHERE id = ?`,
        ).bind(c.amount.amountMinor, c.state, c.voidReason ?? null, c.payoutBatchId ?? null, c.id),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

/** Sales that joined to a verified passport. Unattributed sales never reach the ledger. */
export async function loadAttributedSales(env: Env): Promise<AttributedSale[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM sales WHERE unattributed_reason IS NULL AND arm IS NOT NULL
     ORDER BY captured_at, capture_id, upc`,
  ).all<Row>();
  return results.map((r) => ({
    captureId: r.capture_id as string,
    orderId: r.order_id as string,
    shopId: r.shop_id as string,
    upc: r.upc as string,
    amount: { amountMinor: r.amount_minor as number, currency: r.currency as string },
    sessionId: r.session_id as string,
    arm: r.arm as AttributedSale["arm"],
    creatorsSeen: JSON.parse(r.creators_seen as string) as string[],
    model: (r.model as string) ?? "unknown",
    capturedAt: r.captured_at as string,
  }));
}

/**
 * Lift of each coalition of creators on this brand's SKU: the purchase rate of exposed
 * sessions that saw at least that coalition, minus the placebo rate. Empty or unseen
 * coalitions are worth 0, so a creator nobody was exposed to earns nothing.
 */
export async function coalitionValueFor(env: Env, brand: Brand): Promise<CoalitionValue> {
  const { results } = await env.DB.prepare(
    `SELECT s.arm AS arm, s.creators_seen AS seen,
       EXISTS (SELECT 1 FROM sales x WHERE x.session_id = s.session_id AND x.upc = ?
               AND x.unattributed_reason IS NULL) AS bought
     FROM agent_sessions s WHERE s.category = ? AND s.arm IN ('test', 'placebo')`,
  )
    .bind(brand.upc, brand.category)
    .all<Row>();
  const exposed = results
    .filter((r) => r.arm === "test")
    .map((r) => ({ seen: new Set(JSON.parse(r.seen as string) as string[]), bought: !!r.bought }));
  const placebo = results.filter((r) => r.arm === "placebo");
  const placeboRate = placebo.length ? placebo.filter((r) => r.bought).length / placebo.length : 0;
  return (subset) => {
    if (subset.length === 0) return 0;
    const who = exposed.filter((e) => subset.every((c) => e.seen.has(c)));
    if (who.length === 0) return 0;
    return who.filter((e) => e.bought).length / who.length - placeboRate;
  };
}

export interface RecomputeSummary {
  created: number;
  brands: {
    brandId: string;
    exposedSales: number;
    causedUnits: number;
    fraction: number;
    newCredits: number;
  }[];
}

/**
 * Run lift + Shapley + deposit caps for every brand and add the pending credits that are
 * new. Idempotent: credit ids are `capture:creator`, so a rerun creates nothing twice.
 * Refunds and disputes already on file are applied afterwards.
 */
export async function recomputeCredits(env: Env, now: string): Promise<RecomputeSummary> {
  const brands = await listBrands(env);
  const sales = await loadAttributedSales(env);
  const before = await loadCredits(env);
  let ledger = before;
  const summary: RecomputeSummary = { created: 0, brands: [] };

  for (const brand of brands) {
    const data = await brandLiftData(env, brand);
    const lift = evaluateBrand(data);
    const deposit = aggregateDeposit(brand, await listDeposits(env, brand.brandId));
    const value = await coalitionValueFor(env, brand);
    const fresh = createCredits({
      sales: sales.filter((s) => s.upc === brand.upc),
      brands: [{ brandId: brand.brandId, upc: brand.upc, units: lift.units, deposit }],
      coalitionValue: () => value,
      existing: ledger,
    });
    ledger = [...ledger, ...fresh];
    summary.created += fresh.length;
    summary.brands.push({
      brandId: brand.brandId,
      exposedSales: data.exposedSales,
      causedUnits: lift.units,
      fraction: lift.fraction,
      newCredits: fresh.length,
    });
  }
  await persistCredits(env, before, ledger, now);
  await applyVoids(env);
  return summary;
}

/**
 * Where a dispute stands, from the status the webhook stored. PayPal's outcome codes: the buyer
 * wins with RESOLVED_BUYER_FAVOUR, RESOLVED_WITH_PAYOUT or ACCEPTED (the seller accepted the
 * claim); anything else resolved (seller favour, cancelled by the buyer, denied) releases.
 */
export function disputeState(status: string): "open" | "buyer" | "seller" {
  if (!status.startsWith("RESOLVED")) return "open";
  const code = status.split(":")[1] ?? "";
  return ["RESOLVED_BUYER_FAVOUR", "RESOLVED_WITH_PAYOUT", "ACCEPTED"].includes(code)
    ? "buyer"
    : "seller";
}

/** Captures with a dispute PayPal has not decided yet: their credits are frozen, not paid. */
export async function frozenCaptures(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    "SELECT capture_id, status FROM refunds WHERE kind = 'dispute'",
  ).all<Row>();
  return new Set(
    results
      .filter((r) => disputeState(r.status as string) === "open")
      .map((r) => r.capture_id as string),
  );
}

const sumMinor = (rows: Row[], k: string) => rows.reduce((a, r) => a + ((r[k] as number) ?? 0), 0);

/**
 * Void credits for every refund, and every dispute the buyer won, on file. Pure ledger rules,
 * so reapplying is a no-op; paid credits are never touched, only flagged for a person to review.
 */
export async function applyVoids(env: Env, captureId?: string): Promise<ReviewFlag[]> {
  const refunds = (
    await (captureId
      ? env.DB.prepare("SELECT * FROM refunds WHERE capture_id = ? ORDER BY created_at, id").bind(
          captureId,
        )
      : env.DB.prepare("SELECT * FROM refunds ORDER BY created_at, id")
    ).all<Row>()
  ).results;
  if (refunds.length === 0) return [];

  const before = await loadCredits(env);
  let ledger = before;
  const flags: ReviewFlag[] = [];
  const byCapture = new Map<string, Row[]>();
  for (const r of refunds) {
    const k = r.capture_id as string;
    byCapture.set(k, [...(byCapture.get(k) ?? []), r]);
  }

  for (const [capture, rows] of byCapture) {
    const sale = await env.DB.prepare(
      "SELECT SUM(amount_minor) AS total, MAX(currency) AS currency FROM sales WHERE capture_id = ?",
    )
      .bind(capture)
      .first<{ total: number | null; currency: string | null }>();
    const events: VoidEvent[] = [];
    // An open dispute only freezes the credit (see frozenCaptures); it voids if the buyer wins.
    if (rows.some((r) => r.kind === "dispute" && disputeState(r.status as string) === "buyer"))
      events.push({ kind: "dispute", captureId: capture });
    const refundRows = rows.filter(
      (r) => r.kind === "refund" && r.status !== "FAILED" && r.status !== "CANCELLED",
    );
    if (refundRows.length) {
      const cur = sale?.currency ?? "USD";
      const total = sale?.total ?? 0;
      const refunded = sumMinor(refundRows, "amount_minor");
      const wholeSale = refundRows.some((r) => r.amount_minor === null) || total === 0;
      if (wholeSale || refunded >= total) events.push({ kind: "refund", captureId: capture });
      else {
        const money = (n: number) => ({ amountMinor: n, currency: cur });
        events.push({
          kind: "partial_refund",
          captureId: capture,
          saleAmount: money(total),
          refunded: money(refunded),
          cumulativeRefunded: money(refunded),
        });
      }
    }
    for (const event of events) {
      const out = applyVoid(ledger, event);
      ledger = out.credits;
      flags.push(...out.flags);
    }
  }

  await persistCredits(env, before, ledger, new Date().toISOString());
  for (const f of flags) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO review_flags (credit_id, capture_id, reason, payout_batch_id)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(f.creditId, f.captureId, f.reason, f.payoutBatchId ?? null)
      .run();
  }
  return flags;
}

/** What each brand's deposit looks like right now. */
export async function brandBalances(env: Env) {
  const credits = await loadCredits(env);
  const out = [];
  for (const brand of await listBrands(env)) {
    const rows = await listDeposits(env, brand.brandId);
    const balance = depositBalance(aggregateDeposit(brand, rows), credits);
    out.push({ brand, rows, balance });
  }
  return out;
}
