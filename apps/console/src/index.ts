import { Hono } from "hono";
import { type Deps, loadDemo, loadPayout } from "./data";
import { createEngineClient, EngineUnavailable } from "./engine";
import { runSourceFromEnv } from "./runs";
import { demoPage, payoutPage } from "./views";

export const PORT = 8805;

export function depsFromEnv(env: Record<string, string | undefined>): Deps {
  return {
    engine: createEngineClient({
      baseUrl: env.ENGINE_URL ?? "http://localhost:8800",
      token: env.ENGINE_API_TOKEN,
    }),
    runs: runSourceFromEnv(env),
  };
}

/** Demo console: the two video frames (side-by-side runs, payout moment). Read-only. */
export function createConsoleApp(deps: Deps = depsFromEnv(process.env)) {
  const app = new Hono();
  const view = (q: (k: string) => string | undefined) => ({
    live: q("live") === "1",
    clean: q("clean") === "1",
  });

  app.get("/health", (c) =>
    c.json({
      ok: true,
      app: "console",
      paypalMode: process.env.PAYPAL_MODE ?? "simulated",
      modelProvider: process.env.MODEL_PROVIDER ?? "fake",
    }),
  );

  app.get("/api/demo", async (c) => c.json(await loadDemo(deps)));

  app.get("/", async (c) =>
    c.html(
      demoPage(
        await loadDemo(deps),
        view((k) => c.req.query(k)),
      ),
    ),
  );

  app.get("/payout", async (c) => {
    try {
      const data = await loadPayout(deps, c.req.query("creator"), c.req.query("batch"));
      return c.html(
        payoutPage(
          data,
          view((k) => c.req.query(k)),
        ),
      );
    } catch (e) {
      if (e instanceof EngineUnavailable) return c.text(e.message, 503);
      throw e;
    }
  });

  return app;
}

export const app = createConsoleApp();
export * from "./data";
export * from "./engine";
export * from "./runs";
