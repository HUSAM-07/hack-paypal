/**
 * `/api/shop` routes, mounted by pact-worker (`app.route("/api/shop", shopRouter({...}))`) and by
 * the standalone dev worker. Auth is injected: the router only routes to the Durable Object named
 * after the user id `getUserId` returns, so a client can never pick whose agent it talks to.
 */
import { getAgentByName } from "agents";
import { type Context, Hono } from "hono";
import type { ShopEnv } from "./agent";

export interface ShopRouterOptions<E extends ShopEnv> {
  /** The signed-in user's id, or null. pact-worker plugs its session lookup in here. */
  getUserId(
    c: Context<{ Bindings: E }>,
  ): string | null | undefined | Promise<string | null | undefined>;
  /** Origin check for the WebSocket upgrade (cross-site WebSocket hijacking). Default: allow. */
  allowOrigin?(c: Context<{ Bindings: E }>): boolean;
}

const USER_ID = /^[A-Za-z0-9_.:@-]{1,128}$/;

export function shopRouter<E extends ShopEnv = ShopEnv>(opts: ShopRouterOptions<E>) {
  const app = new Hono<{ Bindings: E }>();

  const agentFor = async (c: Context<{ Bindings: E }>) => {
    const userId = await opts.getUserId(c);
    if (!userId || !USER_ID.test(userId)) return undefined;
    return getAgentByName(c.env.SHOPPER_AGENT, userId);
  };

  app.get("/ws", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "expected_websocket" }, 426);
    }
    if (opts.allowOrigin && !opts.allowOrigin(c)) return c.json({ error: "forbidden" }, 403);
    const agent = await agentFor(c);
    if (!agent) return c.json({ error: "unauthorized" }, 401);
    return agent.fetch(c.req.raw);
  });

  app.post("/agui", async (c) => {
    const agent = await agentFor(c);
    if (!agent) return c.json({ error: "unauthorized" }, 401);
    const url = new URL(c.req.url);
    return agent.fetch(
      new Request(`${url.origin}/agui`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: c.req.header("accept") ?? "text/event-stream",
        },
        body: c.req.raw.body,
      }),
    );
  });

  return app;
}

/**
 * The user's shop state, read-only, for pages outside the chat (the apps home). Null when the
 * agent can't be reached; callers show the tile without numbers rather than failing the page.
 */
export async function readShopState<E extends ShopEnv>(
  env: E,
  userId: string,
): Promise<unknown | null> {
  if (!USER_ID.test(userId)) return null;
  try {
    const agent = await getAgentByName(env.SHOPPER_AGENT, userId);
    const res = await agent.fetch(new Request("https://shop.internal/state"));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
