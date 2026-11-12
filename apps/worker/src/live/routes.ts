import { type Context, Hono } from "hono";
import { CITED_PREFIX, internalEngineFetch } from "../cited";
import { DEMO_PAGE_CSP } from "../cited-apps";
import type { Env } from "../env";
import { newId } from "../ids";
import { clientIp } from "../security";
import {
  DEFAULT_CATEGORY_ID,
  parseCategory,
  TRY_CATEGORIES,
  type TryCategoryId,
  tryCategory,
} from "./categories";
import { tryPage } from "./page";
import { type LiveAgentChoice, liveAgentChoice } from "./provider";
import { type LiveEvent, type LiveRunRecord, runLive } from "./run";

/** /try: a judge types a shopping request and watches a real agent buy through PayPal. */
export const TRY_PREFIX = "/try";

export const DEFAULT_LIVE_REQUEST = tryCategory(DEFAULT_CATEGORY_ID).examples[0];
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
  // ?category= opens the page on a category; anything unknown is the default, purifiers.
  const category = parseCategory(c.req.query("category")) ?? DEFAULT_CATEGORY_ID;
  return page(
    tryPage({
      category,
      request: tryCategory(category).examples[0],
      agent: choice.label,
      scripted: choice.kind === "scripted",
    }),
  );
});

type LiveCtx = Context<{ Bindings: Env }>;
type Denied = { status: 400 | 403 | 429; body: { error: string; message?: string } };

/**
 * Origin, burst limit, request text and the model-run caps. `runs` is how many model runs the
 * request will start (a side-by-side pair is 2), so a pair can't slip past the hourly cap.
 */
async function admit(
  c: LiveCtx,
  runs: number,
): Promise<
  | { denied: Denied }
  | { request: string; category: TryCategoryId; hash: string; choice: LiveAgentChoice }
> {
  const env = c.env;
  const ip = clientIp(c.req.raw);
  const { success } = await env.IP_LIMITER.limit({ key: `try:${ip}` });
  if (!success)
    return {
      denied: {
        status: 429,
        body: { error: "rate_limited", message: "Too many runs. Try again in a minute." },
      },
    };
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin)
    return { denied: { status: 403, body: { error: "forbidden" } } };

  const body = (await c.req.json().catch(() => null)) as {
    request?: unknown;
    category?: unknown;
  } | null;
  const category = parseCategory(body?.category);
  if (!category)
    return {
      denied: {
        status: 400,
        body: {
          error: "bad_request",
          message: `Pick one of: ${TRY_CATEGORIES.map((x) => x.label.toLowerCase()).join(", ")}.`,
        },
      },
    };
  const request = cleanRequest(body?.request);
  if (!request)
    return {
      denied: {
        status: 400,
        body: { error: "bad_request", message: "Write a shopping request of 3 to 280 characters." },
      },
    };

  const choice = liveAgentChoice(env);
  const hash = await ipHash(ip, env.SESSION_SECRET ?? "cited");
  if (choice.kind !== "scripted") {
    const mine = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM cited_live_runs WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')",
    )
      .bind(hash)
      .first<{ n: number }>();
    if ((mine?.n ?? 0) + runs > LIVE_RUNS_PER_HOUR)
      return {
        denied: {
          status: 429,
          body: {
            error: "rate_limited",
            message:
              runs > 1
                ? `A side by side counts as ${runs} runs, and you have ${Math.max(0, LIVE_RUNS_PER_HOUR - (mine?.n ?? 0))} of ${LIVE_RUNS_PER_HOUR} left this hour. Try again later.`
                : `You've run ${LIVE_RUNS_PER_HOUR} agents this hour. Try again later.`,
          },
        },
      };
    const all = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM cited_live_runs WHERE created_at > datetime('now', '-1 day')",
    ).first<{ n: number }>();
    if ((all?.n ?? 0) + runs > LIVE_RUNS_PER_DAY)
      return {
        denied: {
          status: 429,
          body: {
            error: "rate_limited",
            message: "Today's live runs are used up. The recorded demo is on the console.",
          },
        },
      };
  }
  return { request, category, hash, choice };
}

