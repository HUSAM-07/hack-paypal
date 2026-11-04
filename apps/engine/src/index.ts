import { Hono } from "hono";
import type { Env } from "./env";

/** Skeleton: webhooks, arm-checkout join, credit ledger, payouts, refunds, Studio read API. */
export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({
    ok: true,
    app: "engine",
    paypalMode: c.env.PAYPAL_MODE,
    modelProvider: c.env.MODEL_PROVIDER,
  }),
);

export default app;
