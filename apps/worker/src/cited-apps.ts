import {
  type CatalogueApp,
  createCatalogueApp,
  createPublishedTests,
  type StoredTestRow,
} from "@cited/catalogue-mcp";
import {
  createConsoleApp,
  createEngineClient,
  parseRunRecords,
  type RunSource,
} from "@cited/console";
import { app as engine } from "@cited/engine";
import {
  createEngineApprover,
  createEngineProgrammeStarter,
  createEngineReader,
  createEngineReviewer,
  createStudioApp,
  studioLlmChoice,
} from "@cited/studio";
import { createMockPayPal } from "@pact/paypal";
import type { Context } from "hono";
import {
  type Caller,
  CITED_PREFIX,
  citedEnv,
  citedOpen,
  citedWriteDenied,
  internalEngineFetch,
  serveEngine,
  withReadRetry,
} from "./cited";
import type { Env } from "./env";
import { PUBLIC_MCP_PATH } from "./mcp";
import { cachedRead } from "./read-cache";
import { clientIp } from "./security";

/**
 * The CITED demo apps (catalogue, console) mounted inside pact-worker next to the engine, so a
 * judge gets one clickable link. They call the engine in-process: a workers.dev worker can't
 * fetch its own account's workers.dev URLs (Cloudflare error 1042).
 *
 * There are no storefronts: agents read offers from the catalogue (our mock of PayPal Store
 * Sync) and its `checkout` tool pays the seller through PayPal from the buyer's vaulted wallet.
 * The catalogue (its PayPal mock and demo clock) and the engine (its own simulated PayPal) keep
 * state in memory, and Cloudflare spreads requests over many isolates. In simulated mode they
 * therefore run inside one Durable Object instance (CitedDemoDO).
 */
export const CATALOGUE_PREFIX = "/catalogue";
export const CONSOLE_PREFIX = "/console";
export const STUDIO_PREFIX = "/studio";

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
  return html.replaceAll('href="/', `href="${prefix}/`);
}

/**
 * The demo pages inline their CSS and scripts, so they get their own policy instead of the
 * API's `default-src 'none'` (these routes are registered before securityHeaders).
 */
export const DEMO_PAGE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.paypal.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.paypal.com; frame-src https://*.paypal.com; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

/**
 * AG Studio is a bundled React app (apps/web/studio.html): no inline scripts. Its charts and
 * grids inject styles at runtime and draw to canvas, hence 'unsafe-inline' styles and blob:/data:
 * images. Everything else is same-origin.
 */
export const STUDIO_PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";

async function asDemoPage(res: Response, prefix: string, csp = DEMO_PAGE_CSP): Promise<Response> {
  const html = res.headers.get("content-type")?.includes("text/html");
  const out = new Response(html ? prefixLinks(await res.text(), prefix) : res.body, res);
  out.headers.set("Content-Security-Policy", csp);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return out;
}

/**
 * The engine in-process as a fetch function, so in-process callers keep their HTTP-shaped
 * clients. Used for reads (console, Studio) and the mock's signed webhooks; server-side only.
 */
function engineFetch(env: Env, ctx: ExecCtx): typeof fetch {
  const direct = (req: Request) =>
    withReadRetry(
      req,
      async (r) => engine.fetch(r, citedEnv(env, "internal"), ctx) as Promise<Response>,
    );
  // Reads are polled by every open console and Studio tab: share them for a few seconds (D1's
  // daily read limit). Webhook deliveries (POST) bypass it.
  return async (input, init) => cachedRead(new Request(input, init), direct);
}

/**
 * The catalogue's demo controls (seller refunds, mock disputes, the demo clock) move money in
 * the judged demo, so public callers need the CITED token. Shopping (`/mcp`, `/checkout`) stays
 * open like the public /mcp, and so do reads.
 */
const CATALOGUE_OPEN_WRITES = new Set([`${CATALOGUE_PREFIX}/mcp`, `${CATALOGUE_PREFIX}/checkout`]);

function catalogueWriteDenied(req: Request, env: Env): Response | null {
  if (CATALOGUE_OPEN_WRITES.has(new URL(req.url).pathname)) return null;
  return citedWriteDenied(env, req);
}

/**
 * What creators published at /creators, read from the engine in-process (never the shared read
 * cache: a creator who just published should see their test within seconds). The catalogue keeps
 * its own few-second copy, so a search costs no D1 read most of the time.
 */
function publishedTests(env: Env, ctx: ExecCtx) {
  return createPublishedTests(async () => {
    const res = await withReadRetry(
      new Request("https://engine.internal/api/tests"),
      async (r) => engine.fetch(r, citedEnv(env, "internal"), ctx) as Promise<Response>,
    );
    if (!res.ok) throw new Error(`published tests: ${res.status}`);
    return ((await res.json()) as { tests: StoredTestRow[] }).tests;
  });
}

let catalogue: CatalogueApp | undefined;

