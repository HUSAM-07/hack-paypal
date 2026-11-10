import { Hono } from "hono";
import { recommend } from "./analyst";
import {
  createEngineApprover,
  createEngineReader,
  createEngineReviewer,
  EngineUnavailable,
  type RawEngine,
  type RawReviewFlag,
  type ReviewAction,
  ReviewRejected,
} from "./dashboard";
import {
  MAX_REQUEST_BYTES,
  parseTurn,
  type StudioLlmChoice,
  type StudioLlmEnv,
  streamTurn,
  studioLlmChoice,
} from "./llm";
import { buildTables, TABLES } from "./tables";

export const PORT = 8804;

export interface StudioDeps {
  read: () => Promise<RawEngine>;
  /** Capture a top-up deposit through the engine's approval endpoint. */
  approve?:
    | ((a: { approvalId: string; brandId: string; amountMinor: number }) => Promise<unknown>)
    | undefined;
  /** Release or void a credit the abuse guard held, through the engine's review endpoints. */
  review?: ((id: string, action: ReviewAction) => Promise<RawReviewFlag>) | undefined;
  llm?: StudioLlmChoice | undefined;
  /** Fetch used for model calls (tests inject a fake). */
  llmFetch?: typeof fetch | undefined;
  /** Rate limit for model calls; resolve false to refuse. Keyed by caller. */
  limit?: ((req: Request) => Promise<boolean>) | undefined;
  /** AG Studio licence key. Ships to the browser (normal for AG products); unset = watermark. */
  licenseKey?: string | undefined;
  /** AG Grid Enterprise key for the custom master-detail widget; falls back to licenseKey. */
  gridLicenseKey?: string | undefined;
}

export function depsFromEnv(env: Record<string, string | undefined>): StudioDeps {
  const engine = {
    baseUrl: env.ENGINE_URL ?? "http://localhost:8800",
    token: env.ENGINE_API_TOKEN,
  };
  return {
    read: createEngineReader(engine),
    approve: createEngineApprover(engine),
    review: createEngineReviewer(engine),
    llm: studioLlmChoice(env as StudioLlmEnv),
    licenseKey: env.AG_STUDIO_LICENSE_KEY,
    gridLicenseKey: env.AG_GRID_LICENSE_KEY,
  };
}

/**
 * CITED Studio's API: the engine's read API as Studio tables, the Analyst's model (keys stay
 * here), and Maya's approval. The dashboards themselves are the AG Studio app in apps/web.
 */
export function createStudioApp(deps: StudioDeps = depsFromEnv(process.env)) {
  const app = new Hono();
  const llm = deps.llm ?? { kind: "scripted", label: "Scripted Analyst (no model key)" };

  const engineError = (e: unknown) => {
    if (e instanceof EngineUnavailable) return { error: e.message };
    throw e;
  };

  app.get("/health", (c) => c.json({ ok: true, app: "studio", llm: llm.kind }));

  app.get("/api/config", (c) =>
    c.json({
      licenseKey: deps.licenseKey ?? "",
      gridLicenseKey: deps.gridLicenseKey ?? deps.licenseKey ?? "",
      llm: { kind: llm.kind, label: llm.label },
      tables: TABLES,
    }),
  );

  app.get("/api/data", async (c) => {
    c.header("cache-control", "no-store");
    try {
      return c.json(buildTables(await deps.read()));
    } catch (e) {
      return c.json(engineError(e), 503);
    }
  });

  app.get("/api/analyst", async (c) => {
    c.header("cache-control", "no-store");
    try {
      const rec = recommend(await deps.read(), c.req.query("brand") ?? "winix");
      return rec ? c.json(rec) : c.json({ error: "no such brand programme yet" }, 404);
    } catch (e) {
      return c.json(engineError(e), 503);
    }
  });

  // Maya's approval. The amount comes from a fresh recommendation, never from the request;
  // the approval id must match the card she saw, so a stale card can't approve a new top-up.
  app.post("/api/analyst/approve", async (c) => {
    if (c.req.header("x-studio") !== "approve") return c.json({ error: "forbidden" }, 403);
    if (!deps.approve) return c.json({ error: "approvals are not configured" }, 501);
    const body = (await c.req.json().catch(() => null)) as {
      approvalId?: unknown;
      brandId?: unknown;
    } | null;
    try {
      const rec = recommend(
        await deps.read(),
        typeof body?.brandId === "string" ? body.brandId : "winix",
      );
      if (rec?.action !== "raise_cap" || rec.amountMinor === null)
        return c.json({ error: "nothing to approve right now" }, 409);
      if (body?.approvalId !== rec.approvalId)
        return c.json({ error: "this recommendation has changed; ask the Analyst again" }, 409);
      const deposit = await deps.approve({
        approvalId: rec.approvalId,
        brandId: rec.brandId,
        amountMinor: rec.amountMinor,
      });
      return c.json({
        approved: true,
        approvalId: rec.approvalId,
        amountMinor: rec.amountMinor,
        deposit,
      });
    } catch (e) {
      return c.json(engineError(e), 503);
    }
  });

  // A reviewer decides a guard hold from the brand view. Only open holds can be decided (the
  // engine checks), and the header keeps a plain cross-site form from reaching it.
  app.post("/api/review-flags/:id/:action", async (c) => {
    if (c.req.header("x-studio") !== "review") return c.json({ error: "forbidden" }, 403);
    if (!deps.review) return c.json({ error: "reviews are not configured" }, 501);
    const action = c.req.param("action");
    const id = c.req.param("id");
    if (action !== "release" && action !== "void") return c.json({ error: "unknown action" }, 404);
    if (!/^[A-Za-z0-9_:-]{1,200}$/.test(id)) return c.json({ error: "bad flag id" }, 400);
    try {
      return c.json({ flag: await deps.review(id, action) });
    } catch (e) {
      if (e instanceof ReviewRejected) return c.json({ error: e.message }, e.status);
      return c.json(engineError(e), 503);
    }
  });

  // One model turn for the AG Studio agents. Capped per call; rate-limited per caller.
  app.post("/api/llm", async (c) => {
    if (llm.kind === "scripted") return c.json({ error: "no model configured" }, 503);
    const origin = c.req.header("origin");
    // Same-origin only: the browser's Origin must name the host it is talking to.
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (origin && new URL(origin).host !== host) return c.json({ error: "forbidden" }, 403);
    if (deps.limit && !(await deps.limit(c.req.raw)))
      return c.json(
        { error: "rate_limited", message: "Too many model calls. Try again in a minute." },
        429,
      );
    const text = await c.req.text();
    if (text.length > MAX_REQUEST_BYTES) return c.json({ error: "request too large" }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const turn = parseTurn(raw);
    if (typeof turn === "string") return c.json({ error: turn }, 400);
    return new Response(
      streamTurn(llm, turn, {
        signal: c.req.raw.signal,
        ...(deps.llmFetch ? { fetch: deps.llmFetch } : {}),
      }),
      {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  });

  return app;
}

export const app = createStudioApp();
export * from "./analyst";
export * from "./dashboard";
export * from "./llm";
export * from "./tables";
