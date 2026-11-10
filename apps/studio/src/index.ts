import { Hono } from "hono";
import { buildDashboard, createEngineReader, EngineUnavailable, type RawEngine } from "./dashboard";
import { studioPage } from "./page";

export const PORT = 8804;

export interface StudioDeps {
  read: () => Promise<RawEngine>;
  /** AG Grid Enterprise licence key. Not a secret (it ships to the browser); without it the grid shows a watermark. */
  licenseKey?: string | undefined;
}

export function depsFromEnv(env: Record<string, string | undefined>): StudioDeps {
  return {
    read: createEngineReader({
      baseUrl: env.ENGINE_URL ?? "http://localhost:8800",
      token: env.ENGINE_API_TOKEN,
    }),
    licenseKey: env.AG_GRID_LICENSE_KEY,
  };
}

/** CITED Studio: the brand view (Maya, Winix) and the creator view (HouseFresh). Read-only. */
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

  app.get("/", (c) => c.html(studioPage("brand", opts(c.req.query("clean")))));
  app.get("/creator", (c) => c.html(studioPage("creator", opts(c.req.query("clean")))));

  return app;
}

export const app = createStudioApp();
export * from "./dashboard";
export { AG_GRID_SRC } from "./page";
