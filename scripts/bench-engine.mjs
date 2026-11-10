#!/usr/bin/env node
/**
 * Benchmark of the CITED engine at affiliate-network volume (`npm run bench:cited`).
 *
 * 1. Pure maths (`@pact/attribution`) in process at 1M sales: lift + attributable fraction at
 *    the 80% lower bound, Shapley over 1-4 co-exposed creators, createCredits, releasePayable.
 * 2. The engine the way it is deployed: `wrangler dev` of pact-worker on a fresh local D1,
 *    CITED_OPEN_API=1, simulated PayPal. N agent sessions across arms and 3 models, then their
 *    order + signed-passport capture webhooks at a fixed concurrency, ~2% refunds and ~0.5%
 *    disputes, then recompute, payouts and cycle close. Every step is timed and the result is
 *    checked: the ledger matches mock PayPal to the cent, every refund voids exactly its
 *    credits, and no credit is paid inside its 30-day hold.
 *
 * Runs under tsx so it can import the workspace's TypeScript packages:
 *   npm run bench:cited -- --sessions 10000 --concurrency 32
 *   npm run bench:cited -- --sessions 1000,10000,50000 --json cited/bench-results.json
 *   npm run bench:cited -- --pure-only        (skip wrangler)
 *   npm run bench:cited -- --engine-only
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import {
  attributableFraction,
  computeLift,
  createCredits,
  creditBrand,
  releasePayable,
  shapleyValues,
  splitCommission,
} from "@pact/attribution";
import { signPassport } from "@pact/protocol";

const ROOT = resolve(import.meta.dirname, "..");
const WORKER = join(ROOT, "apps/worker");
const PASSPORT_KEY = "cited-dev-passport-key"; // the published dev key in wrangler.jsonc
const MODELS = ["gpt", "gemini", "sonnet"];
const PAYOUT_ITEM_LIMIT = 15_000;

// ───────────────────────── args ─────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const SIZES = opt("sessions", "10000")
  .split(",")
  .map((s) => Number(s.replace(/k$/i, "000")));
const CONCURRENCY = Number(opt("concurrency", "32"));
const CREATORS = Number(opt("creators", "24"));
const PURE_N = Number(opt("pure", "1000000"));
const PORT = Number(opt("port", "8797"));
const JSON_OUT = opt("json", "");
const SEED = Number(opt("seed", "7"));

// ───────────────────────── helpers ─────────────────────────

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
const ms = (x) => Math.round(x * 10) / 10;
function stats(latencies, wallMs) {
  const s = [...latencies].sort((a, b) => a - b);
  return {
    count: s.length,
    wallMs: ms(wallMs),
    perSec: Math.round((s.length / wallMs) * 1000),
    p50: ms(pct(s, 50)),
    p95: ms(pct(s, 95)),
    p99: ms(pct(s, 99)),
    max: ms(s.at(-1) ?? 0),
  };
}
const time = async (fn) => {
  const t = performance.now();
  const value = await fn();
  return { value, ms: ms(performance.now() - t) };
};
const log = (...a) => console.log(...a);

// ───────────────────────── 1. pure functions at 1M ─────────────────────────

function benchPure(n) {
  const r = rng(SEED);
  const out = {};

  // Lift, lower bound and attributable fraction: 1M sessions tallied into 3 model strata.
  {
    const t = performance.now();
    const strata = MODELS.map((model) => ({
      model,
      exposed: { sessions: 0, purchases: 0 },
      placebo: { sessions: 0, purchases: 0 },
    }));
    let exposedSales = 0;
    for (let i = 0; i < n; i++) {
      const m = strata[i % 3];
      if (r() < 0.6) {
        m.exposed.sessions++;
        if (r() < 0.2) {
          m.exposed.purchases++;
          exposedSales++;
        }
      } else {
        m.placebo.sessions++;
        if (r() < 0.12) m.placebo.purchases++;
      }
    }
    const tally = performance.now() - t;
    const t2 = performance.now();
    const lift = computeLift(strata);
    const fraction = attributableFraction(lift.lowerBound, lift.exposedRate);
    const credit = creditBrand({
      strata,
      exposedSales,
      unitPrice: { amountMinor: 9599, currency: "USD" },
    });
    out.lift = {
      sessions: n,
      tallyMs: ms(tally),
      liftMs: ms(performance.now() - t2),
      lowerBound: Number(lift.lowerBound.toFixed(5)),
      fraction: Number(fraction.toFixed(5)),
      units: credit.units,
    };
    // The same three calls 1M times (one brand evaluation per sale, the worst case).
    const t3 = performance.now();
    for (let i = 0; i < n; i++) {
      const l = computeLift(strata);
      attributableFraction(l.lowerBound, l.exposedRate);
    }
    out.lift.repeatedMs = ms(performance.now() - t3);
  }

  // Shapley split over 1-4 co-exposed creators, 1M sales.
  {
    const value = (subset) => (subset.length ? 0.04 * subset.length + 0.01 * subset[0].length : 0);
    const byK = {};
    for (const k of [1, 2, 3, 4]) {
      const creators = ["ava", "ben", "cy", "dee"].slice(0, k);
      const t = performance.now();
      for (let i = 0; i < n; i++)
        splitCommission({ amountMinor: 768, currency: "USD" }, creators, value);
      byK[k] = ms(performance.now() - t);
    }
    shapleyValues(["ava", "ben", "cy", "dee"], value);
    out.shapley = { sales: n, msByCoExposed: byK };
  }

  // createCredits + releasePayable over 1M exposed sales (24 creators, 1-4 per sale).
  {
    const creators = Array.from({ length: CREATORS }, (_, i) => `cr${i}`);
    const base = Date.parse("2026-10-01T00:00:00Z");
    const sales = [];
    for (let i = 0; i < n; i++) {
      const k = 1 + Math.floor(r() * 4);
      const seen = new Set();
      while (seen.size < k) seen.add(creators[Math.floor(r() * creators.length)]);
      sales.push({
        captureId: `CAP${String(i).padStart(8, "0")}`,
        orderId: `O${i}`,
        shopId: "shop",
        upc: "012345678905",
        amount: { amountMinor: 2000 + Math.floor(r() * 10_000), currency: "USD" },
        sessionId: `s${i}`,
        arm: "test",
        creatorsSeen: [...seen],
        model: MODELS[i % 3],
        capturedAt: new Date(base + i * 1000).toISOString(),
      });
    }
    const memo = new Map();
    const v = (subset) => {
      const key = subset.join("+");
      let x = memo.get(key);
      if (x === undefined) {
        x = subset.length * 0.03;
        memo.set(key, x);
      }
      return x;
    };
    const t = performance.now();
    const credits = createCredits({
      sales,
      brands: [
        {
          brandId: "b",
          upc: "012345678905",
          units: Math.floor(n * 0.4),
          deposit: {
            brandId: "b",
            category: "c",
            deposited: { amountMinor: 1e13, currency: "USD" },
            returned: { amountMinor: 0, currency: "USD" },
          },
        },
      ],
      coalitionValue: () => v,
    });
    const createMs = performance.now() - t;
    const t2 = performance.now();
    const lines = releasePayable(credits, "2027-01-01T00:00:00Z");
    out.ledger = {
      sales: n,
      credits: credits.length,
      createCreditsMs: ms(createMs),
      releasePayableMs: ms(performance.now() - t2),
      payoutLines: lines.length,
    };
  }
  return out;
}

// ───────────────────────── 2. engine under wrangler dev ─────────────────────────

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

async function startWorker(state) {
  mkdirSync(join(ROOT, "apps/web/dist"), { recursive: true }); // assets dir; empty is enough
  run(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "pact", "--local", "--persist-to", state],
    WORKER,
  );
  const child = spawn(
    "npx",
    ["wrangler", "dev", "--port", String(PORT), "--var", "CITED_OPEN_API:1", "--persist-to", state],
    { cwd: WORKER, detached: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let err = "";
  child.stderr.on("data", (d) => {
    err = (err + d).slice(-4000);
  });
  const base = `http://127.0.0.1:${PORT}/api/cited`;
  for (let i = 0; i < 240; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return { base, stop: () => killGroup(child) };
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  killGroup(child);
  throw new Error(`wrangler dev never became healthy:\n${err}`);
}

function killGroup(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
}

function openDb(state) {
  const dir = join(state, "v3/d1/miniflare-D1DatabaseObject");
  const file = readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).size - statSync(a).size)[0];
  return new DatabaseSync(file, { readOnly: true });
}

async function call(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** Send every job at `concurrency` in flight; returns per-request latencies and wall time. */
async function pool(jobs, concurrency, send) {
  const lat = new Array(jobs.length);
  let next = 0;
  let failures = 0;
  let firstError;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        const t = performance.now();
        try {
          await send(jobs[i]);
        } catch (e) {
          failures++;
          firstError ??= e;
        }
        lat[i] = performance.now() - t;
      }
    }),
  );
  if (failures) throw new Error(`${failures}/${jobs.length} requests failed; first: ${firstError}`);
  return stats(lat, performance.now() - t0);
}

