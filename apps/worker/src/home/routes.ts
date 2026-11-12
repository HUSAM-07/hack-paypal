import { readShopState, type ShopSummary, summarizeShop } from "@shop/server";
import { type Context, Hono } from "hono";
import { googleConfig, safeReturnTo } from "../auth/google";
import { clearSessionCookie, sessionUser } from "../auth/session";
import type { Env } from "../env";
import { shopEnabled } from "../security";
import { homePage, signInPage } from "./page";

type C = Context<{ Bindings: Env }>;

/** No scripts but theme.js; forms post only to this origin. */
const HOME_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self' https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'";

const page = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Content-Security-Policy": HOME_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
    },
  });

/** Browsers send Origin on every POST; without one, only same-origin fetch metadata passes. */
function sameOrigin(c: C): boolean {
  const origin = c.req.header("Origin");
  if (origin) return origin === new URL(c.req.url).origin;
  return c.req.header("Sec-Fetch-Site") === "same-origin";
}

export const home = new Hono<{ Bindings: Env }>();

/** For the top bar's account link (public/theme.js): signature check only, no D1 read. */
home.get("/api/session", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ signedIn: Boolean(await sessionUser(c)) });
});

home.get("/signin", async (c) => {
  const returnTo = safeReturnTo(c.req.query("returnTo") ?? "/home", new URL(c.req.url).origin);
  if (await sessionUser(c)) return c.redirect(returnTo, 302);
  const error = c.req.query("signin_error");
  return page(
    signInPage({
      returnTo,
      ...(error ? { error } : {}),
      googleEnabled: shopEnabled(c.env) && googleConfig(c.env) !== null,
    }),
  );
});

home.get("/home", async (c) => {
  const userId = await sessionUser(c);
  if (!userId) return c.redirect("/signin?returnTo=%2Fhome", 302);
  const user = await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?")
    .bind(userId)
    .first<{ display_name: string }>();
  if (!user) {
    clearSessionCookie(c);
    return c.redirect("/signin?returnTo=%2Fhome", 302);
  }
  const enabled = shopEnabled(c.env);
  let shop: ShopSummary | null = null;
  if (enabled) {
    const state = await readShopState(c.env, userId);
    try {
      shop = state ? summarizeShop(state as Parameters<typeof summarizeShop>[0]) : null;
    } catch {
      shop = null;
    }
  }
  return page(homePage({ name: user.display_name, shop, shopEnabled: enabled }));
});

home.post("/home/signout", (c) => {
  if (!sameOrigin(c)) return c.text("forbidden", 403);
  clearSessionCookie(c);
  return c.redirect("/", 303);
});
