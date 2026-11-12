/**
 * /console/ledger: a judge-facing page that runs the reconciliation checks against the live
 * engine's public read API and shows each one with its two numbers. Read-only: it only GETs
 * what the engine already serves publicly, and adds no write endpoint. The result is cached for
 * a few seconds (and dropped on any write), so many open tabs cost the engine one read set.
 */
import { type LedgerReport, type LedgerSnapshot, ledgerChecks } from "@pact/protocol";
import { Hono } from "hono";
import { internalEngineFetch } from "./cited";
import type { Env } from "./env";
import { ledgerPage } from "./ledger-page";
import { cachedRead } from "./read-cache";
import { ipRateLimit } from "./security";

export const LEDGER_PATH = "/console/ledger";
export const LEDGER_CHECKS_PATH = `${LEDGER_PATH}/checks.json`;
export const LEDGER_TTL_MS = 20_000;
const JOURNEYS_LIMIT = 200;

export interface LedgerResponse {
  generatedAt: string;
  /** "simulated" on the hosted demo: PayPal is our simulation of it, no real money moves. */
  paypalMode: string;
  report: LedgerReport;
}

const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** One public read of the engine; null when the engine does not serve it here. */
async function read(engine: typeof fetch, path: string): Promise<Record<string, unknown> | null> {
  const res = await engine(`https://engine.internal${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function loadSnapshot(engine: typeof fetch): Promise<LedgerSnapshot> {
  const [deposits, credits, payouts, invoices, journeys, mock] = await Promise.all([
    read(engine, "/api/deposits"),
    read(engine, "/api/credits"),
    read(engine, "/api/payouts"),
    read(engine, "/api/invoices"),
    read(engine, `/api/journeys?limit=${JOURNEYS_LIMIT}`),
    read(engine, "/api/mock/state"),
  ]);
  if (!deposits || !credits || !payouts) throw new Error("ledger reads unavailable");
  return {
    deposits,
    credits,
    payouts,
    invoices: invoices ?? undefined,
    journeys: journeys ?? undefined,
    mock,
    journeysLimit: JOURNEYS_LIMIT,
  };
}

export const ledger = new Hono<{ Bindings: Env }>();

ledger.get("/", (c) =>
  c.html(ledgerPage(), 200, {
    "Content-Security-Policy": PAGE_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-cache",
  }),
);

ledger.get("/checks.json", ipRateLimit, async (c) => {
  const load = async (): Promise<Response> => {
    try {
      const snapshot = await loadSnapshot(internalEngineFetch(c.env, c.executionCtx));
      const body: LedgerResponse = {
        generatedAt: new Date().toISOString(),
        paypalMode: c.env.CITED_PAYPAL_MODE ?? c.env.PAYPAL_MODE,
        report: ledgerChecks(snapshot),
      };
      return Response.json(body);
    } catch {
      return Response.json({ error: "engine_unavailable" }, { status: 503 });
    }
  };
  const res = await cachedRead(c.req.raw, load, { ttlMs: LEDGER_TTL_MS });
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "no-store");
  out.headers.set("X-Content-Type-Options", "nosniff");
  return out;
});
