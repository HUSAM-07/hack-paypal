import { Hono } from "hono";

export const PORT = 8801;

/** Skeleton: agent catalogue (MCP server: search_product, arm assignment, passports). */
export const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    app: "catalogue-mcp",
    paypalMode: process.env.PAYPAL_MODE ?? "simulated",
    modelProvider: process.env.MODEL_PROVIDER ?? "fake",
  }),
);
