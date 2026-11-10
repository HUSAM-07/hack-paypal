/**
 * The abuse guard on D1. The rules are pure (`evaluateHolds` in @pact/attribution); this module
 * loads what PayPal told us about each credited sale, writes holds as `review_flags`, and lets
 * a reviewer release or void them. A credit with an open hold is never paid automatically.
 */
import { evaluateHolds, type GuardSale, HOLD_REASONS, type Hold } from "@pact/attribution";
import { disputeState, loadCredits, persistCredits } from "./credits";
import type { Env } from "./env";

type Row = Record<string, unknown>;

const HOLDS_SQL = HOLD_REASONS.map((r) => `'${r}'`).join(", ");

/**
 * Sessions where a creator bought through their own agent or their own PayPal. They are not
 * shoppers: they never enter the study (lift, coalition values, caused units), and their sales
 * are credited apart, only to be held.
 */
export const SELF_DEALT_SESSIONS = `(
  SELECT session_id FROM agent_sessions WHERE owner_id IS NOT NULL AND (
    owner_id IN (SELECT creator_id FROM creators)
    OR owner_id IN (SELECT paypal_id FROM creators WHERE paypal_id IS NOT NULL))
  UNION
  SELECT x.session_id FROM sales x JOIN orders o ON o.order_id = x.order_id
  WHERE x.session_id IS NOT NULL
    AND o.payer_id IN (SELECT paypal_id FROM creators WHERE paypal_id IS NOT NULL)
)`;

export async function selfDealtSessions(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    `SELECT session_id FROM ${SELF_DEALT_SESSIONS}`,
  ).all<Row>();
  return new Set(results.map((r) => r.session_id as string));
}

/** One fact row per credited capture: buyer, agent owner, and whether it came back. */
async function guardSales(env: Env): Promise<GuardSale[]> {
  const { results } = await env.DB.prepare(
    `SELECT x.capture_id AS capture_id, MIN(x.upc) AS upc, MIN(x.captured_at) AS captured_at,
       MAX(o.payer_id) AS payer_id, MAX(s.owner_id) AS owner_id
     FROM sales x
     LEFT JOIN orders o ON o.order_id = x.order_id
     LEFT JOIN agent_sessions s ON s.session_id = x.session_id
     WHERE x.capture_id IN (SELECT capture_id FROM credits)
     GROUP BY x.capture_id`,
  ).all<Row>();
  const refunds = (
    await env.DB.prepare(
      "SELECT capture_id, kind, status FROM refunds WHERE capture_id IN (SELECT capture_id FROM credits)",
    ).all<Row>()
  ).results;
  const cameBack = new Set(
    refunds
      .filter((r) =>
        r.kind === "refund"
          ? r.status !== "FAILED" && r.status !== "CANCELLED"
          : disputeState(r.status as string) === "buyer",
      )
      .map((r) => r.capture_id as string),
  );
  return results.map((r) => ({
    captureId: r.capture_id as string,
    upc: r.upc as string,
    capturedAt: r.captured_at as string,
    buyerId: (r.payer_id as string | null) ?? undefined,
    sessionOwnerId: (r.owner_id as string | null) ?? undefined,
    refunded: cameBack.has(r.capture_id as string),
  }));
}

/**
 * Run the guard over the whole ledger and record any new holds. A hold is written once per
 * (credit, reason): one a reviewer already released or voided is never reopened.
 */
export async function applyGuard(env: Env, now: string): Promise<Hold[]> {
  const credits = await loadCredits(env);
  if (credits.length === 0) return [];
  const creators = (
    await env.DB.prepare("SELECT creator_id, paypal_id FROM creators").all<Row>()
  ).results.map((r) => ({
    creatorId: r.creator_id as string,
    paypalId: (r.paypal_id as string | null) ?? undefined,
  }));
  const holds = evaluateHolds({ credits, sales: await guardSales(env), creators });
  const stmts = holds.map((h) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO review_flags (id, credit_id, capture_id, reason, detail, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    ).bind(`${h.reason}:${h.creditId}`, h.creditId, h.captureId, h.reason, h.detail, now),
  );
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return holds;
}

