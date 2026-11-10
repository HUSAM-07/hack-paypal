import { Hono } from "hono";
import { CITED_PREFIX, internalEngineFetch } from "../cited";
import { DEMO_PAGE_CSP } from "../cited-apps";
import type { Env } from "../env";
import { newId } from "../ids";
import { clientIp } from "../security";
import { tryPage } from "./page";
import { liveAgentChoice } from "./provider";
import { type LiveEvent, runLive } from "./run";

/** /try: a judge types a shopping request and watches a real agent buy through PayPal. */
export const TRY_PREFIX = "/try";

export const DEFAULT_LIVE_REQUEST =
  "Small bedroom purifier, light sleeper, around $100, just buy it";
/** Model runs per visitor per hour, and across everyone per day. Scripted runs cost nothing. */
export const LIVE_RUNS_PER_HOUR = 6;
export const LIVE_RUNS_PER_DAY = 300;

const INTERNAL = "https://demo.internal";

/** Salted so the stored hash can't be reversed by enumerating addresses. */
async function ipHash(ip: string, salt: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(d)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Plain text only: control characters out, whitespace collapsed, length capped. */
export function cleanRequest(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return s.length >= 3 && s.length <= 280 ? s : null;
}

const page = (body: string) =>
  new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Content-Security-Policy": DEMO_PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-cache",
    },
  });

export const live = new Hono<{ Bindings: Env }>();

live.get("/", (c) => {
  const choice = liveAgentChoice(c.env);
  return page(
    tryPage({
      request: DEFAULT_LIVE_REQUEST,
      agent: choice.label,
      scripted: choice.kind === "scripted",
    }),
  );
});

live.post("/run", async (c) => {
  const env = c.env;
  const ip = clientIp(c.req.raw);
  const { success } = await env.IP_LIMITER.limit({ key: `try:${ip}` });
  if (!success)
    return c.json({ error: "rate_limited", message: "Too many runs. Try again in a minute." }, 429);
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "forbidden" }, 403);

  const body = (await c.req.json().catch(() => null)) as { request?: unknown } | null;
  const request = cleanRequest(body?.request);
  if (!request)
    return c.json(
      { error: "bad_request", message: "Write a shopping request of 3 to 280 characters." },
      400,
    );

  const choice = liveAgentChoice(env);
  const hash = await ipHash(ip, env.SESSION_SECRET ?? "cited");
  if (choice.kind !== "scripted") {
    const mine = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM cited_live_runs WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')",
    )
      .bind(hash)
      .first<{ n: number }>();
    if ((mine?.n ?? 0) >= LIVE_RUNS_PER_HOUR)
      return c.json(
        {
          error: "rate_limited",
          message: `You've run ${LIVE_RUNS_PER_HOUR} agents this hour. Try again later.`,
        },
        429,
      );
    const all = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM cited_live_runs WHERE created_at > datetime('now', '-1 day')",
    ).first<{ n: number }>();
    if ((all?.n ?? 0) >= LIVE_RUNS_PER_DAY)
      return c.json(
        {
          error: "rate_limited",
          message: "Today's live runs are used up. The recorded demo is on the console.",
        },
        429,
      );
  }

  // The catalogue (and, simulated, the engine) live in the one demo Durable Object.
  const demo = env.CITED_DEMO.get(env.CITED_DEMO.idFromName("demo"));
  const toDemo: typeof fetch = (input, init) => demo.fetch(new Request(input, init));
  // Server-side engine access: internal, so /try needs no token and never handles one.
  const engineFetch = internalEngineFetch(env, c.executionCtx);

  const runId = newId("live");
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const emit = (e: LiveEvent) => writer.write(enc.encode(`data: ${JSON.stringify(e)}\n\n`));

  const work = (async () => {
    try {
      const record = await runLive({
        env,
        db: env.DB,
        emit,
        runId,
        request,
        endpoints: {
          catalogueUrl: `${INTERNAL}/catalogue`,
          catalogueFetch: toDemo,
          engineUrl: `${INTERNAL}${CITED_PREFIX}`,
          engineFetch,
        },
      });
      await env.DB.prepare(
        "INSERT INTO cited_live_runs (id, record, provider, ip_hash) VALUES (?, ?, ?, ?)",
      )
        .bind(runId, JSON.stringify(record), choice.kind, hash)
        .run();
    } catch (e) {
      console.error("live run crashed", runId, (e as Error).name);
      await emit({ type: "error", message: "The run crashed before it finished." }).catch(() => {});
      await emit({ type: "done" }).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  c.executionCtx.waitUntil(work);

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
