import { Hono } from "hono";
import { auth } from "./auth/routes";
import { sessionUser } from "./auth/session";
import { allowedOrigins, type Env } from "./env";
import { newId } from "./ids";
import { ipRateLimit, originAllowed, securityHeaders } from "./security";

export { PactDO } from "./do/pact";
export { ThreadDO } from "./do/thread";
export { UserDO } from "./do/user";

const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders);
app.use("/api/auth/*", ipRateLimit);

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/auth", auth);

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