/** Credits with at least one open guard hold: left out of every payout. */
export async function heldCredits(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT credit_id FROM review_flags WHERE status = 'open' AND reason IN (${HOLDS_SQL})`,
  ).all<Row>();
  return new Set(results.map((r) => r.credit_id as string));
}

export interface FlagView {
  id: string;
  creditId: string;
  captureId: string;
  reason: string;
  detail: string | null;
  status: string;
  /** A guard hold (the credit waits for a person), not a note on an already-paid credit. */
  hold: boolean;
  payoutBatchId: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  credit: {
    creatorId: string;
    brandId: string;
    amountMinor: number;
    currency: string;
    state: string;
  } | null;
}

export async function listFlags(env: Env, status?: string): Promise<FlagView[]> {
  const { results } = await (status
    ? env.DB.prepare(
        `SELECT f.*, c.creator_id, c.brand_id, c.amount_minor, c.currency, c.state
         FROM review_flags f LEFT JOIN credits c ON c.id = f.credit_id
         WHERE f.status = ? ORDER BY f.credit_id, f.reason`,
      ).bind(status)
    : env.DB.prepare(
        `SELECT f.*, c.creator_id, c.brand_id, c.amount_minor, c.currency, c.state
         FROM review_flags f LEFT JOIN credits c ON c.id = f.credit_id
         ORDER BY f.credit_id, f.reason`,
      )
  ).all<Row>();
  return results.map((r) => ({
    id: (r.id as string) ?? `${r.reason}:${r.credit_id}`,
    creditId: r.credit_id as string,
    captureId: r.capture_id as string,
    reason: r.reason as string,
    detail: (r.detail as string | null) ?? null,
    status: r.status as string,
    hold: (HOLD_REASONS as readonly string[]).includes(r.reason as string),
    payoutBatchId: (r.payout_batch_id as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    credit: r.creator_id
      ? {
          creatorId: r.creator_id as string,
          brandId: r.brand_id as string,
          amountMinor: r.amount_minor as number,
          currency: r.currency as string,
          state: r.state as string,
        }
      : null,
  }));
}

export type ResolveResult =
  | { ok: true; flag: FlagView }
  | { ok: false; status: 404 | 409; error: string };

/**
 * A reviewer decides an open hold. `release`: this hold no longer blocks the credit (it is paid
 * at the next payout once no other hold is open). `void`: the credit is voided (reason
 * `review`), its deposit reservation freed, and every open hold on it closes.
 */
export async function resolveHold(
  env: Env,
  id: string,
  action: "release" | "void",
  now: string,
): Promise<ResolveResult> {
  const flag = (await listFlags(env)).find((f) => f.id === id);
  if (!flag) return { ok: false, status: 404, error: "unknown_flag" };
  if (!flag.hold) return { ok: false, status: 409, error: "not_a_hold" };
  if (flag.status !== "open") return { ok: false, status: 409, error: `already_${flag.status}` };
  if (flag.credit?.state !== "pending")
    return { ok: false, status: 409, error: `credit_${flag.credit?.state ?? "missing"}` };

  if (action === "release") {
    await env.DB.prepare(
      "UPDATE review_flags SET status = 'released', resolved_at = ? WHERE id = ? AND status = 'open'",
    )
      .bind(now, id)
      .run();
  } else {
    const before = await loadCredits(env);
    const after = before.map((c) =>
      c.id === flag.creditId && c.state === "pending"
        ? { ...c, state: "voided" as const, voidReason: "review" as const }
        : c,
    );
    await persistCredits(env, before, after, now);
    await env.DB.prepare(
      `UPDATE review_flags SET status = 'voided', resolved_at = ?
       WHERE credit_id = ? AND status = 'open' AND reason IN (${HOLDS_SQL})`,
    )
      .bind(now, flag.creditId)
      .run();
  }
  const updated = (await listFlags(env)).find((f) => f.id === id) as FlagView;
  return { ok: true, flag: updated };
}
