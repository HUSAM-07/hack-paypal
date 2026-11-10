import { Hono } from "hono";

export const PORT = 8803;

export * from "./agent";
export * from "./fake-agent";
export * from "./in-process";
export * from "./llm-agent";
export * from "./rng";
export * from "./run";
export * from "./session";
export * from "./types";

export const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    app: "agents",
    paypalMode: process.env.PAYPAL_MODE ?? "simulated",
    modelProvider: process.env.MODEL_PROVIDER ?? "fake",
  }),
);
