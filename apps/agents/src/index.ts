import { Hono } from "hono";

export const PORT = 8803;

/** Skeleton: shopper-agent runner and demo runner. */
export const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    app: "agents",
    paypalMode: process.env.PAYPAL_MODE ?? "simulated",
    modelProvider: process.env.MODEL_PROVIDER ?? "fake",
  }),
);
