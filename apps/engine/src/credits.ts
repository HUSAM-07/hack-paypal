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
  type WhatIfBrand,
} from "@pact/attribution";
import { type AttributedSale, type Credit, LIVE_CATEGORY } from "@pact/protocol";
import type { Env } from "./env";
import { applyGuard, SELF_DEALT_SESSIONS, selfDealtSessions } from "./guard";
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

/** One capture's credits (a split partial refund keeps the capture id, so it is included). */
export async function loadCreditsOf(env: Env, captureId: string): Promise<Credit[]> {
  const { results } = await env.DB.prepare("SELECT * FROM credits WHERE capture_id = ? ORDER BY id")
    .bind(captureId)
    .all<Row>();
  return results.map(toCredit);
}

export async function loadStoredCredits(env: Env): Promise<StoredCredit[]> {
  const { results } = await env.DB.prepare("SELECT * FROM credits ORDER BY id").all<Row>();
  return results.map((r) => ({
    ...toCredit(r),
    payoutStatus: (r.payout_status as string) ?? null,
  }));
}

/**
 * Rows per bulk statement. Each statement binds one JSON array (D1 allows 100 bound parameters
 * but 2 MB per value), so ~200 bytes a row keeps a statement well under that.
 */
export const BULK_ROWS = 2_000;

/**
 * Write the difference between two ledger states: new rows are inserted, changed rows updated.
 *
 * Bulk through `json_each`, one statement per BULK_ROWS rows, all in one `batch()` (one D1
 * transaction, and one query against a Worker invocation's 1,000-query limit). One statement
 * per row put 10k credits at 200 round trips; 50k would have hit that limit.
 */
