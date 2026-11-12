/**
 * Standalone dev entry: `npm run dev -w @shop/server`. Everyone is `DEV_USER` (no real auth), so
 * it must never be deployed; pact-worker mounts `shopRouter` with its session lookup instead.
 */
import { Hono } from "hono";
import type { ShopEnv } from "./agent";
import { shopRouter } from "./router";

export { ShopperAgent } from "./agent";

interface DevEnv extends ShopEnv {
  DEV_USER?: string;
}

const app = new Hono<{ Bindings: DevEnv }>();
app.get("/", (c) => c.text("shop dev server: WebSocket /api/shop/ws, AG-UI POST /api/shop/agui"));
app.route("/api/shop", shopRouter<DevEnv>({ getUserId: (c) => c.env.DEV_USER ?? null }));

export default app;
