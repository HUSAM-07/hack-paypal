/**
 * Stateless session cookie: `<userId>.<expiresAtSec>.<hmac>` signed with SESSION_SECRET.
 * HttpOnly + SameSite=Strict, so it never reaches page JS and isn't sent cross-site.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import { b64url, fromB64url } from "../ids";

export const SESSION_COOKIE = "pact_session";
const SESSION_TTL_SEC = 7 * 24 * 3600;

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 chars");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(
  secret: string,
  userId: string,
  nowSec = nowS(),
): Promise<string> {
  const payload = `${userId}.${nowSec + SESSION_TTL_SEC}`;
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

export async function verifySession(
  secret: string,
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts as [string, string, string];
  if (!/^usr_[A-Za-z0-9]+$/.test(userId) || !/^\d+$/.test(exp) || Number(exp) < nowS()) return null;
  let sigBytes: Uint8Array;
  try {
    sigBytes = fromB64url(sig);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    sigBytes,
    new TextEncoder().encode(`${userId}.${exp}`),
  );
  return ok ? userId : null;
}

export async function setSessionCookie(
  c: Context<{ Bindings: Env }>,
  userId: string,
): Promise<void> {
  setCookie(c, SESSION_COOKIE, await signSession(c.env.SESSION_SECRET, userId), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSessionCookie(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function sessionUser(c: Context<{ Bindings: Env }>): Promise<string | null> {
  return verifySession(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE));
}

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}