export async function persistCredits(
  env: Env,
  before: readonly Credit[],
  after: readonly Credit[],
  now: string,
): Promise<void> {
  const prior = new Map(before.map((c) => [c.id, JSON.stringify(c)]));
  const inserts: unknown[][] = [];
  const updates: unknown[][] = [];
  for (const c of after) {
    const was = prior.get(c.id);
    if (was === JSON.stringify(c)) continue;
    if (was === undefined) {
      inserts.push([
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
      ]);
    } else {
      updates.push([
        c.id,
        c.amount.amountMinor,
        c.state,
        c.voidReason ?? null,
        c.payoutBatchId ?? null,
      ]);
    }
  }
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < inserts.length; i += BULK_ROWS) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO credits (id, capture_id, creator_id, brand_id, upc, amount_minor, currency,
           state, void_reason, hold_until, payout_batch_id, created_at)
         SELECT j.value ->> 0, j.value ->> 1, j.value ->> 2, j.value ->> 3, j.value ->> 4,
           j.value ->> 5, j.value ->> 6, j.value ->> 7, j.value ->> 8, j.value ->> 9,
           j.value ->> 10, j.value ->> 11
         FROM json_each(?) AS j`,
      ).bind(JSON.stringify(inserts.slice(i, i + BULK_ROWS))),
    );
  }
  for (let i = 0; i < updates.length; i += BULK_ROWS) {
    stmts.push(
      env.DB.prepare(
        `UPDATE credits SET amount_minor = u.amount_minor, state = u.state,
           void_reason = u.void_reason, payout_batch_id = u.payout_batch_id
         FROM (SELECT j.value ->> 0 AS id, j.value ->> 1 AS amount_minor, j.value ->> 2 AS state,
                 j.value ->> 3 AS void_reason, j.value ->> 4 AS payout_batch_id
               FROM json_each(?) AS j) AS u
         WHERE credits.id = u.id`,
      ).bind(JSON.stringify(updates.slice(i, i + BULK_ROWS))),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/**
 * Sales that joined to a verified passport. Unattributed sales never reach the ledger, and
 * neither do live runs' sales (LIVE_CATEGORY): they never draw on a programme's deposit.
 */
export async function loadAttributedSales(env: Env): Promise<AttributedSale[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM sales WHERE unattributed_reason IS NULL AND arm IS NOT NULL AND source = 'agent'
       AND session_id NOT IN (SELECT session_id FROM agent_sessions WHERE category = ?)
     ORDER BY captured_at, capture_id, upc`,
  )
    .bind(LIVE_CATEGORY)
    .all<Row>();
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
               AND x.unattributed_reason IS NULL AND x.source = 'agent') AS bought
     FROM agent_sessions s WHERE s.category = ? AND s.arm IN ('test', 'placebo')
       AND s.session_id NOT IN ${SELF_DEALT_SESSIONS}`,
  )
    .bind(brand.upc, brand.category)
    .all<Row>();
  const exposed = results
    .filter((r) => r.arm === "test")
    .map((r) => ({ seen: new Set(JSON.parse(r.seen as string) as string[]), bought: !!r.bought }));
  const placebo = results.filter((r) => r.arm === "placebo");
  const placeboRate = placebo.length ? placebo.filter((r) => r.bought).length / placebo.length : 0;
  // Shapley asks for the same few coalitions on every sale; each answer scans every exposed
  // session, so remember it (subsets arrive in sorted order, so the joined ids are a key).
  const memo = new Map<string, number>();
  return (subset) => {
    if (subset.length === 0) return 0;
    const key = subset.join("+");
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const who = exposed.filter((e) => subset.every((c) => e.seen.has(c)));
    const v = who.length === 0 ? 0 : who.filter((e) => e.bought).length / who.length - placeboRate;
    memo.set(key, v);
    return v;
  };
}

/** More recorded sales than this and the what-if is left out: the page would be re-sending them every poll. */
export const WHAT_IF_MAX_SALES = 5_000;

/**
 * What the Studio commission what-if needs to run the ledger's own maths again in the browser:
 * per brand, the exposed-arm sales and the lift of every coalition of creators those sales saw.
 * Read-only; nothing here changes a credit.
 */
export async function whatIfInputs(env: Env): Promise<{
  brands: WhatIfBrand[];
  truncated: boolean;
}> {
  const brands = await listBrands(env);
  const all = (await loadAttributedSales(env)).filter((s) => s.arm === "test");
  if (all.length > WHAT_IF_MAX_SALES) return { brands: [], truncated: true };
  const selfDealt = await selfDealtSessions(env);
  const out: WhatIfBrand[] = [];
  for (const brand of brands) {
    const mine = all.filter((s) => s.upc === brand.upc && s.amount.currency === brand.currency);
    const value = await coalitionValueFor(env, brand);
    const coalitions: Record<string, number> = {};
    for (const sale of mine) {
      const ids = [...new Set(sale.creatorsSeen)].sort();
      // Shapley needs every non-empty subset of the creators this sale saw (at most 4).
      for (let mask = 1; mask < 1 << ids.length; mask++) {
        const subset = ids.filter((_, i) => mask & (1 << i));
        coalitions[subset.join("+")] = value(subset);
      }
    }
    const lift = evaluateBrand(await brandLiftData(env, brand));
    out.push({
      brandId: brand.brandId,
      upc: brand.upc,
      currency: brand.currency,
      causedUnits: lift.units,
      sales: mine.filter((s) => !selfDealt.has(s.sessionId)),
      selfDealtSales: mine.filter((s) => selfDealt.has(s.sessionId)),
      coalitions,
    });
  }
  return { brands: out, truncated: false };
}

export interface RecomputeSummary {
  created: number;
  /** Guard holds on the ledger after this run (new and already open). */
  held: number;
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
 * Refunds and disputes already on file are applied afterwards, then the abuse guard.
 *
 * Self-dealt sales (a creator buying through their own PayPal or agent) never enter the lift or
 * take one of its caused units. They are credited apart, at the full commission they would have
 * earned, so the guard can hold that credit in plain sight instead of silently dropping it.
 */
export async function recomputeCredits(env: Env, now: string): Promise<RecomputeSummary> {
  const brands = await listBrands(env);
  const all = await loadAttributedSales(env);
  const selfDealt = await selfDealtSessions(env);
  const sales = all.filter((s) => !selfDealt.has(s.sessionId));
  const dealt = all.filter((s) => selfDealt.has(s.sessionId));
  const before = await loadCredits(env);
  let ledger = before;
  const summary: RecomputeSummary = { created: 0, held: 0, brands: [] };

  for (const brand of brands) {
    const data = await brandLiftData(env, brand);
    const lift = evaluateBrand(data);
    const deposit = aggregateDeposit(brand, await listDeposits(env, brand.brandId));
    const value = await coalitionValueFor(env, brand);
    const fresh = createCredits({
      // A programme lives in one currency: a sale of its product in another is never credited,
      // and never converted.
      sales: sales.filter((s) => s.upc === brand.upc && s.amount.currency === brand.currency),
      brands: [
        {
          brandId: brand.brandId,
          upc: brand.upc,
          units: lift.units,
          deposit,
          commissionBps: brand.commissionBps,
        },
      ],
      coalitionValue: () => value,
      existing: ledger,
    });
    ledger = [...ledger, ...fresh];
    summary.created += fresh.length;
    const own = dealt.filter(
      (s) => s.upc === brand.upc && s.arm === "test" && s.amount.currency === brand.currency,
    );
    if (own.length) {
      const held = createCredits({
        sales: own,
        brands: [
          {
            brandId: brand.brandId,
            upc: brand.upc,
            units: own.length,
            deposit,
            commissionBps: brand.commissionBps,
          },
        ],
        coalitionValue: () => value,
        existing: ledger,
      });
      ledger = [...ledger, ...held];
      summary.created += held.length;
    }
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
  summary.held = (await applyGuard(env, now)).length;
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

  // One webhook touches one capture: load only its credits and sale, not the whole ledger
  // (a refund at 10k sales used to read every credit). Without a capture, everything refunded.
  const before = captureId ? await loadCreditsOf(env, captureId) : await loadCredits(env);
  const saleTotals = new Map(
    (
      await (captureId
        ? env.DB.prepare(
            `SELECT capture_id, SUM(amount_minor) AS total, MAX(currency) AS currency
             FROM sales WHERE capture_id = ? GROUP BY capture_id`,
          ).bind(captureId)
        : env.DB.prepare(
            `SELECT capture_id, SUM(amount_minor) AS total, MAX(currency) AS currency
             FROM sales WHERE capture_id IN (SELECT capture_id FROM refunds) GROUP BY capture_id`,
          )
      ).all<Row>()
    ).results.map((r) => [
      r.capture_id as string,
      { total: r.total as number | null, currency: r.currency as string | null },
    ]),
  );
  const creditsOf = new Map<string, Credit[]>();
  for (const c of before) {
    const list = creditsOf.get(c.captureId);
    if (list) list.push(c);
    else creditsOf.set(c.captureId, [c]);
  }
  const untouched = new Set(before);
  const changed: Credit[] = [];
  const flags: ReviewFlag[] = [];
  const byCapture = new Map<string, Row[]>();
  for (const r of refunds) {
    const k = r.capture_id as string;
    const list = byCapture.get(k);
    if (list) list.push(r);
    else byCapture.set(k, [r]);
  }

  for (const [capture, rows] of byCapture) {
    const sale = saleTotals.get(capture);
    // applyVoid only reads and writes the credits of `event.captureId`, so it runs on that slice.
    let ledger: readonly Credit[] = creditsOf.get(capture) ?? [];
    for (const c of ledger) untouched.delete(c);
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
    changed.push(...ledger);
  }

  await persistCredits(env, before, [...untouched, ...changed], new Date().toISOString());
  const at = new Date().toISOString();
  const stmts = flags.map((f) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO review_flags (id, credit_id, capture_id, reason, payout_batch_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      `${f.reason}:${f.creditId}`,
      f.creditId,
      f.captureId,
      f.reason,
      f.payoutBatchId ?? null,
      at,
    ),
  );
  for (let i = 0; i < stmts.length; i += 500) await env.DB.batch(stmts.slice(i, i + 500));
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