const BRANDS = [
  { brandId: "bench-audio", name: "Bench Audio", category: "headphones", upc: "190000000011" },
  { brandId: "bench-run", name: "Bench Run", category: "running-shoes", upc: "190000000028" },
  { brandId: "bench-brew", name: "Bench Brew", category: "coffee", upc: "190000000035" },
];
const OTHER_UPC = "190000000042"; // a SKU no brand funds: recorded, never credited
const money = (minor) => ({ value: (minor / 100).toFixed(2), currency_code: "USD" });

/** The world: sessions, purchases, refunds and disputes, all deterministic from the seed. */
async function genWorld(n, t0) {
  const r = rng(SEED * 1000 + n);
  const creators = Array.from({ length: CREATORS }, (_, i) => `bc${i}`);
  const perCategory = Object.fromEntries(
    BRANDS.map((b, j) => [b.category, creators.filter((_, i) => i % BRANDS.length === j)]),
  );
  const sessions = [];
  const sales = [];
  for (let i = 0; i < n; i++) {
    const brand = BRANDS[Math.floor(r() * BRANDS.length)];
    const u = r();
    const arm = u < 0.5 ? "test" : u < 0.75 ? "placebo" : "none";
    const pool = perCategory[brand.category];
    const k = arm === "none" ? 0 : 1 + Math.floor(r() * 4);
    const seen = new Set();
    while (seen.size < Math.min(k, pool.length)) seen.add(pool[Math.floor(r() * pool.length)]);
    const s = {
      sessionId: `bs${i}`,
      model: MODELS[i % MODELS.length],
      arm,
      category: brand.category,
      creatorsSeen: [...seen].sort(),
      storesViewed: ["shopA"],
      createdAt: new Date(t0 - (n - i) * 60).toISOString(),
    };
    sessions.push(s);
    const buyRate = arm === "test" ? 0.2 : 0.12;
    if (r() >= buyRate) continue;
    const upc = r() < 0.9 ? brand.upc : OTHER_UPC;
    const amountMinor = 2_000 + Math.floor(r() * 10_000);
    const passport = await signPassport(
      {
        v: 1,
        sessionId: s.sessionId,
        arm,
        creatorsSeen: s.creatorsSeen,
        storesViewed: s.storesViewed,
      },
      PASSPORT_KEY,
    );
    sales.push({
      orderId: `BO${String(i).padStart(7, "0")}`,
      captureId: `BC${String(i).padStart(7, "0")}`,
      upc,
      amountMinor,
      passport,
      payerId: `BUYER${String(i).padStart(7, "0")}`,
      shop: r() < 0.5 ? "shopA" : "shopB",
      capturedAt: new Date(t0 - (n - i) * 30).toISOString(),
      arm,
    });
  }
  // ~2% refunds (a quarter of them partial) and ~0.5% disputes on distinct captures. Drawn from
  // exposed-arm sales of a funded SKU first, the ones that carry credits, so the void checks bite.
  const creditable = (s) => s.arm === "test" && s.upc !== OTHER_UPC;
  const order = sales
    .map((_, i) => i)
    .sort(() => r() - 0.5)
    .sort((a, b) => Number(creditable(sales[b])) - Number(creditable(sales[a])));
  const nRefund = Math.round(sales.length * 0.02);
  const nDispute = Math.round(sales.length * 0.005);
  const refunds = order.slice(0, nRefund).map((i, j) => {
    const s = sales[i];
    const partial = j % 4 === 0;
    return {
      id: `BR${s.captureId}`,
      captureId: s.captureId,
      amountMinor: partial ? Math.floor(s.amountMinor / 2) : s.amountMinor,
      partial,
    };
  });
  const outcomes = ["RESOLVED_BUYER_FAVOUR", "RESOLVED_SELLER_FAVOUR", null];
  const disputes = order.slice(nRefund, nRefund + nDispute).map((i, j) => ({
    id: `PP-D-${sales[i].captureId}`,
    captureId: sales[i].captureId,
    amountMinor: sales[i].amountMinor,
    outcome: outcomes[j % 3],
  }));
  return { creators, sessions, sales, refunds, disputes };
}

