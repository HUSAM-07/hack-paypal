import { describe, expect, it } from "vitest";
import { VirtualAuthenticator } from "./helpers/authenticator";
import { api, cookieFrom } from "./helpers/client";

async function register(username: string, authr: VirtualAuthenticator) {
  const optsRes = await api("/api/auth/register/options", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  if (!optsRes.ok) return optsRes;
  const opts = (await optsRes.json()) as Parameters<VirtualAuthenticator["register"]>[0];
  return api("/api/auth/register/verify", {
    method: "POST",
    cookie: cookieFrom(optsRes, "pact_flow"),
    body: JSON.stringify({ response: await authr.register(opts) }),
  });
}

describe("passkey auth", () => {
  it("registers, logs in with a discoverable credential and reads /me", async () => {
    const authr = await VirtualAuthenticator.create();
    const reg = await register("alice", authr);
    expect(reg.status).toBe(200);
    const set = reg.headers.getSetCookie().join(";");
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);

    const loginOpts = await api("/api/auth/login/options", { method: "POST" });
    const { challenge } = (await loginOpts.json()) as { challenge: string };
    const login = await api("/api/auth/login/verify", {
      method: "POST",
      cookie: cookieFrom(loginOpts, "pact_flow"),
      body: JSON.stringify({ response: await authr.assert(challenge) }),
    });
    expect(login.status).toBe(200);
    const me = await api("/api/auth/me", { cookie: cookieFrom(login, "pact_session") });
    expect(await me.json()).toMatchObject({ username: "alice" });
  });

  it("rejects replayed challenges, wrong origins and duplicate usernames", async () => {
    const authr = await VirtualAuthenticator.create();
    expect((await register("bob", authr)).status).toBe(200);
    expect((await register("bob", await VirtualAuthenticator.create())).status).toBe(409);

    const loginOpts = await api("/api/auth/login/options", { method: "POST" });
    const flow = cookieFrom(loginOpts, "pact_flow");
    const { challenge } = (await loginOpts.json()) as { challenge: string };

    const phished = await api("/api/auth/login/verify", {
      method: "POST",
      cookie: flow,
      body: JSON.stringify({
        response: await authr.assert(challenge, { origin: "https://evil.example" }),
      }),
    });
    expect(phished.status).toBe(400);
    // The flow was consumed by the failed attempt; a retry with a valid assertion fails too.
    const replay = await api("/api/auth/login/verify", {
      method: "POST",
      cookie: flow,
      body: JSON.stringify({ response: await authr.assert(challenge) }),
    });
    expect(replay.status).toBe(400);
  });

  it("rejects forged session cookies", async () => {
    const res = await api("/api/auth/me", { cookie: "pact_session=usr_abc.9999999999.AAAA" });
    expect(res.status).toBe(401);
  });

  it("sets strict security headers on JSON responses", async () => {
    const res = await api("/api/health");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
