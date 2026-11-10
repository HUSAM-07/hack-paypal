/**
 * Admin and read API. Reads (GET/HEAD) are public: AG Studio, the console and the landing
 * page show them. Writes need `Authorization: Bearer $ENGINE_API_TOKEN`; with no token they
 * answer 503 unless ENGINE_OPEN_API=1, which only local dev, tests and the worker's own
 * in-process callers set. Response shapes are documented in apps/engine/README.md.
 */
import { LIVE_CATEGORY } from "@pact/protocol";
import { Hono } from "hono";
import { z } from "zod";
import { advanceClock, nowOf } from "./clock";
import { brandBalances, frozenCaptures, loadStoredCredits, recomputeCredits } from "./credits";
import { closeCycle } from "./cycle";
import type { Env } from "./env";
import { brandLiftData, evaluateBrand } from "./lift";
import { payoutItemIds, refreshPayouts, runPayouts, senderItemId } from "./payouts";
import { getPayPal } from "./paypal";
import { captureDeposit, getBrand, listBrands, requestDeposit, upsertBrand } from "./programme";

export const api = new Hono<{ Bindings: Env }>();

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Fails closed: a write is allowed only with the right token, or when the caller opted in to
 * an open API on purpose. A missing setting can never open it.
 */
export function writeDenied(
  env: Pick<Env, "ENGINE_API_TOKEN" | "ENGINE_OPEN_API">,
  method: string,
  authorization: string | undefined,
): { status: 401 | 503; error: string } | null {
  if (READS.has(method.toUpperCase())) return null;
  const token = env.ENGINE_API_TOKEN;
  if (!token) return env.ENGINE_OPEN_API === "1" ? null : { status: 503, error: "writes_locked" };
  const got = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  return sameToken(got, token) ? null : { status: 401, error: "unauthorized" };
}

api.use("*", async (c, next) => {
  const denied = writeDenied(c.env, c.req.method, c.req.header("authorization"));
  if (denied) return c.json({ error: denied.error }, denied.status);
  return next();
});

const Short = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/);
const Upc = z.string().regex(/^\d{12}$/);
const Cur = z.string().regex(/^[A-Z]{3}$/);
const Minor = z.number().int().positive();

