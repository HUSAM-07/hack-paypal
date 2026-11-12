/**
 * Google sign-in for the Shop vertical (shop/spec/SHOP-SPEC.md). It ends by issuing the same
 * `pact_session` cookie passkeys do, so every route that reads the session works unchanged.
 *
 *   GET /api/auth/google/start?returnTo=/shop   → 302 to Google (state + PKCE)
 *   GET /api/auth/google/callback               → verifies, signs in, then sends the browser on
 *
 * Off unless SHOP_ENABLED="true" and GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are set: both routes
 * 404, as if they didn't exist. Sign-up through Google is open (it does not ask for INVITE_CODE,
 * which gates passkey sign-up only); turning the shop on is the switch that opens it.
 *
 * Accounts: a Google `sub` already linked signs in its user. Otherwise, a browser that is already
 * signed in links Google to that user, and a signed-out one gets a new user. Accounts are never
 * matched by email: users have no verified email of their own to match against.
 */
import { Google, generateCodeVerifier, generateState } from "arctic";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import { b64url, fromB64url, newId, nowIso } from "../ids";
import { sessionUser, setSessionCookie } from "./session";

type C = Context<{ Bindings: Env }>;

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const FLOW_COOKIE = "pact_google";
const FLOW_PATH = "/api/auth/google";
const FLOW_TTL_SEC = 600;
const CLOCK_SKEW_SEC = 60;
const DEFAULT_RETURN = "/shop";

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function googleConfig(env: Env): GoogleConfig | null {
  if (env.SHOP_ENABLED !== "true" || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return null;
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

/** Same-origin path to land on after sign-in. Anything else (other hosts, `//x`, `/\x`) → default. */
export function safeReturnTo(raw: string | undefined, origin: string): string {
  if (!raw || raw.length > 512 || !raw.startsWith("/") || raw.includes("\\")) return DEFAULT_RETURN;
  // URL parsing drops tabs and newlines, so "/\n/evil.example" would become "//evil.example".
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) < 0x20) return DEFAULT_RETURN;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return DEFAULT_RETURN;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_RETURN;
  }
}

// ── Flow cookie: state + PKCE verifier + returnTo, HMAC-signed and short-lived ──

interface Flow {
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

async function flowKey(secret: string): Promise<CryptoKey> {
  // Domain-separated from the session HMAC, so a flow cookie can never pass as a session.
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`google-flow\n${secret}`),
  );
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function sealFlow(secret: string, flow: Flow): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(flow)));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await flowKey(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

async function openFlow(secret: string, token: string | undefined): Promise<Flow | null> {
  const [body, sig, extra] = token?.split(".") ?? [];
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await flowKey(secret),
      fromB64url(sig),
      new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const flow = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Flow;
    return flow.exp >= nowSec() ? flow : null;
  } catch {
    return null;
  }
}

// ── ID token verification (RS256 against Google's JWKS) ──

export interface GoogleClaims {
  sub: string;
  email?: string;
  name?: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

/** Google rotates keys; a `kid` we haven't seen refetches the set once. */
async function googleKey(kid: string): Promise<Jwk | undefined> {
  const now = Date.now();
  let hit =
    jwksCache && jwksCache.expiresAt > now ? jwksCache.keys.find((k) => k.kid === kid) : undefined;
  if (hit) return hit;
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  jwksCache = { keys, expiresAt: now + Math.min(maxAge, 86_400) * 1000 };
  hit = keys.find((k) => k.kid === kid);
  return hit;
}

/** For tests: forget cached keys so a fake JWKS is fetched. */
export function resetGoogleKeysForTests(): void {
  jwksCache = null;
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(fromB64url(segment))) as T;
}

/**
 * Verifies an ID token from Google's token endpoint: signature (RS256, Google's published key),
 * issuer, audience (our client id), expiry and a verified email. Returns null on any failure.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  now = nowSec(),
): Promise<GoogleClaims | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  try {
    const header = decodeSegment<{ alg?: string; kid?: string }>(h);
    if (header.alg !== "RS256" || !header.kid) return null;
    const jwk = await googleKey(header.kid);
    if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromB64url(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return null;
    const c = decodeSegment<Record<string, unknown>>(p);
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    const verified = c.email_verified === true || c.email_verified === "true";
    if (
      typeof c.iss !== "string" ||
      !GOOGLE_ISSUERS.includes(c.iss) ||
      !aud.includes(clientId) ||
      typeof c.exp !== "number" ||
      c.exp + CLOCK_SKEW_SEC < now ||
      (typeof c.iat === "number" && c.iat - CLOCK_SKEW_SEC > now) ||
      typeof c.sub !== "string" ||
      !c.sub ||
      c.sub.length > 255 ||
      !verified
    ) {
      return null;
    }
    return {
      sub: c.sub,
      ...(typeof c.email === "string" ? { email: c.email.slice(0, 320) } : {}),
      ...(typeof c.name === "string" ? { name: c.name.slice(0, 80) } : {}),
    };
  } catch {
    return null;
  }
}

// ── Accounts ──

async function linkedUser(db: D1Database, sub: string): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT o.user_id FROM shop_oauth_accounts o JOIN users u ON u.id = o.user_id WHERE o.provider = 'google' AND o.sub = ?",
    )
    .bind(sub)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/** A free-to-try username from the email's local part (users.username is lowercase [a-z0-9_.-]{3,32}). */
