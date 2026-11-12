import { describe, expect, it } from "vitest";
import { api, devLogin } from "./helpers/client";

describe("the app side: /signin, /home, /api/session", () => {
  it("reports no session to the header when signed out", async () => {
    const res = await api("/api/session");
    expect(await res.json()).toEqual({ signedIn: false });
  });

  it("sends a signed-out visitor from /home to /signin", async () => {
    const res = await api("/home", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/signin?returnTo=%2Fhome");
  });

  it("shows the sign-in page with the creator path and no off-site return", async () => {
    const res = await api("/signin?returnTo=https://evil.example/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/creators/connect");
    expect(html).not.toContain("evil.example");
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
  });

  it("opens the apps portal for a signed-in user, with both verticals", async () => {
    const { cookie } = await devLogin("home-user", "Maya");
    expect(await (await api("/api/session", { cookie })).json()).toEqual({ signedIn: true });
    const res = await api("/home", { cookie });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Hi Maya.");
    expect(html).toContain('id="app-shop"');
    expect(html).toContain('id="app-cited"');
    // A signed-in visitor at /signin goes straight on.
    const again = await api("/signin?returnTo=/home", { cookie, redirect: "manual" });
    expect(again.headers.get("location")).toBe("/home");
  });

  it("signs out only from this origin", async () => {
    const { cookie } = await devLogin("home-out");
    const cross = await api("/home/signout", {
      method: "POST",
      cookie,
      headers: { Origin: "https://evil.example" },
      redirect: "manual",
    });
    expect(cross.status).toBe(403);
    const res = await api("/home/signout", {
      method: "POST",
      cookie,
      headers: { Origin: "http://localhost:8787" },
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.getSetCookie().join(";")).toMatch(/pact_session=;|Max-Age=0/);
  });
});