function catalogueFor(env: Env, ctx: ExecCtx): CatalogueApp {
  if (catalogue) return catalogue;
  const mode = env.CITED_PAYPAL_MODE ?? env.PAYPAL_MODE;
  const catalogueEnv = {
    PAYPAL_MODE: mode,
    PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET,
    PASSPORT_SIGNING_KEY: env.CITED_PASSPORT_KEY,
    CITED_BUYER_VAULT_ID: env.CITED_BUYER_VAULT_ID,
    CITED_SELLER_NORTHWIND_PAYEE: env.CITED_SELLER_NORTHWIND_PAYEE,
    CITED_SELLER_LUMEN_PAYEE: env.CITED_SELLER_LUMEN_PAYEE,
    CITED_SELLER_MEGAMART_PAYEE: env.CITED_SELLER_MEGAMART_PAYEE,
    MODEL_PROVIDER: "fake",
  };
  if (mode === "sandbox") {
    catalogue = createCatalogueApp({ env: catalogueEnv, published: publishedTests(env, ctx) });
    return catalogue;
  }
  // Simulated: the mock signs the agents' captures and the sellers' refunds as webhooks and
  // delivers them straight to the engine, the way PayPal would.
  // The object restarts when evicted while D1 keeps its sales, so ids start from the clock:
  // a reused capture id would be dropped by the engine's join as a duplicate.
  const mock = createMockPayPal({
    autoSettlePayouts: true,
    deliverFetch: engineFetch(env, ctx),
    idOffset: Date.now(),
  });
  mock.registerWebhook("https://engine.internal/webhooks/paypal");
  catalogue = createCatalogueApp({
    env: catalogueEnv,
    mock,
    published: publishedTests(env, ctx),
  });
  return catalogue;
}

/** Runs inside CitedDemoDO: the stateful demo apps, by path prefix. */
export async function serveStatefulDemo(
  req: Request,
  env: Env,
  ctx: ExecCtx,
  caller: Caller,
): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path === CATALOGUE_PREFIX || path.startsWith(`${CATALOGUE_PREFIX}/`)) {
    if (caller === "public") {
      const denied = catalogueWriteDenied(req, env);
      if (denied) return denied;
    }
    return catalogueFor(env, ctx).fetch(strip(req, CATALOGUE_PREFIX));
  }
  if (path.startsWith(`${CITED_PREFIX}/`)) return serveEngine(req, env, ctx, caller);
  // Reached only through the rate-limited /mcp mount (apps/worker/src/mcp.ts).
  if (path === PUBLIC_MCP_PATH) return catalogueFor(env, ctx).publicMcp.handle(req);
  return new Response("not found", { status: 404 });
}

/** /catalogue/*: forwarded to the one demo Durable Object (which checks writes again). */
export function statefulDemoHandler(c: Ctx): Response | Promise<Response> {
  const denied = catalogueWriteDenied(c.req.raw, c.env);
  if (denied) return denied;
  const ns = c.env.CITED_DEMO;
  return ns.get(ns.idFromName("demo")).fetch(c.req.raw);
}

/** Run records live in D1 (cited_agent_runs), one JSONL line per row. */
export function d1RunSource(db: D1Database): RunSource {
  return {
    async runs() {
      const read = () =>
        db.prepare("SELECT record FROM cited_agent_runs ORDER BY id").all<{ record: string }>();
      // One retry: D1 can refuse a read for a moment while the hosted reseed's import runs.
      const { results } = await read().catch(() =>
        new Promise((r) => setTimeout(r, 300)).then(read),
      );
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

/**
 * /studio/api/*: the Studio API (tables from the engine, the Analyst's model, Maya's approval).
 * /studio and /studio/creator: the AG Studio app, a static entry built by apps/web.
 */
export async function studioHandler(c: Ctx): Promise<Response> {
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith(`${STUDIO_PREFIX}/api/`) && path !== `${STUDIO_PREFIX}/health`) {
    // The assets binding serves studio.html at its pretty URL; the app routes by pathname.
    const res = await c.env.ASSETS.fetch(new URL("/studio", c.req.url));
    const out = new Response(res.body, res);
    out.headers.set("Content-Security-Policy", STUDIO_PAGE_CSP);
    out.headers.set("X-Content-Type-Options", "nosniff");
    out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    out.headers.set("Cache-Control", "no-cache");
    return out;
  }
  const env = c.env;
  // Maya's approval runs server-side: an internal write where the engine's PayPal lives.
  const engineWrite = internalEngineFetch(env, c.executionCtx);
  // Wherever CITED's writes are locked (the hosted demo), a visitor's Approve, Release and Void
  // stay in their own cookie: they see the effect, the shared ledger and its locked numbers
  // never move. Only a keyless local stack (CITED_OPEN_API=1) writes through to the engine.
  const privateWrites = citedOpen(env) ? undefined : { cookiePath: STUDIO_PREFIX };
  const app = createStudioApp({
    read: createEngineReader({
      baseUrl: "https://engine.internal",
      fetch: engineFetch(env, c.executionCtx),
    }),
    approve: createEngineApprover({ baseUrl: "https://engine.internal", fetch: engineWrite }),
    review: createEngineReviewer({ baseUrl: "https://engine.internal", fetch: engineWrite }),
    startProgramme: createEngineProgrammeStarter({
      baseUrl: "https://engine.internal",
      fetch: engineWrite,
    }),
    privateWrites,
    llm: studioLlmChoice(env),
    limit: async (req) => {
      const ip = clientIp(req);
      const mine = await env.IP_LIMITER.limit({ key: `studio-llm:${ip}` });
      if (!mine.success) return false;
      return (await env.IP_LIMITER.limit({ key: "studio-llm:all" })).success;
    },
    licenseKey: env.AG_STUDIO_LICENSE_KEY,
    gridLicenseKey: env.AG_GRID_LICENSE_KEY,
  });
  return app.fetch(strip(c.req.raw, STUDIO_PREFIX));
}
