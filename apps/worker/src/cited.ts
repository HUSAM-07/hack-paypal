import { app as engine } from "@cited/engine";
import type { Env as EngineEnv } from "@cited/engine/env";
import type { Context } from "hono";
import type { Env } from "./env";

/** Where the CITED engine is mounted in this worker. */
export const CITED_PREFIX = "/api/cited";

/**
 * The engine keeps its own settings so CITED can run against the PayPal sandbox while the
 * Pact placeholder stays simulated, and so its webhook subscription (a different URL, so a
 * different id) doesn't collide with Pact's.
 */
export function citedEnv(env: Env): EngineEnv {
  return {
    DB: env.DB,
    PAYPAL_MODE: env.CITED_PAYPAL_MODE ?? env.PAYPAL_MODE,
    MODEL_PROVIDER: "fake",
    PASSPORT_KEY: env.CITED_PASSPORT_KEY,
    PAYPAL_WEBHOOK_ID: env.CITED_PAYPAL_WEBHOOK_ID,
    PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET,
    ENGINE_API_TOKEN: env.CITED_API_TOKEN,
  };
}

type Ctx = Context<{ Bindings: Env }>;

/** Hands a /api/cited/* request to the engine with the prefix stripped. */
export function serveEngine(
  req: Request,
  env: Env,
  ctx: Ctx["executionCtx"],
): Response | Promise<Response> {
  const url = new URL(req.url);
  url.pathname = url.pathname.slice(CITED_PREFIX.length) || "/";
  return engine.fetch(new Request(url, req), citedEnv(env), ctx);
}

/**
 * Simulated PayPal lives in isolate memory (a deposit captured in one isolate can't be refunded
 * from another), so in simulated mode the engine runs inside the one demo Durable Object.
 * With real PayPal the state is PayPal's and D1's, and any isolate will do.
 */
export function citedHandler(c: Ctx): Response | Promise<Response> {
  if ((c.env.CITED_PAYPAL_MODE ?? c.env.PAYPAL_MODE) === "simulated") {
    return c.env.CITED_DEMO.get(c.env.CITED_DEMO.idFromName("demo")).fetch(c.req.raw);
  }
  return serveEngine(c.req.raw, c.env, c.executionCtx);
}
