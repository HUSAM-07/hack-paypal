import { app as engine, writeDenied } from "@cited/engine";
import type { Env as EngineEnv } from "@cited/engine/env";
import type { Context } from "hono";
import type { Env } from "./env";

/** Where the CITED engine is mounted in this worker. */
export const CITED_PREFIX = "/api/cited";

/**
 * Who is calling the engine. "public" is a request that came in over the internet; "internal"
 * is this worker's own server-side code (/try, Studio's approve, the console's reads), which
 * never sees or forwards a caller's credentials.
 */
export type Caller = "public" | "internal";

/**
 * Write access to CITED (the engine's write API and the catalogue's demo controls) fails
 * closed: a public write needs `Authorization: Bearer $CITED_API_TOKEN`, and with no token set
 * it is refused. Only CITED_OPEN_API=1 opens it keylessly, and only while no token is set; that
 * flag lives in .dev.vars, test bindings and the local demo stack, never in wrangler.jsonc.
 */
export function citedOpen(env: Env): boolean {
  return !env.CITED_API_TOKEN && env.CITED_OPEN_API === "1";
}

/**
 * The engine keeps its own settings so CITED can run against the PayPal sandbox while the
 * Pact placeholder stays simulated, and so its webhook subscription (a different URL, so a
 * different id) doesn't collide with Pact's. Internal callers get the open API in-process: the
 * flag is set on this server-side object, never read from a request.
 */
export function citedEnv(env: Env, caller: Caller = "public"): EngineEnv {
  return {
    DB: env.DB,
    PAYPAL_MODE: env.CITED_PAYPAL_MODE ?? env.PAYPAL_MODE,
    MODEL_PROVIDER: "fake",
    PASSPORT_KEY: env.CITED_PASSPORT_KEY,
    PAYPAL_WEBHOOK_ID: env.CITED_PAYPAL_WEBHOOK_ID,
    PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET,
    ENGINE_API_TOKEN: caller === "internal" ? undefined : env.CITED_API_TOKEN,
    ENGINE_OPEN_API: caller === "internal" || citedOpen(env) ? "1" : undefined,
  };
}

/** The same gate as the engine's, applied to any CITED write at the worker's edge. */
export function citedWriteDenied(env: Env, req: Request): Response | null {
  const denied = writeDenied(
    {
      ENGINE_API_TOKEN: env.CITED_API_TOKEN,
      ENGINE_OPEN_API: citedOpen(env) ? "1" : undefined,
    },
    req.method,
    req.headers.get("authorization") ?? undefined,
  );
  return denied ? Response.json({ error: denied.error }, { status: denied.status }) : null;
}

type Ctx = Context<{ Bindings: Env }>;

/** Hands a /api/cited/* request to the engine with the prefix stripped. */
export function serveEngine(
  req: Request,
  env: Env,
  ctx: Ctx["executionCtx"],
  caller: Caller = "public",
): Response | Promise<Response> {
  const url = new URL(req.url);
  url.pathname = url.pathname.slice(CITED_PREFIX.length) || "/";
  return engine.fetch(new Request(url, req), citedEnv(env, caller), ctx);
}

/** The engine's write API lives under /api/cited/api; webhooks are signature-checked instead. */
function isEngineApi(req: Request): boolean {
  const path = new URL(req.url).pathname;
  return path.startsWith(`${CITED_PREFIX}/api/`) || path === `${CITED_PREFIX}/api`;
}

/**
 * Public /api/cited/*. Writes are checked here and again by the engine (the demo Durable
 * Object's engine sees the same token), so neither layer alone can leave it open.
 *
 * Simulated PayPal lives in isolate memory (a deposit captured in one isolate can't be refunded
 * from another), so in simulated mode the engine runs inside the one demo Durable Object.
 * With real PayPal the state is PayPal's and D1's, and any isolate will do.
 */
export function citedHandler(c: Ctx): Response | Promise<Response> {
  if (isEngineApi(c.req.raw)) {
    const denied = citedWriteDenied(c.env, c.req.raw);
    if (denied) return denied;
  }
  if ((c.env.CITED_PAYPAL_MODE ?? c.env.PAYPAL_MODE) === "simulated") {
    return c.env.CITED_DEMO.get(c.env.CITED_DEMO.idFromName("demo")).fetch(c.req.raw);
  }
  return serveEngine(c.req.raw, c.env, c.executionCtx);
}

/**
 * The engine for this worker's own server-side code: in-process with real PayPal, else the demo
 * Durable Object over RPC (`internal`, which the internet cannot reach). No token is forwarded.
 */
export function internalEngineFetch(env: Env, ctx: Ctx["executionCtx"]): typeof fetch {
  const simulated = (env.CITED_PAYPAL_MODE ?? env.PAYPAL_MODE) === "simulated";
  return async (input, init) => {
    const given = new Request(input, init);
    const url = new URL(given.url);
    if (!url.pathname.startsWith(`${CITED_PREFIX}/`))
      url.pathname = `${CITED_PREFIX}${url.pathname}`;
    const req = new Request(url, given);
    req.headers.delete("authorization");
    if (!simulated) return serveEngine(req, env, ctx, "internal");
    return env.CITED_DEMO.get(env.CITED_DEMO.idFromName("demo")).internal(req);
  };
}
