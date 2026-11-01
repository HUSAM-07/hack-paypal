import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { allowedOrigins, type Env } from "../env";
import { fromB64url, newId, nowIso } from "../ids";
import { clearSessionCookie, sessionUser, setSessionCookie } from "./session";
import { AssertionJSON, stepUpOptions, verifyAssertion } from "./webauthn";

type C = Context<{ Bindings: Env }>;

const FLOW_COOKIE = "pact_flow";
const FLOW_TTL_SEC = 300;

const Username = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_.-]+$/, "lowercase letters, digits, . _ -");
const RegisterOptionsBody = z.object({
  username: Username,
  displayName: z.string().min(1).max(80).optional(),
});
const VerifyBody = z.object({ response: z.record(z.string(), z.unknown()) });
const StepUpBody = z.object({
  threadId: z.string().min(1).max(128),
  approvalId: z.string().min(1).max(128),
});

const userStub = (env: Env, userId: string) => env.USER.get(env.USER.idFromName(userId));

async function startFlow(
  c: C,
  kind: "register" | "login",
  challenge: string,
  extra: { userId?: string; username?: string; displayName?: string } = {},
): Promise<void> {
  const id = newId("flow", 24);
  await c.env.DB.prepare(
    "INSERT INTO auth_challenges (id, kind, challenge, user_id, username, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      kind,
      challenge,
      extra.userId ?? null,
      extra.username ? `${extra.username}\n${extra.displayName ?? extra.username}` : null,
      Date.now() + FLOW_TTL_SEC * 1000,
    )
    .run();
  setCookie(c, FLOW_COOKIE, id, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/api/auth",
    maxAge: FLOW_TTL_SEC,
  });
}

/** Single use: the row is deleted as it's read, so a challenge can't be replayed. */
async function takeFlow(c: C, kind: "register" | "login") {
  const id = getCookie(c, FLOW_COOKIE);
  deleteCookie(c, FLOW_COOKIE, { path: "/api/auth" });
  if (!id) return null;
  const row = await c.env.DB.prepare(
    "DELETE FROM auth_challenges WHERE id = ? AND kind = ? RETURNING challenge, user_id, username, expires_at",
  )
    .bind(id, kind)
    .first<{
      challenge: string;
      user_id: string | null;
      username: string | null;
      expires_at: number;
    }>();
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

async function parseBody<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T> | null> {
  const json = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export const auth = new Hono<{ Bindings: Env }>();

auth.post("/register/options", async (c) => {
  const body = await parseBody(c, RegisterOptionsBody);
  if (!body) return c.json({ error: "invalid_request" }, 400);
  const taken = await c.env.DB.prepare("SELECT 1 FROM users WHERE username = ?")
    .bind(body.username)
    .first();
  if (taken) return c.json({ error: "username_taken" }, 409);
  const userId = newId("usr");
  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userName: body.username,
    userDisplayName: body.displayName ?? body.username,
    userID: new Uint8Array(new TextEncoder().encode(userId)),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await startFlow(c, "register", options.challenge, {
    userId,
    username: body.username,
    ...(body.displayName ? { displayName: body.displayName } : {}),
  });
  return c.json(options);
});

auth.post("/register/verify", async (c) => {
  const body = await parseBody(c, VerifyBody);
  const flow = await takeFlow(c, "register");
  if (!body || !flow?.user_id || !flow.username) return c.json({ error: "invalid_request" }, 400);
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as unknown as RegistrationResponseJSON,
      expectedChallenge: flow.challenge,
      expectedOrigin: allowedOrigins(c.env),
      expectedRPID: c.env.RP_ID,
      requireUserVerification: false,
    });
  } catch {
    return c.json({ error: "verification_failed" }, 400);
  }
  if (!verification.verified) return c.json({ error: "verification_failed" }, 400);
  const [username, displayName] = flow.username.split("\n") as [string, string];
  const inserted = await c.env.DB.prepare(
    "INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING",
  )
    .bind(flow.user_id, username, displayName, nowIso())
    .run();
  if (!inserted.meta.changes) return c.json({ error: "username_taken" }, 409);
  const { credential } = verification.registrationInfo;
  await userStub(c.env, flow.user_id).addCredential({
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports ?? [],
    createdAt: nowIso(),
  });
  await setSessionCookie(c, flow.user_id);
  return c.json({ userId: flow.user_id, username, displayName });
});

auth.post("/login/options", async (c) => {
  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: "preferred",
  });
  await startFlow(c, "login", options.challenge);
  return c.json(options);
});

auth.post("/login/verify", async (c) => {
  const body = await parseBody(c, VerifyBody);
  const flow = await takeFlow(c, "login");
  const assertion = AssertionJSON.safeParse(body?.response);
  if (!flow || !assertion.success || !assertion.data.response.userHandle) {
    return c.json({ error: "invalid_request" }, 400);
  }
  let userId: string;
  try {
    userId = new TextDecoder().decode(fromB64url(assertion.data.response.userHandle));
  } catch {
    return c.json({ error: "verification_failed" }, 400);
  }
  const user = await c.env.DB.prepare("SELECT username, display_name FROM users WHERE id = ?")
    .bind(userId)
    .first<{ username: string; display_name: string }>();
  if (!user) return c.json({ error: "verification_failed" }, 400);
  const ok = await verifyAssertion(
    c.env,
    userId,
    assertion.data as AuthenticationResponseJSON,
    flow.challenge,
  );
  if (!ok) return c.json({ error: "verification_failed" }, 400);
  await setSessionCookie(c, userId);
  return c.json({ userId, username: user.username, displayName: user.display_name });
});

/** Options for the passkey assertion an approval with `stepUp: true` needs. */
auth.post("/step-up/options", async (c) => {
  const userId = await sessionUser(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = await parseBody(c, StepUpBody);
  if (!body) return c.json({ error: "invalid_request" }, 400);
  const thread = c.env.THREAD.get(c.env.THREAD.idFromName(body.threadId));
  const challenge = await thread.approvalChallenge(body.approvalId, userId);
  if (!challenge) return c.json({ error: "not_found" }, 404);
  return c.json(await stepUpOptions(c.env, userId, challenge));
});

auth.get("/me", async (c) => {
  const userId = await sessionUser(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const user = await c.env.DB.prepare("SELECT username, display_name FROM users WHERE id = ?")
    .bind(userId)
    .first<{ username: string; display_name: string }>();
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ userId, username: user.username, displayName: user.display_name });
});

auth.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/**
 * Passwordless test users for local dev, scripted clients and tests. Only mounted when
 * DEV_AUTH=1 (set in .dev.vars, never in wrangler.jsonc vars or production secrets).
 */
auth.post("/dev-login", async (c) => {
  if (c.env.DEV_AUTH !== "1") return c.json({ error: "not_found" }, 404);
  const body = await parseBody(c, RegisterOptionsBody);
  if (!body) return c.json({ error: "invalid_request" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING",
  )
    .bind(newId("usr"), body.username, body.displayName ?? body.username, nowIso())
    .run();
  const user = await c.env.DB.prepare("SELECT id, display_name FROM users WHERE username = ?")
    .bind(body.username)
    .first<{ id: string; display_name: string }>();
  if (!user) return c.json({ error: "internal" }, 500);
  await setSessionCookie(c, user.id);
  return c.json({ userId: user.id, username: body.username, displayName: user.display_name });
});
