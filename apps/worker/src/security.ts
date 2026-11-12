import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { NOT_FOUND_CSP } from "./not-found";

/**
 * Strict headers for every API response. The worker serves JSON and WebSocket only;
 * the SPA sets its own CSP (with PayPal frame/connect allowances) where it is served.
 */
export const securityHeaders: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  if (c.res.status === 101) return;
  // Responses proxied from a Durable Object have immutable headers.
  c.res = new Response(c.res.body, c.res);
  const h = c.res.headers;
  // The HTML 404 page (not-found.ts) needs its inline CSS and the site fonts; every other
  // response keeps the strict API policy.
  const html404 = c.res.status === 404 && (h.get("content-type") ?? "").startsWith("text/html");
  h.set(
    "Content-Security-Policy",
    html404
      ? NOT_FOUND_CSP
      : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  h.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  h.set("Cache-Control", "no-store");
};

/**
 * Headers for the shop's page (/shop and /shop/*), set by the route that serves its HTML, like
 * APP_PAGE_HEADERS in index.ts does for /app. Scoped to the shop so no other page loosens:
 * - connect-src 'self' covers the agent's same-origin WebSocket (/api/shop/ws) and SSE; no
 *   wildcard wss: as the /app page has.
 * - frame-src adds Browser Run Live View (live.browser.run) beside PayPal's checkout frames.
 * - img-src https: because product images come from any merchant.
 * - form-action allows accounts.google.com: a form that posts to /api/auth/google/start is
 *   redirected there, and form-action applies to that redirect.
 * Google sign-in itself is a top-level navigation, which CSP doesn't govern.
 */
export const SHOP_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://*.paypal.com https://*.paypalobjects.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.paypal.com https://cloudflareinsights.com",
  "frame-src https://*.paypal.com https://live.browser.run",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
].join("; ");

export const SHOP_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": SHOP_PAGE_CSP,
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self)",
  "Cache-Control": "no-cache",
};

/** A copy of `res` (asset responses have immutable headers) carrying SHOP_PAGE_HEADERS. */
export function withShopPageHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SHOP_PAGE_HEADERS)) out.headers.set(k, v);
  return out;
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "local";
}

/** Per-IP limit for the unauthenticated surface. */
export const ipRateLimit: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const { success } = await c.env.IP_LIMITER.limit({ key: `ip:${clientIp(c.req.raw)}` });
  if (!success) return c.json({ error: "rate_limited" }, 429);
  await next();
};

/**
 * Cookies ride along on cross-site WebSocket handshakes (no CORS for WS), so the
 * Origin must be checked explicitly. Non-browser clients send no Origin.
 */
export function originAllowed(req: Request, allowed: string[]): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return true;
  if (origin === new URL(req.url).origin) return true;
  return allowed.includes(origin);
}
