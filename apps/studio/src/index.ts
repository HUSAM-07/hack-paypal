import { Hono } from "hono";

export const PORT = 8804;

/** Skeleton: AG Studio dashboards. */
export const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    app: "studio",
    paypalMode: process.env.PAYPAL_MODE ?? "simulated",
    modelProvider: process.env.MODEL_PROVIDER ?? "fake",
  }),
);