async function body<T extends z.ZodType>(c: { req: { text(): Promise<string> } }, schema: T) {
  let raw: unknown;
  try {
    const text = await c.req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { error: "invalid_json" as const };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { data: parsed.data as z.infer<T> }
    : {
        error: "invalid_body" as const,
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
}

const finite = (n: number) => (Number.isFinite(n) ? n : null);
type Row = Record<string, unknown>;

// ───────────────────────── setup (writes) ─────────────────────────

api.post("/brands", async (c) => {
  const r = await body(
    c,
    z.object({
      brandId: Short,
      name: z.string().min(1).max(80),
      category: z.string().min(1).max(40),
      upc: Upc,
      currency: Cur.default("USD"),
    }),
  );
  if ("error" in r) return c.json(r, 400);
  await upsertBrand(c.env, r.data);
  return c.json(r.data, 201);
});

api.post("/creators", async (c) => {
  const r = await body(
    c,
    z.object({
      creatorId: Short,
      name: z.string().min(1).max(80),
      paypalId: z.string().min(1).max(40).optional(),
    }),
  );
  if ("error" in r) return c.json(r, 400);
  await c.env.DB.prepare(
    `INSERT INTO creators (creator_id, name, paypal_id) VALUES (?, ?, ?)
     ON CONFLICT (creator_id) DO UPDATE SET name = excluded.name, paypal_id = excluded.paypal_id`,
  )
    .bind(r.data.creatorId, r.data.name, r.data.paypalId ?? null)
    .run();
  return c.json(r.data, 201);
});

api.post("/listings", async (c) => {
  const r = await body(
    c,
    z.object({
      listings: z
        .array(
          z.object({
            shopId: Short,
            upc: Upc,
            priceMinor: z.number().int().nonnegative(),
            currency: Cur,
          }),
        )
        .min(1)
        .max(500),
    }),
  );
  if ("error" in r) return c.json(r, 400);
  await c.env.DB.batch(
    r.data.listings.map((l) =>
      c.env.DB.prepare(
        `INSERT INTO listings (shop_id, upc, price_minor, currency) VALUES (?, ?, ?, ?)
         ON CONFLICT (shop_id, upc) DO UPDATE SET price_minor = excluded.price_minor, currency = excluded.currency`,
      ).bind(l.shopId, l.upc, l.priceMinor, l.currency),
    ),
  );
  return c.json({ ok: true, count: r.data.listings.length }, 201);
});

/** The catalogue reports every session it assigns an arm to, bought or not: lift needs the denominators. */
api.post("/sessions", async (c) => {
  const r = await body(
    c,
    z.object({
      sessionId: Short,
      model: z.string().min(1).max(40),
      arm: z.enum(["test", "placebo", "none"]),
      category: z.string().min(1).max(40),
      creatorsSeen: z.array(Short).max(4).default([]),
      storesViewed: z.array(Short).max(4).default([]),
      createdAt: z.iso.datetime().optional(),
    }),
  );
  if ("error" in r) return c.json(r, 400);
  const s = r.data;
  await c.env.DB.prepare(
    `INSERT INTO agent_sessions (session_id, model, created_at, arm, category, creators_seen, stores_viewed)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET model = excluded.model, arm = excluded.arm,
       category = excluded.category, creators_seen = excluded.creators_seen,
       stores_viewed = excluded.stores_viewed`,
  )
    .bind(
      s.sessionId,
      s.model,
      s.createdAt ?? (await nowOf(c.env)),
      s.arm,
      s.category,
      JSON.stringify(s.creatorsSeen),
      JSON.stringify(s.storesViewed),
    )
    .run();
  return c.json({ ok: true }, 201);
});

// ───────────────────────── money (writes) ─────────────────────────

/** Fund a programme. Idempotent on `key` (default "initial"): a retry never charges twice. */
api.post("/brands/:brandId/deposits", async (c) => {
  const r = await body(
    c,
    z.object({ amountMinor: Minor, key: z.string().min(1).max(48).default("initial") }),
  );
  if ("error" in r) return c.json(r, 400);
  try {
    const row = await requestDeposit(c.env, {
      brandId: c.req.param("brandId"),
      amountMinor: r.data.amountMinor,
      kind: r.data.key === "initial" ? "initial" : "topup",
      key: r.data.key,
    });
    return c.json(row, row.status === "captured" ? 201 : 202);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

/** Sandbox only: finish a deposit after the brand approved the order at PayPal. */
api.post("/deposits/:orderId/capture", async (c) => {
  try {
    return c.json(await captureDeposit(c.env, c.req.param("orderId")));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

/** The approval: a brand manager accepted the Analyst's "raise the cap" recommendation. */
api.post("/approvals/:approvalId/approve", async (c) => {
  const r = await body(c, z.object({ brandId: Short, amountMinor: Minor }));
  if ("error" in r) return c.json(r, 400);
  try {
    const row = await requestDeposit(c.env, {
      brandId: r.data.brandId,
      amountMinor: r.data.amountMinor,
      kind: "topup",
      key: `approval-${c.req.param("approvalId")}`.slice(0, 48),
    });
    return c.json(row, row.status === "captured" ? 201 : 202);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

api.post("/credits/recompute", async (c) =>
  c.json(await recomputeCredits(c.env, await nowOf(c.env))),
);

/** Demo clock: jump forward, then pay out whatever the jump released from its 30-day hold. */
api.post("/clock/advance", async (c) => {
  const r = await body(
    c,
    z.union([
      z.object({ days: z.number().positive().max(3650) }),
      z.object({ to: z.iso.datetime() }),
    ]),
  );
  if ("error" in r) return c.json(r, 400);
  try {
    const now = await advanceClock(c.env, r.data);
    return c.json({ now, payout: await runPayouts(c.env) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

api.post("/payouts/run", async (c) => c.json(await runPayouts(c.env)));
api.post("/payouts/refresh", async (c) => {
  await refreshPayouts(c.env);
  return c.json({ ok: true });
});

/** End of cycle: return each brand's unspent deposit. */
api.post("/cycle/close", async (c) => {
  const r = await body(c, z.object({ brandIds: z.array(Short).optional() }).default({}));
  if ("error" in r) return c.json(r, 400);
  return c.json({ now: await nowOf(c.env), brands: await closeCycle(c.env, r.data.brandIds) });
});

// ───────────────────────── reads for AG Studio ─────────────────────────

api.get("/clock", async (c) => c.json({ now: await nowOf(c.env) }));

async function liftView(env: Env, brandId?: string) {
  const out = [];
  for (const brand of await listBrands(env)) {
    if (brandId && brand.brandId !== brandId) continue;
    const data = await brandLiftData(env, brand);
    const r = evaluateBrand(data);
    out.push({
      brandId: brand.brandId,
      name: brand.name,
      category: brand.category,
      upc: brand.upc,
      arms: data.arms,
      exposedRate: r.exposedRate,
      placeboRate: r.placeboRate,
      lift: r.lift,
      stdError: finite(r.stdError),
      lowerBound: finite(r.lowerBound),
      attributableFraction: r.fraction,
      exposedSales: data.exposedSales,
      causedUnits: r.units,
      perModel: r.perModel.map((m) => ({
        model: m.model,
        exposed: data.strata.find((s) => s.model === m.model)?.exposed,
        placebo: data.strata.find((s) => s.model === m.model)?.placebo,
        exposedRate: m.exposedRate,
        placeboRate: m.placeboRate,
        lift: m.lift,
        weight: m.weight,
      })),
    });
  }
  return out;
}

api.get("/lift", async (c) => c.json({ brands: await liftView(c.env) }));
api.get("/lift/:brandId", async (c) => {
  const [one] = await liftView(c.env, c.req.param("brandId"));
  return one ? c.json(one) : c.json({ error: "unknown_brand" }, 404);
});

api.get("/caused-units", async (c) =>
  c.json({
    skus: (await liftView(c.env)).map((b) => ({
      brandId: b.brandId,
      upc: b.upc,
      exposedSales: b.exposedSales,
      attributableFraction: b.attributableFraction,
      causedUnits: b.causedUnits,
      lowerBound: b.lowerBound,
    })),
  }),
);

api.get("/deposits", async (c) => {
  const refunds = (
    await c.env.DB.prepare("SELECT * FROM deposit_refunds ORDER BY created_at, id").all<Row>()
  ).results;
  const brands = (await brandBalances(c.env)).map(({ brand, rows, balance }) => ({
    brandId: brand.brandId,
    name: brand.name,
    category: brand.category,
    currency: brand.currency,
    deposited: balance.deposited.amountMinor,
    reserved: balance.reserved.amountMinor,
    spent: balance.spent.amountMinor,
    returned: balance.returned.amountMinor,
    available: balance.available.amountMinor,
    deposits: rows.map((d) => ({
      id: d.id,
      kind: d.kind,
      orderId: d.orderId,
      captureId: d.captureId,
      amountMinor: d.amountMinor,
      returnedMinor: d.returnedMinor,
      status: d.status,
      createdAt: d.createdAt,
    })),
    refunds: refunds
      .filter((r) => r.brand_id === brand.brandId)
      .map((r) => ({
        id: r.id,
        depositId: r.deposit_id,
        captureId: r.capture_id,
        refundId: r.refund_id,
        amountMinor: r.amount_minor,
        createdAt: r.created_at,
      })),
  }));
  return c.json({ brands });
});

api.get("/credits", async (c) => {
  const creatorFilter = c.req.query("creatorId");
  const credits = (await loadStoredCredits(c.env)).filter(
    (x) => !creatorFilter || x.creatorId === creatorFilter,
  );
  const names = new Map(
    (
      await c.env.DB.prepare("SELECT creator_id, name, paypal_id FROM creators").all<Row>()
    ).results.map((r) => [
      r.creator_id as string,
      { name: r.name as string, paypalLinked: !!r.paypal_id },
    ]),
  );
  const by = new Map<string, typeof credits>();
  for (const x of credits) by.set(x.creatorId, [...(by.get(x.creatorId) ?? []), x]);
  const sum = (xs: typeof credits, state: string) =>
    xs.filter((x) => x.state === state).reduce((a, x) => a + x.amount.amountMinor, 0);
  const flags = (await c.env.DB.prepare("SELECT * FROM review_flags ORDER BY credit_id").all<Row>())
    .results;
  const frozen = await frozenCaptures(c.env);
  const isFrozen = (x: (typeof credits)[number]) =>
    x.state === "pending" && frozen.has(x.captureId);
  return c.json({
    creators: [...by.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([creatorId, xs]) => ({
        creatorId,
        name: names.get(creatorId)?.name ?? creatorId,
        paypalLinked: names.get(creatorId)?.paypalLinked ?? false,
        totals: {
          pending: sum(xs, "pending"),
          voided: sum(xs, "voided"),
          paid: sum(xs, "paid"),
          /** Part of `pending`: held back by an open PayPal dispute. */
          frozen: xs.filter(isFrozen).reduce((a, x) => a + x.amount.amountMinor, 0),
        },
        credits: xs.map((x) => ({
          id: x.id,
          captureId: x.captureId,
          brandId: x.brandId,
          upc: x.upc,
          amountMinor: x.amount.amountMinor,
          currency: x.amount.currency,
          state: x.state,
          voidReason: x.voidReason ?? null,
          holdUntil: x.holdUntil,
          payoutBatchId: x.payoutBatchId ?? null,
          payoutStatus: x.payoutStatus,
          frozen: isFrozen(x),
        })),
      })),
    reviewFlags: flags.map((f) => ({
      creditId: f.credit_id,
      captureId: f.capture_id,
      reason: f.reason,
      payoutBatchId: f.payout_batch_id,
    })),
  });
});

/**
 * What CITED would do with a public /mcp sale. Those sales never reach the ledger (they would move
 * the study's numbers), so this says whether the arm makes it creditable, not that it was paid.
 */
function mcpVerdict(arm: unknown, creatorsSeen: string[]) {
  if (arm === "test") {
    return {
      creditable: true,
      reason: `Exposed arm: the agent was shown ${creatorsSeen.join(", ") || "a creator"}'s test, so CITED counts this sale toward the creator's caused units (kept out of the recorded study).`,
    };
  }
  return {
    creditable: false,
    reason:
      arm === "placebo"
        ? "Placebo arm: the agent saw other content from the same creator, not the test. Not credited."
        : "Held-out arm: the agent saw no creator content. Not credited.",
  };
}

async function journeys(env: Env, limit: number, source: "agent" | "mcp" = "agent") {
  const sales = (
    await env.DB.prepare(
      `SELECT x.*, s.stores_viewed AS stores_viewed FROM sales x
       LEFT JOIN agent_sessions s ON s.session_id = x.session_id
       WHERE x.unattributed_reason IS NULL AND x.source = ? AND COALESCE(s.category, '') != ?
       ORDER BY x.captured_at DESC, x.order_id LIMIT ?`,
    )
      .bind(source, LIVE_CATEGORY, limit * 4)
      .all<Row>()
  ).results;
  const prices = new Map(
    (await env.DB.prepare("SELECT * FROM listings").all<Row>()).results.map((r) => [
      `${r.shop_id}|${r.upc}`,
      r.price_minor as number,
    ]),
  );
  const credits = await loadStoredCredits(env);
  const orders = new Map<string, Row[]>();
  for (const r of sales)
    orders.set(r.order_id as string, [...(orders.get(r.order_id as string) ?? []), r]);

  return [...orders.entries()].slice(0, limit).map(([orderId, rows]) => {
    const first = rows[0] as Row;
    const viewed = JSON.parse((first.stores_viewed as string) ?? "[]") as string[];
    const captureIds = [...new Set(rows.map((r) => r.capture_id as string))];
    const cs = credits.filter((x) => captureIds.includes(x.captureId));
    const sumState = (state: string) =>
      cs.filter((x) => x.state === state).reduce((a, x) => a + x.amount.amountMinor, 0);
    const saved = rows.map((r) => {
      const chosen = prices.get(`${r.shop_id}|${r.upc}`);
      const listed = viewed
        .map((s) => prices.get(`${s}|${r.upc}`))
        .filter((p): p is number => p !== undefined);
      return chosen === undefined || listed.length === 0
        ? null
        : Math.max(0, Math.max(...listed) - chosen);
    });
    const known = saved.filter((n): n is number => n !== null);
    const holdStatus =
      cs.length === 0
        ? "none"
        : cs.every((x) => x.state === "voided")
          ? "voided"
          : cs.some((x) => x.state === "pending")
            ? "held"
            : "paid";
    const holds = cs
      .filter((x) => x.state === "pending")
      .map((x) => x.holdUntil)
      .sort();
    const splits = new Map<string, { creatorId: string; amountMinor: number; state: string }[]>();
    for (const x of cs)
      splits.set(x.captureId, [
        ...(splits.get(x.captureId) ?? []),
        { creatorId: x.creatorId, amountMinor: x.amount.amountMinor, state: x.state },
      ]);
    return {
      orderId,
      sessionId: first.session_id,
      model: first.model,
      arm: first.arm,
      storesViewed: viewed,
      storeChosen: first.shop_id,
      items: rows.map((r) => ({ upc: r.upc, amountMinor: r.amount_minor, currency: r.currency })),
      priceSavedMinor: known.length ? known.reduce((a, n) => a + n, 0) : null,
      commission: {
        pending: sumState("pending"),
        paid: sumState("paid"),
        voided: sumState("voided"),
      },
      holdStatus,
      holdUntil: holds[0] ?? null,
      shapley: [...splits.entries()].map(([captureId, shares]) => ({ captureId, shares })),
      capturedAt: first.captured_at,
      ...(source === "mcp"
        ? {
            source,
            verdict: mcpVerdict(first.arm, JSON.parse(first.creators_seen as string) as string[]),
          }
        : {}),
    };
  });
}

/** `?source=mcp` lists the public /mcp sales instead, each with its credit verdict. */
api.get("/journeys", async (c) =>
  c.json({
    journeys: await journeys(
      c.env,
      Math.min(200, Number(c.req.query("limit")) || 50),
      c.req.query("source") === "mcp" ? "mcp" : "agent",
    ),
  }),
);

/** Shapley splits per sale, flat: one row per (capture, creator). */
api.get("/shapley", async (c) => {
  const credits = await loadStoredCredits(c.env);
  const byCapture = new Map<string, typeof credits>();
  for (const x of credits) byCapture.set(x.captureId, [...(byCapture.get(x.captureId) ?? []), x]);
  return c.json({
    sales: [...byCapture.entries()].map(([captureId, xs]) => ({
      captureId,
      brandId: xs[0]?.brandId,
      upc: xs[0]?.upc,
      totalMinor: xs.reduce((a, x) => a + x.amount.amountMinor, 0),
      shares: xs.map((x) => ({
        creatorId: x.creatorId,
        amountMinor: x.amount.amountMinor,
        state: x.state,
        payoutBatchId: x.payoutBatchId ?? null,
      })),
    })),
  });
});

api.get("/payouts", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT * FROM payout_batches ORDER BY created_at, sender_batch_id",
    ).all<Row>()
  ).results;
  const batches = [];
  for (const r of rows) {
    const senderBatchId = r.sender_batch_id as string;
    const ids = r.paypal_batch_id
      ? await payoutItemIds(c.env, r.paypal_batch_id as string)
      : new Map<string, string>();
    const items = (JSON.parse(r.items_json as string) as { creatorId: string }[]).map((i) => {
      const payoutItemId = ids.get(senderItemId(i.creatorId, senderBatchId));
      return payoutItemId ? { ...i, payoutItemId } : i;
    });
    batches.push({
      senderBatchId,
      paypalBatchId: r.paypal_batch_id,
      status: r.status,
      items,
      createdAt: r.created_at,
    });
  }
  return c.json({ batches });
});

/** Simulated only: what the PayPal mock holds, so a run can check the ledger against it. */
api.get("/mock/state", (c) => {
  const { mock } = getPayPal(c.env);
  if (!mock) return c.json({ error: "not_available" }, 404);
  const { captures, refunds, batches } = mock.state;
  return c.json({
    captures: [...captures.values()].map((x) => ({
      id: x.id,
      orderId: x.orderId,
      amount: x.amount,
      refunded: x.refunded,
    })),
    refunds: [...refunds.values()].map((x) => ({
      id: x.id,
      captureId: x.captureId,
      amount: x.amount,
    })),
    batches: [...batches.values()].map((b) => ({
      id: b.id,
      senderBatchId: (b.header as Record<string, unknown>).sender_batch_id ?? null,
      status: b.status,
      items: b.items.map((i) => ({
        receiver: (i.req as Record<string, unknown>).receiver,
        recipientType: (i.req as Record<string, unknown>).recipient_type,
        amount: i.amount,
        status: i.status,
      })),
    })),
  });
});

api.get("/brands", async (c) => c.json({ brands: await listBrands(c.env) }));
api.get("/brands/:brandId", async (c) => {
  const b = await getBrand(c.env, c.req.param("brandId"));
  return b ? c.json(b) : c.json({ error: "unknown_brand" }, 404);
});
