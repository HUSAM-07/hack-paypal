import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

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
  h.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