let evt = 0;
const event = (event_type, resource) =>
  JSON.stringify({
    id: `WH-BENCH-${String(++evt).padStart(9, "0")}`,
    event_type,
    resource_type: "bench",
    create_time: new Date().toISOString(),
    resource,
  });

const orderEvent = (s) =>
  event("CHECKOUT.ORDER.COMPLETED", {
    id: s.orderId,
    status: "COMPLETED",
    payer: { payer_id: s.payerId },
    purchase_units: [
      {
        reference_id: s.shop,
        custom_id: s.passport,
        amount: money(s.amountMinor),
        items: [
          {
            name: "Bench SKU",
            quantity: "1",
            unit_amount: money(s.amountMinor),
            upc: { type: "UPC-A", code: s.upc },
          },
        ],
      },
    ],
  });

const captureEvent = (s) =>
  event("PAYMENT.CAPTURE.COMPLETED", {
    id: s.captureId,
    status: "COMPLETED",
    amount: money(s.amountMinor),
    custom_id: s.passport,
    create_time: s.capturedAt,
    supplementary_data: { related_ids: { order_id: s.orderId } },
  });

const refundEvent = (x) =>
  event("PAYMENT.CAPTURE.REFUNDED", {
    id: x.id,
    status: "COMPLETED",
    amount: money(x.amountMinor),
    links: [
      {
        rel: "up",
        href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${x.captureId}`,
      },
    ],
  });

const disputeEvent = (d, type) =>
  event(type, {
    dispute_id: d.id,
    status: type.endsWith("RESOLVED") ? "RESOLVED" : "OPEN",
    dispute_amount: money(d.amountMinor),
    ...(type.endsWith("RESOLVED") ? { dispute_outcome: { outcome_code: d.outcome } } : {}),
    disputed_transactions: [{ seller_transaction_id: d.captureId }],
  });

async function benchEngine(n) {
  const state = mkdtempSync(join(os.tmpdir(), "cited-bench-"));
  log(`\n▶ engine @ ${n.toLocaleString()} sessions (state ${state})`);
  const { base, stop } = await startWorker(state);
  const out = { sessions: n, concurrency: CONCURRENCY, creators: CREATORS };
  const webhook = (raw) =>
    fetch(`${base}/webhooks/paypal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }).then(async (res) => {
      if (!res.ok) throw new Error(`webhook ${res.status} ${await res.text()}`);
      return res.json();
    });
  try {
    const t0 = Date.parse((await call(base, "GET", "/api/clock")).now);
    const w = await genWorld(n, t0);
    out.sales = w.sales.length;
    out.refunds = w.refunds.length;
    out.disputes = w.disputes.length;
    log(
      `  ${w.sales.length} sales, ${w.refunds.length} refunds, ${w.disputes.length} disputes, ${CREATORS} creators`,
    );

    // Setup: brands, creators (with PayPal ids, so they can be paid), $1M deposit each.
    for (const b of BRANDS) await call(base, "POST", "/api/brands", b);
    await pool(w.creators, CONCURRENCY, (id) =>
      call(base, "POST", "/api/creators", {
        creatorId: id,
        name: id,
        paypalId: `PP${id.toUpperCase()}`,
      }),
    );
    for (const b of BRANDS)
      await call(base, "POST", `/api/brands/${b.brandId}/deposits`, { amountMinor: 100_000_000 });

    out.sessionReports = await pool(w.sessions, CONCURRENCY, (s) =>
      call(base, "POST", "/api/sessions", s),
    );
    log("  sessions reported", out.sessionReports);

    out.orderWebhooks = await pool(w.sales, CONCURRENCY, (s) => webhook(orderEvent(s)));
    log("  order webhooks  ", out.orderWebhooks);
    out.captureWebhooks = await pool(w.sales, CONCURRENCY, (s) => webhook(captureEvent(s)));
    log("  capture+join    ", out.captureWebhooks);

    // PayPal redelivers: 1% of captures again, each with the same event id. None may double.
    const dupes = w.sales.filter((_, i) => i % 100 === 0);
    const redeliver = dupes.map((s) => ({ s, raw: captureEvent(s) }));
    for (const x of redeliver) await webhook(x.raw);
    out.duplicateWebhooks = await pool(redeliver, CONCURRENCY, async (x) => {
      const res = await webhook(x.raw);
      if (!res.duplicate) throw new Error("redelivery was not deduplicated");
    });

    out.recompute1 = await time(() => call(base, "POST", "/api/credits/recompute"));
    log(`  recompute       ${out.recompute1.ms} ms (${out.recompute1.value.created} credits)`);
    out.recompute1 = { ms: out.recompute1.ms, created: out.recompute1.value.created };

    // Refunds and disputes arrive after credits exist (the realistic order).
    out.refundWebhooks = await pool(w.refunds, CONCURRENCY, (x) => webhook(refundEvent(x)));
    log("  refund webhooks ", out.refundWebhooks);
    const resolved = w.disputes.filter((d) => d.outcome);
    out.disputeWebhooks = await pool(
      [...w.disputes.map((d) => () => webhook(disputeEvent(d, "CUSTOMER.DISPUTE.CREATED")))],
      CONCURRENCY,
      (f) => f(),
    );
    out.disputeResolved = await pool(resolved, CONCURRENCY, (d) =>
      webhook(disputeEvent(d, "CUSTOMER.DISPUTE.RESOLVED")),
    );
    log("  dispute webhooks", out.disputeWebhooks);

    const r2 = await time(() => call(base, "POST", "/api/credits/recompute"));
    out.recompute2 = { ms: r2.ms, created: r2.value.created };
    log(`  recompute again ${r2.ms} ms (${r2.value.created} new: idempotent)`);

    // Inside the hold: nothing may be paid.
    const early = await time(() => call(base, "POST", "/api/payouts/run"));
    out.payoutInsideHold = { ms: early.ms, status: early.value.status };
    log(`  payout in hold  ${early.ms} ms → ${early.value.status}`);

    const adv = await time(() => call(base, "POST", "/api/clock/advance", { days: 31 }));
    const p = adv.value.payout;
    out.payout = {
      ms: adv.ms,
      status: p.status,
      items: p.items.length,
      batches: p.batches?.length ?? (p.senderBatchId ? 1 : 0),
    };
    log(`  advance+payout  ${adv.ms} ms → ${p.status}, ${p.items.length} items`);

    const close = await time(() => call(base, "POST", "/api/cycle/close"));
    out.cycleClose = { ms: close.ms, brands: close.value.brands.length };
    log(`  cycle close     ${close.ms} ms`);

    const mock = await call(base, "GET", "/api/mock/state");
    out.checks = verify(openDb(state), w, mock, adv.value.now);
    log("  checks", out.checks);
    if (!out.checks.ok) throw new Error(`correctness checks failed: ${JSON.stringify(out.checks)}`);
    return out;
  } finally {
    stop();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(state, { recursive: true, force: true });
  }
}

/** The ledger against what the bench sent and what mock PayPal holds. */
function verify(db, w, mock, payoutAt) {
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const fails = [];

  const sales = one("SELECT COUNT(*) n, SUM(amount_minor) total FROM sales");
  const expected = w.sales.reduce((a, s) => a + s.amountMinor, 0);
  if (sales.n !== w.sales.length || sales.total !== expected)
    fails.push(`sales ${sales.n}/${sales.total} != sent ${w.sales.length}/${expected}`);
  const unattributed = one("SELECT COUNT(*) n FROM sales WHERE unattributed_reason IS NOT NULL").n;
  if (unattributed) fails.push(`${unattributed} signed sales left unattributed`);

  // Every refund voids exactly its own credits; nothing else is voided by a refund.
  const refunded = new Set(w.refunds.map((x) => x.captureId));
  const voidedByRefund = q(
    "SELECT capture_id, state, void_reason FROM credits WHERE void_reason IN ('refund','partial_refund')",
  );
  const strays = voidedByRefund.filter((c) => !refunded.has(c.capture_id));
  if (strays.length) fails.push(`${strays.length} credits voided by a refund they don't belong to`);
  const onRefunded = q(
    `SELECT c.capture_id, c.state, c.amount_minor, c.void_reason FROM credits c
     WHERE c.capture_id IN (${[...refunded].map(() => "?").join(",") || "''"})`,
    ...refunded,
  );
  const fullRefunds = new Set(w.refunds.filter((x) => !x.partial).map((x) => x.captureId));
  const notVoided = onRefunded.filter(
    (c) => fullRefunds.has(c.capture_id) && (c.state !== "voided" || c.void_reason !== "refund"),
  );
  if (notVoided.length)
    fails.push(`${notVoided.length} credits on fully refunded sales not voided`);
  const partialPaidWrong = onRefunded.filter(
    (c) =>
      !fullRefunds.has(c.capture_id) && c.state === "voided" && c.void_reason !== "partial_refund",
  );
  if (partialPaidWrong.length) fails.push(`${partialPaidWrong.length} partial refunds mis-voided`);

  // Disputes: buyer won → void; open → never paid; seller won → payable.
  const disputeBy = new Map(w.disputes.map((d) => [d.captureId, d.outcome]));
  for (const c of q(
    `SELECT capture_id, state, void_reason FROM credits
     WHERE capture_id IN (${[...disputeBy.keys()].map(() => "?").join(",") || "''"})`,
    ...disputeBy.keys(),
  )) {
    const o = disputeBy.get(c.capture_id);
    if (o === "RESOLVED_BUYER_FAVOUR" && c.state !== "voided")
      fails.push(`buyer-won ${c.capture_id} ${c.state}`);
    if (o === null && c.state === "paid") fails.push(`open dispute ${c.capture_id} paid`);
  }

  // No credit paid inside its hold.
  const early = one(
    "SELECT COUNT(*) n FROM credits WHERE state = 'paid' AND hold_until > ?",
    payoutAt,
  ).n;
  if (early) fails.push(`${early} credits paid inside their hold`);

  // Ledger == mock PayPal: paid credits vs batch items; deposit refunds vs refunds.
  const paid = one(
    "SELECT COUNT(*) n, COALESCE(SUM(amount_minor),0) total FROM credits WHERE state='paid'",
  );
  const items = mock.batches.flatMap((b) => b.items);
  const batchTotal = items.reduce((a, i) => a + i.amount.amountMinor, 0);
  if (paid.total !== batchTotal)
    fails.push(`paid credits ${paid.total} != payout items ${batchTotal}`);
  const oversize = mock.batches.filter((b) => b.items.length > PAYOUT_ITEM_LIMIT);
  if (oversize.length)
    fails.push(`${oversize.length} payout batches over ${PAYOUT_ITEM_LIMIT} items`);
  const depRefunds = one("SELECT COALESCE(SUM(amount_minor),0) t FROM deposit_refunds").t;
  const mockRefunds = mock.refunds.reduce((a, x) => a + x.amount.amountMinor, 0);
  if (depRefunds !== mockRefunds)
    fails.push(`deposit refunds ${depRefunds} != mock ${mockRefunds}`);
  const deposited = one("SELECT SUM(amount_minor) t FROM deposits").t;
  const pending = one(
    "SELECT COALESCE(SUM(amount_minor),0) t FROM credits WHERE state='pending'",
  ).t;
  if (deposited !== paid.total + pending + depRefunds)
    fails.push(
      `deposits ${deposited} != paid ${paid.total} + pending ${pending} + returned ${depRefunds}`,
    );

  const refundHits = one(
    `SELECT COUNT(DISTINCT capture_id) n FROM credits
     WHERE capture_id IN (${[...refunded].map(() => "?").join(",") || "''"})`,
    ...refunded,
  ).n;
  const credits = one("SELECT COUNT(*) n FROM credits").n;
  const byState = Object.fromEntries(
    q("SELECT state, COUNT(*) n FROM credits GROUP BY state").map((r) => [r.state, r.n]),
  );
  return {
    ok: fails.length === 0,
    fails,
    credits,
    refundedSalesWithCredits: refundHits,
    byState,
    paidMinor: paid.total,
    payoutItems: items.length,
    payoutBatches: mock.batches.length,
    returnedMinor: depRefunds,
  };
}

// ───────────────────────── main ─────────────────────────

const result = {
  machine: {
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memGb: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    wrangler: flag("pure-only") ? undefined : run("npx", ["wrangler", "--version"], WORKER).trim(),
  },
  at: new Date().toISOString(),
};
if (!flag("engine-only")) {
  log(`▶ pure functions @ ${PURE_N.toLocaleString()} sales`);
  result.pure = benchPure(PURE_N);
  log(JSON.stringify(result.pure, null, 2));
}
if (!flag("pure-only")) {
  result.engine = [];
  for (const n of SIZES) result.engine.push(await benchEngine(n));
}
if (JSON_OUT) writeFileSync(resolve(ROOT, JSON_OUT), `${JSON.stringify(result, null, 2)}\n`);
log("\n✔ bench done");