/**
 * The catalogue (and, simulated, the engine) live in the one demo Durable Object. /try calls it
 * through the internal RPC, as a trusted caller: in sandbox mode only a trusted caller may pick
 * its session id, which is how the side-by-side fixes each lane's arm.
 */
function endpointsFor(c: LiveCtx) {
  const demo = c.env.CITED_DEMO.get(c.env.CITED_DEMO.idFromName("demo"));
  // RPC can't carry an AbortSignal (the MCP client sets one), so the request crosses without it.
  const toDemo: typeof fetch = (input, init) => {
    const r = new Request(input, init);
    return demo.internal(
      new Request(r.url, {
        method: r.method,
        headers: r.headers,
        ...(r.body ? { body: r.body } : {}),
      }),
    );
  };
  return {
    catalogueUrl: `${INTERNAL}/catalogue`,
    catalogueFetch: toDemo,
    engineUrl: `${INTERNAL}${CITED_PREFIX}`,
    // Server-side engine access: internal, so /try needs no token and never handles one.
    engineFetch: internalEngineFetch(c.env, c.executionCtx),
  };
}

/** An event stream fed by `work`, which keeps running (and is recorded) if the viewer leaves. */
function stream(
  c: LiveCtx,
  work: (emit: (e: unknown) => Promise<void>) => Promise<void>,
  onCrash: (emit: (e: unknown) => Promise<void>) => Promise<void>,
): Response {
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const emit = (e: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await work(emit);
      } catch (e) {
        console.error("live run crashed", (e as Error).name);
        await onCrash(emit).catch(() => {});
      } finally {
        await writer.close().catch(() => {});
      }
    })(),
  );
  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function record(c: LiveCtx, r: LiveRunRecord, kind: string, hash: string) {
  await c.env.DB.prepare(
    "INSERT INTO cited_live_runs (id, record, provider, ip_hash) VALUES (?, ?, ?, ?)",
  )
    .bind(r.runId, JSON.stringify(r), kind, hash)
    .run();
}

live.post("/run", async (c) => {
  const a = await admit(c, 1);
  if ("denied" in a) return c.json(a.denied.body, a.denied.status);
  const runId = newId("live");
  return stream(
    c,
    async (emit) => {
      const r = await runLive({
        env: c.env,
        db: c.env.DB,
        emit,
        runId,
        request: a.request,
        category: a.category,
        endpoints: endpointsFor(c),
      });
      await record(c, r, a.choice.kind, a.hash);
    },
    async (emit) => {
      await emit({ type: "error", message: "The run crashed before it finished." });
      await emit({ type: "done" });
    },
  );
});

/** Which lane of a side-by-side an event belongs to. */
export type PairLane = "test" | "held";
export type PairEvent = (LiveEvent & { lane: PairLane }) | { type: "end"; pairId: string };

/**
 * The side-by-side: the same request, two live agents at once, one in the test arm and one
 * held out. Each lane is an ordinary live run (tagged live, recorded, counted against the caps).
 */
live.post("/pair", async (c) => {
  const a = await admit(c, 2);
  if ("denied" in a) return c.json(a.denied.body, a.denied.status);
  const pairId = newId("pair");
  const endpoints = endpointsFor(c);
  const lanes: [PairLane, "test" | "none"][] = [
    ["test", "test"],
    ["held", "none"],
  ];
  return stream(
    c,
    async (emit) => {
      const records = await Promise.all(
        lanes.map(([lane, arm]) =>
          runLive({
            env: c.env,
            db: c.env.DB,
            emit: (e) => emit({ ...e, lane } satisfies PairEvent),
            runId: newId("live"),
            request: a.request,
            category: a.category,
            endpoints,
            arm,
            pairId,
          }),
        ),
      );
      for (const r of records) await record(c, r, a.choice.kind, a.hash);
      await emit({ type: "end", pairId } satisfies PairEvent);
    },
    async (emit) => {
      for (const [lane] of lanes) {
        await emit({ type: "error", message: "The run crashed before it finished.", lane });
        await emit({ type: "done", lane });
      }
      await emit({ type: "end", pairId });
    },
  );
});
