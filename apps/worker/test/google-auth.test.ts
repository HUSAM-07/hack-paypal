import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_JWKS_URL,
  resetGoogleKeysForTests,
  safeReturnTo,
  verifyGoogleIdToken,
} from "../src/auth/google";
import { auth } from "../src/auth/routes";
import type { Env } from "../src/env";
import { b64url } from "../src/ids";
import { api, cookieFrom, devLogin } from "./helpers/client";

const ORIGIN = "http://localhost:8787";
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const CLIENT_SECRET = "test-google-secret";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const KID = "test-kid-1";

// Shop on, Google configured. The deployed config (wrangler.jsonc) has the shop off.
const shopEnv = {
  ...(env as unknown as Env),
  SHOP_ENABLED: "true",
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
} as Env;
const app = new Hono<{ Bindings: Env }>().route("/api/auth", auth);
const call = (path: string, cookie?: string, e: Env = shopEnv) =>
  app.request(`${ORIGIN}${path}`, cookie ? { headers: { Cookie: cookie } } : {}, e);

const enc = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

let googleKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;
const rsa = () =>
  crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;

async function idToken(
  claims: Record<string, unknown>,
  opts: { key?: CryptoKey; header?: Record<string, unknown> } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = `${enc({ alg: "RS256", kid: KID, typ: "JWT", ...opts.header })}.${enc({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    iat: now,
    exp: now + 3600,
    email_verified: true,
    ...claims,
  })}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    opts.key ?? googleKey.privateKey,
    new TextEncoder().encode(body),
  );
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Codes the fake token endpoint will accept: code → PKCE challenge + the ID token to return. */
const issued = new Map<string, { challenge: string; idToken: string }>();
let tokenCalls = 0;

beforeAll(async () => {
  googleKey = await rsa();
  otherKey = await rsa();
});

beforeEach(() => {
  resetGoogleKeysForTests();
  issued.clear();
  tokenCalls = 0;
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (req.url === GOOGLE_JWKS_URL) {
      const jwk = await crypto.subtle.exportKey("jwk", googleKey.publicKey);
      return Response.json(
        { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] },
        { headers: { "cache-control": "public, max-age=3600" } },
      );
    }
    if (req.url === TOKEN_URL) {
      tokenCalls++;
      const form = new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer()));
      const basic = `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`;
      const grant = issued.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = b64url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
      );
      if (
        req.headers.get("authorization") !== basic ||
        form.get("redirect_uri") !== `${ORIGIN}/api/auth/google/callback` ||
        !grant ||
        grant.challenge !== challenge
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      issued.delete(form.get("code") ?? ""); // codes are single use
      return Response.json({
        access_token: "at",
        token_type: "Bearer",
        expires_in: 3599,
        id_token: grant.idToken,
      });
    }
    return realFetch(input, init);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs /start, has "Google" approve with these claims, and returns the callback response. */
async function signIn(
  claims: Record<string, unknown>,
  opts: { returnTo?: string; session?: string } = {},
): Promise<Response> {
  const start = await call(
    `/api/auth/google/start${opts.returnTo ? `?returnTo=${encodeURIComponent(opts.returnTo)}` : ""}`,
  );
  expect(start.status).toBe(302);
  const authUrl = new URL(start.headers.get("location") ?? "");
  const code = `code-${crypto.randomUUID()}`;
  issued.set(code, {
    challenge: authUrl.searchParams.get("code_challenge") ?? "",
    idToken: await idToken(claims),
  });
  const flow = cookieFrom(start, "pact_google");
  const cookie = opts.session ? `${flow}; ${opts.session}` : flow;
  const state = authUrl.searchParams.get("state") ?? "";
  return call(`/api/auth/google/callback?code=${code}&state=${state}`, cookie);
}

const me = async (res: Response) =>
  (await (await api("/api/auth/me", { cookie: cookieFrom(res, "pact_session") })).json()) as {
    userId: string;
    username: string;
    displayName: string;
  };

describe("Google sign-in", () => {
  it("404s on the deployed config (shop off, no Google client)", async () => {
    for (const path of ["/api/auth/google/start", "/api/auth/google/callback?code=x&state=y"]) {
      const res = await api(path);
      expect(res.status).toBe(404);
    }
    // Shop on but no client: still 404.
    const noClient = { ...shopEnv, GOOGLE_CLIENT_SECRET: undefined } as unknown as Env;
    expect((await call("/api/auth/google/start", undefined, noClient)).status).toBe(404);
    // Client set but shop off: 404.
    const off = { ...shopEnv, SHOP_ENABLED: "false" } as Env;
    expect((await call("/api/auth/google/start", undefined, off)).status).toBe(404);
  });

  it("starts with state, PKCE (S256) and a short-lived Lax flow cookie", async () => {
    const res = await call("/api/auth/google/start?returnTo=/shop");
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "email",
      "openid",
      "profile",
    ]);
    expect(url.searchParams.get("state")?.length).toBeGreaterThan(20);
    const set = res.headers.getSetCookie().find((c) => c.startsWith("pact_google="));
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Path=\/api\/auth\/google/);
    expect(set).toMatch(/Max-Age=600/);
    // The verifier never appears in the URL.
    expect(url.toString()).not.toContain("code_verifier");
  });

  it("creates a user, issues pact_session and lands on returnTo with a same-origin hop", async () => {
    const sub = `g-${crypto.randomUUID()}`;
    const res = await signIn(
      { sub, email: "Jane.Doe+shop@example.com", name: "Jane Doe" },
      { returnTo: "/shop/watches?tab=1" },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('content="0;url=/shop/watches?tab=1"');
    const session = res.headers.getSetCookie().find((c) => c.startsWith("pact_session="));
    expect(session).toMatch(/SameSite=Strict/i);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("pact_google=;"))).toBe(true);

    const user = await me(res);
    expect(user.displayName).toBe("Jane Doe");
    expect(user.username).toMatch(/^jane\.doeshop/);
    const link = await shopEnv.DB.prepare(
      "SELECT user_id, email FROM shop_oauth_accounts WHERE provider = 'google' AND sub = ?",
    )
      .bind(sub)
      .first<{ user_id: string; email: string }>();
    expect(link).toEqual({ user_id: user.userId, email: "Jane.Doe+shop@example.com" });

    // Signing in again finds the same user.
    const again = await signIn({ sub, email: "Jane.Doe+shop@example.com", name: "Jane Doe" });
    expect((await me(again)).userId).toBe(user.userId);
  });

  it("gives a second Google account with the same email name its own username", async () => {
    const a = await me(await signIn({ sub: `g-${crypto.randomUUID()}`, email: "sam@a.example" }));
    const b = await me(await signIn({ sub: `g-${crypto.randomUUID()}`, email: "sam@b.example" }));
    expect(a.userId).not.toBe(b.userId);
    expect(new Set([a.username, b.username]).size).toBe(2);
    expect([a.username, b.username].every((u) => /^[a-z0-9_.-]{3,32}$/.test(u))).toBe(true);
  });

  it("links Google to the account a signed-in browser already has", async () => {
    const passkeyUser = await devLogin(`gl${crypto.randomUUID().slice(0, 8)}`, "Lin");
    const sub = `g-${crypto.randomUUID()}`;
    const res = await signIn({ sub, email: "lin@example.com" }, { session: passkeyUser.cookie });
    expect(res.status).toBe(200);
    expect((await me(res)).userId).toBe(passkeyUser.userId);
    // Later, signed out, Google alone signs into that same account.
    expect((await me(await signIn({ sub, email: "lin@example.com" }))).userId).toBe(
      passkeyUser.userId,
    );
  });

  it("refuses a wrong state, a missing or forged flow cookie, and a cancelled consent", async () => {
    const start = await call("/api/auth/google/start");
    const flow = cookieFrom(start, "pact_google");
    const authUrl = new URL(start.headers.get("location") ?? "");
    const state = authUrl.searchParams.get("state") ?? "";
    const code = "code-x";
    issued.set(code, {
      challenge: authUrl.searchParams.get("code_challenge") ?? "",
      idToken: await idToken({ sub: "g-attacker", email: "a@example.com" }),
    });

    const cases: [string, string | undefined, string][] = [
      [`/api/auth/google/callback?code=${code}&state=wrong`, flow, "invalid"],
      [`/api/auth/google/callback?code=${code}&state=${state}`, undefined, "invalid"],
      [`/api/auth/google/callback?code=${code}&state=${state}`, `${flow}x`, "invalid"],
      [`/api/auth/google/callback?error=access_denied&state=${state}`, flow, "cancelled"],
    ];
    for (const [path, cookie, reason] of cases) {
      const res = await call(path, cookie);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(`signin_error=${reason}`);
      expect(res.headers.getSetCookie().some((c) => c.startsWith("pact_session="))).toBe(false);
    }
    // None of those reached Google's token endpoint.
    expect(tokenCalls).toBe(0);
  });

  it("refuses a code Google rejects (wrong PKCE verifier) or replays", async () => {
    const sub = `g-${crypto.randomUUID()}`;
    const first = await call("/api/auth/google/start");
    const second = await call("/api/auth/google/start");
    const firstUrl = new URL(first.headers.get("location") ?? "");
    const code = "code-pkce";
    issued.set(code, {
      challenge: firstUrl.searchParams.get("code_challenge") ?? "",
      idToken: await idToken({ sub, email: "p@example.com" }),
    });
    // Another browser's flow cookie (a different verifier) with its own state.
    const secondState = new URL(second.headers.get("location") ?? "").searchParams.get("state");
    const stolen = await call(
      `/api/auth/google/callback?code=${code}&state=${secondState}`,
      cookieFrom(second, "pact_google"),
    );
    expect(stolen.status).toBe(400);

    const ok = await call(
      `/api/auth/google/callback?code=${code}&state=${firstUrl.searchParams.get("state")}`,
      cookieFrom(first, "pact_google"),
    );
    expect(ok.status).toBe(200);
    const replay = await call(
      `/api/auth/google/callback?code=${code}&state=${firstUrl.searchParams.get("state")}`,
      cookieFrom(first, "pact_google"),
    );
    expect(replay.status).toBe(400);
  });
});

describe("verifyGoogleIdToken", () => {
  const sub = "g-claims";
  it("accepts a valid token", async () => {
    expect(
      await verifyGoogleIdToken(await idToken({ sub, email: "c@example.com" }), CLIENT_ID),
    ).toEqual({ sub, email: "c@example.com" });
    // The legacy issuer spelling is valid too.
    const legacy = await idToken({ sub, iss: "accounts.google.com" });
    expect(await verifyGoogleIdToken(legacy, CLIENT_ID)).toEqual({ sub });
  });

  it.each([
    ["wrong audience", { aud: "someone-else.apps.googleusercontent.com" }],
    ["wrong issuer", { iss: "https://evil.example" }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ["issued in the future", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["unverified email", { email_verified: false }],
    ["no email_verified", { email_verified: undefined }],
    ["no sub", { sub: undefined }],
  ])("rejects %s", async (_, claims) => {
    expect(await verifyGoogleIdToken(await idToken({ sub, ...claims }), CLIENT_ID)).toBeNull();
  });

  it("rejects a bad signature, an unknown key and alg none", async () => {
    const forged = await idToken({ sub }, { key: otherKey.privateKey });
    expect(await verifyGoogleIdToken(forged, CLIENT_ID)).toBeNull();
    const unknownKid = await idToken({ sub }, { header: { kid: "nope" } });
    expect(await verifyGoogleIdToken(unknownKid, CLIENT_ID)).toBeNull();
    const [, payload] = (await idToken({ sub })).split(".");
    expect(await verifyGoogleIdToken(`${enc({ alg: "none" })}.${payload}.`, CLIENT_ID)).toBeNull();
    expect(await verifyGoogleIdToken("not-a-jwt", CLIENT_ID)).toBeNull();
  });
});

describe("safeReturnTo", () => {
  it.each([
    [undefined, "/shop"],
    ["/shop/orders?id=1#top", "/shop/orders?id=1#top"],
    ["//evil.example/x", "/shop"],
    ["/\\evil.example", "/shop"],
    ["https://evil.example/shop", "/shop"],
    ["javascript:alert(1)", "/shop"],
    ["/shop\n/x", "/shop"],
    [`/${"a".repeat(600)}`, "/shop"],
  ])("%s → %s", (raw, expected) => {
    expect(safeReturnTo(raw, ORIGIN)).toBe(expected);
  });
});
