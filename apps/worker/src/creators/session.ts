/**
 * The creator's sign-in, kept in one signed cookie: `<b64url(json)>.<hmac>` with SESSION_SECRET.
 * It holds the PayPal payer id from Log in with PayPal and nothing PayPal could reuse (the user
 * access token is used once for userinfo and dropped). HttpOnly, so page scripts never see it.
 */
import { b64url, fromB64url } from "../ids";

export const CREATOR_COOKIE = "cited_creator";
/** OAuth `state`, bound to this browser. Lax: the callback is a top-level redirect from PayPal. */
export const STATE_COOKIE = "cited_creator_state";
export const SESSION_TTL_SEC = 12 * 3600;
export const STATE_TTL_SEC = 10 * 60;

export interface CreatorSession {
  payerId: string;
  /** Name from the PayPal account; the creator can publish under another. */
  name: string;
  /** Which PayPal signed them in, so a simulated session is never mistaken for a real one. */
  mode: "simulated" | "sandbox";
  exp: number;
}

const enc = new TextEncoder();

async function key(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 chars");
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sign(secret: string | undefined, value: object): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(value)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

export async function verify<T extends { exp: number }>(
  secret: string | undefined,
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<T | null> {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      fromB64url(sig),
      enc.encode(payload),
    );
    if (!ok) return null;
    const value = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as T;
    return typeof value.exp === "number" && value.exp > nowSec ? value : null;
  } catch {
    return null;
  }
}

/** A form token tied to the session, so a cross-site page can't post a test as this creator. */
export async function csrfToken(secret: string | undefined, s: CreatorSession): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    enc.encode(`csrf:${s.payerId}:${s.exp}`),
  );
  return b64url(new Uint8Array(sig));
}

export async function csrfOk(
  secret: string | undefined,
  s: CreatorSession,
  given: unknown,
): Promise<boolean> {
  if (typeof given !== "string") return false;
  const want = await csrfToken(secret, s);
  if (want.length !== given.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return d === 0;
}

/**
 * The creator's id, derived from their payer id: the same PayPal account always lands on the same
 * creator, and the `c-` prefix can never equal a demo creator's id.
 */
export async function creatorIdFor(payerId: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`creator:${payerId}`)));
  return `c-${[...d.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const randomToken = (bytes = 18) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