export function usernameBase(claims: GoogleClaims): string {
  const local = (claims.email?.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  const base = local.slice(0, 24);
  return base.length >= 3 ? base : "shopper";
}

async function findOrCreateUser(
  db: D1Database,
  claims: GoogleClaims,
  signedInAs: string | null,
): Promise<string> {
  const existing = await linkedUser(db, claims.sub);
  if (existing) return existing;
  const link = (userId: string) =>
    db
      .prepare(
        "INSERT INTO shop_oauth_accounts (provider, sub, user_id, email, created_at) VALUES ('google', ?, ?, ?, ?)",
      )
      .bind(claims.sub, userId, claims.email ?? null, nowIso());

  if (signedInAs) {
    try {
      await link(signedInAs).run();
      return signedInAs;
    } catch {
      // Lost a race to another callback for the same Google account: use what it linked.
      const raced = await linkedUser(db, claims.sub);
      if (raced) return raced;
      throw new Error("link failed");
    }
  }

  const base = usernameBase(claims);
  const display = claims.name || claims.email?.split("@")[0] || base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = attempt === 0 ? base : `${base}-${newId("x", 5).slice(2).toLowerCase()}`;
    const userId = newId("usr");
    try {
      // One transaction: the user exists only if its Google link does too.
      await db.batch([
        db
          .prepare("INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)")
          .bind(userId, username, display, nowIso()),
        link(userId),
      ]);
      return userId;
    } catch {
      const raced = await linkedUser(db, claims.sub);
      if (raced) return raced;
      // Otherwise the username was taken; try a suffixed one.
    }
  }
  throw new Error("could not create user");
}

// ── Routes ──

export const google = new Hono<{ Bindings: Env }>();

function provider(cfg: GoogleConfig, c: C): Google {
  return new Google(
    cfg.clientId,
    cfg.clientSecret,
    `${new URL(c.req.url).origin}${FLOW_PATH}/callback`,
  );
}

google.get("/start", async (c) => {
  const cfg = googleConfig(c.env);
  if (!cfg) return c.json({ error: "not_found" }, 404);
  const origin = new URL(c.req.url).origin;
  const flow: Flow = {
    state: generateState(),
    verifier: generateCodeVerifier(),
    returnTo: safeReturnTo(c.req.query("returnTo"), origin),
    exp: nowSec() + FLOW_TTL_SEC,
  };
  const url = provider(cfg, c).createAuthorizationURL(flow.state, flow.verifier, [
    "openid",
    "email",
    "profile",
  ]);
  setCookie(c, FLOW_COOKIE, await sealFlow(c.env.SESSION_SECRET, flow), {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    // Lax, not Strict: Google sends the browser back with a cross-site top-level GET.
    sameSite: "Lax",
    path: FLOW_PATH,
    maxAge: FLOW_TTL_SEC,
  });
  return c.redirect(url.toString(), 302);
});

google.get("/callback", async (c) => {
  const cfg = googleConfig(c.env);
  if (!cfg) return c.json({ error: "not_found" }, 404);
  // Cleared whatever happens next. A replayed callback fails at Google: codes are single use.
  const flow = await openFlow(c.env.SESSION_SECRET, getCookie(c, FLOW_COOKIE));
  deleteCookie(c, FLOW_COOKIE, { path: FLOW_PATH });
  const returnTo = flow?.returnTo ?? DEFAULT_RETURN;

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (c.req.query("error")) return land(c, returnTo, "cancelled");
  if (!flow || !code || !state || state !== flow.state) return land(c, returnTo, "invalid");

  let claims: GoogleClaims | null;
  try {
    const tokens = await provider(cfg, c).validateAuthorizationCode(code, flow.verifier);
    claims = await verifyGoogleIdToken(tokens.idToken(), cfg.clientId);
  } catch {
    claims = null;
  }
  if (!claims) return land(c, returnTo, "invalid");

  let userId: string;
  try {
    userId = await findOrCreateUser(c.env.DB, claims, await sessionUser(c));
  } catch {
    return land(c, returnTo, "failed");
  }
  await setSessionCookie(c, userId);
  return land(c, returnTo);
});

/**
 * Ends the flow with a same-origin hop rather than a 302. The session cookie is SameSite=Strict
 * and this response belongs to a navigation that started on accounts.google.com; a redirect
 * would keep the chain cross-site and the next page would load without the cookie.
 */
function land(c: C, returnTo: string, error?: string): Response {
  const url = new URL(returnTo, "http://x");
  if (error) url.searchParams.set("signin_error", error);
  const href = escapeHtml(`${url.pathname}${url.search}${url.hash}`);
  return c.html(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${href}"><title>Signing in…</title><a href="${href}">Continue</a>`,
    error === "failed" ? 500 : error ? 400 : 200,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
