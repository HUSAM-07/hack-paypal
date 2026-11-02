import { type Context, Hono } from "hono";
import { auth } from "./auth/routes";
import { sessionUser } from "./auth/session";
import { allowedOrigins, type Env } from "./env";
import { newId } from "./ids";
import { payments } from "./payments/routes";
import { webhooks } from "./payments/webhooks";
import { ipRateLimit, originAllowed, securityHeaders } from "./security";

export { PactDO } from "./do/pact";
export { ThreadDO } from "./do/thread";
export { UserDO } from "./do/user";

const app = new Hono<{ Bindings: Env }>();

/**
 * Every /app route loads the app's HTML entry (client-side routing takes over).
 * Registered before the API security headers, whose `default-src 'none'` would block
 * the page; asset `_headers` rules don't apply to worker responses, so the page's
 * policy is set here and must match apps/web/public/_headers.
 */
const APP_PAGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://*.paypal.com https://*.paypalobjects.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' wss: https://*.paypal.com; frame-src https://*.paypal.com; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self)",
  "Cache-Control": "no-cache",
};
const appPage = async (c: Context<{ Bindings: Env }>) => {
  // Assets serve app.html at its pretty URL (/app); asking for /app.html would redirect.
  const res = await c.env.ASSETS.fetch(new URL("/app", c.req.url));
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(APP_PAGE_HEADERS)) out.headers.set(k, v);
  return out;
};
app.get("/app", appPage);
app.get("/app/*", appPage);

app.use("*", securityHeaders);
app.use("/api/auth/*", ipRateLimit);

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/auth", auth);
// Before `payments`: PayPal calls this without a session, and the first matching
// handler wins, so payments' session middleware never sees webhook requests.
app.route("/api/paypal/webhooks", webhooks);
app.route("/api", payments);

/**
 * GET /ws?thread=<threadId|new>: upgrade to the thread's Durable Object.
 * `new` mints a thread id; the client then sends initialize + thread/start.
 */
app.get("/ws", ipRateLimit, async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "expected_websocket" }, 426);
  }
  if (!originAllowed(c.req.raw, allowedOrigins(c.env))) return c.json({ error: "forbidden" }, 403);
  const userId = await sessionUser(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const requested = c.req.query("thread") ?? "";
  const isNew = requested === "new";
  if (!isNew && !/^thr_[A-Za-z0-9]{4,40}$/.test(requested)) {
    return c.json({ error: "invalid_thread" }, 400);
  }
  const threadId = isNew ? newId("thr") : requested;
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-pact-user", userId);
  headers.set("x-pact-thread", threadId);
  headers.set("x-pact-new", isNew ? "1" : "0");
  const stub = c.env.THREAD.get(c.env.THREAD.idFromName(threadId));
  return stub.fetch(new Request(c.req.raw.url, { headers }));
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error("unhandled", err.name);
  return c.json({ error: "internal" }, 500);
});

export default app;
