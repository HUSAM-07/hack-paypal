import { app as catalogue } from "@cited/catalogue-mcp";
import {
  createConsoleApp,
  createEngineClient,
  parseRunRecords,
  type RunSource,
} from "@cited/console";
import { app as engine } from "@cited/engine";
import { createShopsApp } from "@cited/shops";
import { createMockPayPal } from "@pact/paypal";
import type { Context } from "hono";
import { citedEnv } from "./cited";
import type { Env } from "./env";

/**
 * The CITED demo apps (shops, catalogue, console) mounted inside pact-worker next to the
 * engine, so a judge gets one clickable link. They call the engine in-process: a workers.dev
 * worker can't fetch its own account's workers.dev URLs (Cloudflare error 1042).
 *
 * Shops (with the simulated PayPal's orders) and the catalogue (its demo clock) keep state in
 * memory, and Cloudflare spreads requests over many isolates. Both therefore run inside one
 * Durable Object instance (CitedDemoDO), the only place that memory is shared.
 */
export const SHOPS_PREFIX = "/shops";
export const CATALOGUE_PREFIX = "/catalogue";
export const CONSOLE_PREFIX = "/console";

type Ctx = Context<{ Bindings: Env }>;
export type ExecCtx = Ctx["executionCtx"];

/** Every mounted app's routes start at "/"; strip the prefix before handing the request over. */
function strip(req: Request, prefix: string): Request {
  const url = new URL(req.url);
  url.pathname = url.pathname.slice(prefix.length) || "/";
  return new Request(url, req);
}

/** Our apps' HTML uses root-relative links; mounted under a prefix they need it too. */
export function prefixLinks(html: string, prefix: string): string {
  return html
    .replaceAll('href="/', `href="${prefix}/`)
    .replaceAll('const base="/"+cfg.shop', `const base="${prefix}/"+cfg.shop`);
}

/**
 * The demo pages inline their CSS and scripts, so they get their own policy instead of the
 * API's `default-src 'none'` (these routes are registered before securityHeaders).
 */
export const DEMO_PAGE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.paypal.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.paypal.com; frame-src https://*.paypal.com; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

async function asDemoPage(res: Response, prefix: string): Promise<Response> {
  const html = res.headers.get("content-type")?.includes("text/html");
  const out = new Response(html ? prefixLinks(await res.text(), prefix) : res.body, res);
  out.headers.set("Content-Security-Policy", DEMO_PAGE_CSP);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return out;
}

/** The engine as a fetch function, so in-process callers keep their HTTP-shaped clients. */
function engineFetch(env: Env, ctx: ExecCtx): typeof fetch {
  return async (input, init) =>
    engine.fetch(new Request(input, init), citedEnv(env), ctx) as Promise<Response>;
}

let shops: ReturnType<typeof createShopsApp> | undefined;

function shopsFor(env: Env, ctx: ExecCtx) {
  if (shops) return shops;
  const mode = env.CITED_PAYPAL_MODE ?? env.PAYPAL_MODE;
  const shopEnv = {
    PAYPAL_MODE: mode,
    PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET,
    MODEL_PROVIDER: "fake",
  };
  if (mode === "sandbox") {
    shops = createShopsApp({ env: shopEnv });
    return shops;
  }
  // Simulated: the mock signs captures and refunds as webhooks and delivers them straight to
  // the engine, the way PayPal would.
  const mock = createMockPayPal({ autoSettlePayouts: true, deliverFetch: engineFetch(env, ctx) });
  mock.registerWebhook("https://engine.internal/webhooks/paypal");
  shops = createShopsApp({ env: shopEnv, mock });
  return shops;
}

/** Runs inside CitedDemoDO: the stateful demo apps, by path prefix. */
export async function serveStatefulDemo(req: Request, env: Env, ctx: ExecCtx): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path === SHOPS_PREFIX || path.startsWith(`${SHOPS_PREFIX}/`)) {
    return asDemoPage(await shopsFor(env, ctx).fetch(strip(req, SHOPS_PREFIX)), SHOPS_PREFIX);
  }
  if (path === CATALOGUE_PREFIX || path.startsWith(`${CATALOGUE_PREFIX}/`)) {
    return catalogue.fetch(strip(req, CATALOGUE_PREFIX));
  }
  return new Response("not found", { status: 404 });
}

/** /shops/* and /catalogue/*: forwarded to the one demo Durable Object. */
export function statefulDemoHandler(c: Ctx): Promise<Response> {
  const ns = c.env.CITED_DEMO;
  return ns.get(ns.idFromName("demo")).fetch(c.req.raw);
}

/** Run records live in D1 (cited_agent_runs), one JSONL line per row. */
export function d1RunSource(db: D1Database): RunSource {
  return {
    async runs() {
      const { results } = await db
        .prepare("SELECT record FROM cited_agent_runs ORDER BY id")
        .all<{ record: string }>();
      return parseRunRecords(results.map((r) => r.record).join("\n"));
    },
  };
}

export async function consoleHandler(c: Ctx): Promise<Response> {
  const app = createConsoleApp({
    engine: createEngineClient({
      baseUrl: "https://engine.internal",
      fetch: engineFetch(c.env, c.executionCtx),
    }),
    runs: d1RunSource(c.env.DB),
  });
  return asDemoPage(await app.fetch(strip(c.req.raw, CONSOLE_PREFIX)), CONSOLE_PREFIX);
}
