import { Hono } from "hono";

export const PORT = 8802;

/** Skeleton: Northwind, Lumen and MegaMart storefronts. */
export const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    app: "shops",
    paypalMode: process.env.PAYPAL_MODE ?? "simulated",
    modelProvider: process.env.MODEL_PROVIDER ?? "fake",
  }),
);
