import { Hono } from "hono";
import { APPROVAL_ID, analyse, type Wording } from "./analyst";
import {
  buildDashboard,
  createEngineApprover,
  createEngineReader,
  EngineUnavailable,
  type RawEngine,
} from "./dashboard";
import { studioPage } from "./page";

export const PORT = 8804;

export interface StudioDeps {
  read: () => Promise<RawEngine>;
  /** Capture a top-up deposit through the engine's approval endpoint. */
  approve?:
    | ((a: { approvalId: string; brandId: string; amountMinor: number }) => Promise<unknown>)
    | undefined;
  /** Optional model wording for the Analyst; without it the deterministic template is used. */
  wording?: Wording | undefined;
  /** AG Grid Enterprise licence key. Not a secret (it ships to the browser); without it the grid shows a watermark. */
  licenseKey?: string | undefined;
}

export function depsFromEnv(env: Record<string, string | undefined>): StudioDeps {
  const engine = {
    baseUrl: env.ENGINE_URL ?? "http://localhost:8800",
    token: env.ENGINE_API_TOKEN,
  };
  return {
    read: createEngineReader(engine),
    approve: createEngineApprover(engine),
    licenseKey: env.AG_GRID_LICENSE_KEY,
  };
}

/** CITED Studio: the brand view (Maya, Winix) and the creator view (HouseFresh). Reads the engine; its one write is Maya's approval. */
export function createStudioApp(deps: StudioDeps = depsFromEnv(process.env)) {
  const app = new Hono();
  const opts = (clean: string | undefined) => ({
    clean: clean === "1",
    licenseKey: deps.licenseKey,
  });

  app.get("/health", (c) =>
    c.json({
      ok: true,
      app: "studio",
      paypalMode: process.env.PAYPAL_MODE ?? "simulated",
      modelProvider: process.env.MODEL_PROVIDER ?? "fake",
    }),
  );

  app.get("/api/dashboard", async (c) => {
    try {
      c.header("cache-control", "no-store");
      return c.json(buildDashboard(await deps.read()));
    } catch (e) {
      if (e instanceof EngineUnavailable) return c.json({ error: e.message }, 503);
      throw e;
    }
  });

  app.get("/api/analyst", async (c) => {
    try {
      c.header("cache-control", "no-store");
      const rec = await analyse(await deps.read(), { wording: deps.wording });
      return rec ? c.json(rec) : c.json({ error: "no Winix programme yet" }, 404);
    } catch (e) {
      if (e instanceof EngineUnavailable) return c.json({ error: e.message }, 503);
      throw e;
    }
  });

  // Maya's approval. The amount comes from a fresh recommendation, never from the request.
  app.post("/api/analyst/approve", async (c) => {
    if (c.req.header("x-studio") !== "approve") return c.json({ error: "forbidden" }, 403);
    if (!deps.approve) return c.json({ error: "approvals are not configured" }, 501);
    try {
      const rec = await analyse(await deps.read());
      if (!rec || rec.action !== "raise_cap" || rec.amountMinor === null)
        return c.json({ error: "nothing to approve right now" }, 409);
      const deposit = await deps.approve({
        approvalId: APPROVAL_ID,
        brandId: rec.brandId,
        amountMinor: rec.amountMinor,
      });
      return c.json({ approved: true, amountMinor: rec.amountMinor, deposit });
    } catch (e) {
      if (e instanceof EngineUnavailable) return c.json({ error: e.message }, 503);
      throw e;
    }
  });

  app.get("/", (c) => c.html(studioPage("brand", opts(c.req.query("clean")))));
  app.get("/creator", (c) => c.html(studioPage("creator", opts(c.req.query("clean")))));

  return app;
}

export const app = createStudioApp();
export * from "./analyst";
export * from "./dashboard";
export { AG_GRID_SRC } from "./page";
