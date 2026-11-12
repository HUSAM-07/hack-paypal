import { SELF } from "cloudflare:test";
import { env as rawEnv } from "cloudflare:workers";
import { UPC_LEVOIT_CORE300, UPC_WINIX_A230 } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { buildTests, parsePayoutForm, type TestForm } from "../src/creators/routes";
import { creatorIdFor } from "../src/creators/session";

const env = rawEnv as unknown as { DB: D1Database };
const ORIGIN = "https://example.com";

/** A tiny cookie jar: enough for the redirect chain of one sign-in. */
function jar() {
  const cookies = new Map<string, string>();
  return {
    async fetch(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
      const res = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const [k, ...v] = (pair ?? "").split("=");
        if (!k) continue;
        if (/max-age=0/i.test(c) || v.join("=") === "") cookies.delete(k);
        else cookies.set(k, v.join("="));
      }
      return res;
    },
    cookies,
  };
}

async function signIn() {
  const j = jar();
  const connect = await j.fetch("/creators/connect");
  expect(connect.status).toBe(302);
  const consentUrl = new URL(connect.headers.get("location") ?? "");
  expect(consentUrl.pathname).toBe("/creators/paypal/simulated");
  const consent = await j.fetch(consentUrl.pathname + consentUrl.search);
  const html = await consent.text();
  expect(html).toContain("Simulated PayPal sign-in");
  const agree = /href="([^"]+)">Agree and connect/.exec(html)?.[1]?.replaceAll("&#38;", "&");
  const cb = new URL(agree ?? "");
  const back = await j.fetch(cb.pathname + cb.search);
  expect(back.headers.get("location")).toBe("/creators");
  return j;
}

const form = (csrf: string, over: Record<string, string> = {}) =>
  new URLSearchParams({
    csrf,
    name: "Quiet Rooms",
    skus: UPC_WINIX_A230,
    verdict: UPC_LEVOIT_CORE300,
    summary:
      "Both units ran for a week in the same 140 sq ft bedroom; the Core 300 was quieter at night and held PM2.5 lower.",
    disclosure: "I may earn a commission from CITED when an agent buys after reading this.",
    placeboTopic: "desk lamps",
    placeboSummary: "Three desk lamps compared on glare, colour and how warm the base gets.",
    ...over,
  });

function withBoth(f: URLSearchParams) {
  f.append("skus", UPC_LEVOIT_CORE300);
  return f;
}

describe("/creators onboarding (simulated PayPal)", () => {
  it("signs in with simulated Log in with PayPal and publishes a test as an onboarding creator", async () => {
    const j = await signIn();
    const home = await (await j.fetch("/creators")).text();
    const payerId = /PayPal account ID <code>([A-Z0-9]+)<\/code>/.exec(home)?.[1] ?? "";
    expect(payerId).toMatch(/^[A-Z2-9]{13}$/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(home)?.[1] ?? "";

    const res = await j.fetch("/creators/tests", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: withBoth(form(csrf)).toString(),
    });
    expect(res.status).toBe(303);
    const loc = res.headers.get("location") ?? "";
    const done = await (await j.fetch(loc)).text();
    expect(done).toContain("Your test enters the holdout schedule: 50/50 for 7 days, then 5%.");
    const creatorId = await creatorIdFor(payerId);
    expect(done).toContain(`/studio/creator?creator=${creatorId}`);

    const row = await env.DB.prepare("SELECT * FROM creators WHERE creator_id = ?")
      .bind(creatorId)
      .first();
    expect(row).toMatchObject({ paypal_id: payerId, source: "onboarding", name: "Quiet Rooms" });
    const tests = await env.DB.prepare(
      "SELECT kind, category FROM creator_tests WHERE creator_id = ? ORDER BY kind",
    )
      .bind(creatorId)
      .all();
    expect(tests.results).toEqual([
      { kind: "placebo", category: "desk-lamps" },
      { kind: "test", category: "air-purifier" },
    ]);
  });

  it("refuses a cross-site post, a missing form token and an unsigned-in post", async () => {
    const j = await signIn();
    const home = await (await j.fetch("/creators")).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(home)?.[1] ?? "";
    const post = (headers: Record<string, string>, body: string, via = j.fetch) =>
      via("/creators/tests", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body,
      });
    expect(
      (await post({ origin: "https://evil.example" }, withBoth(form(csrf)).toString())).status,
    ).toBe(403);
    expect((await post({}, withBoth(form(csrf)).toString())).status).toBe(403);
    expect((await post({ origin: ORIGIN }, withBoth(form("nope")).toString())).status).toBe(403);
    const anon = jar();
    const r = await post({ origin: ORIGIN }, withBoth(form(csrf)).toString(), anon.fetch);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/creators");
  });

  it("re-renders with creator-facing errors for an invalid test", async () => {
    const j = await signIn();
    const home = await (await j.fetch("/creators")).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(home)?.[1] ?? "";
    const res = await j.fetch("/creators/tests", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: form(csrf, { summary: "too short", disclosure: "no mention" }).toString(),
    });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Pick at least two products");
    expect(html).toContain("say you may earn a commission");
  });

  it("rejects a callback whose state this browser didn't start", async () => {
    const res = await jar().fetch(
      "/creators/callback?code=sim_abcdefghij&state=forgedforgedforged",
    );
    expect(res.headers.get("location")).toBe("/creators?error=state");
  });

  it("never touches the recorded demo's creators", async () => {
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM creators WHERE source = 'demo'",
    ).first<{ n: number }>();
    await signIn();
    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM creators WHERE source = 'demo'",
    ).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});

describe("buildTests", () => {
  const base: TestForm = {
    name: "Quiet Rooms",
    skus: [UPC_WINIX_A230, UPC_LEVOIT_CORE300],
    verdict: "close",
    summary: "x".repeat(80),
    disclosure: "May earn a commission.",
    placeboTopic: "Desk lamps!",
    placeboSummary: "y".repeat(50),
  };

  it("makes a close call with no verdict and a placebo with no SKUs", () => {
    const r = buildTests(base, "c-1", "abc");
    expect(r.ok && r.test.verdictUpc).toBeUndefined();
    expect(r.ok && r.placebo).toMatchObject({ kind: "placebo", category: "desk-lamps", skus: [] });
  });

  it("only takes catalogue UPCs, and keeps placebos off the test's topic", () => {
    const r = buildTests(
      { ...base, skus: [UPC_WINIX_A230, "999999999999"], placeboTopic: "Air purifiers" },
      "c-1",
      "abc",
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toMatch(/at least two products.*other than air purifiers/);
  });
});

describe("/creators payout choice (PayPal or Venmo)", () => {
  const save = (j: ReturnType<typeof jar>, csrf: string, f: Record<string, string>) =>
    j.fetch("/creators/payout", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, ...f }).toString(),
    });
  const tokenOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

  it("offers the choice after connecting, with PayPal selected to start", async () => {
    const j = await signIn();
    const html = await (await j.fetch("/creators")).text();
    expect(html).toContain("How you get paid");
    expect(html).toMatch(/value="PAYPAL" checked/);
    expect(html).not.toMatch(/value="VENMO" checked/);
  });

  it("saves Venmo, shows only a masked label, and never echoes the number", async () => {
    const j = await signIn();
    const home = await (await j.fetch("/creators")).text();
    const payerId = /PayPal account ID <code>([A-Z0-9]+)<\/code>/.exec(home)?.[1] ?? "";
    const res = await save(j, tokenOf(home), { method: "VENMO", venmo: "(415) 555-0123" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/creators?payout=saved");
    const after = await (await j.fetch("/creators?payout=saved")).text();
    expect(after).toContain("Saved. You will be paid to Venmo ···0123.");
    expect(after).toMatch(/value="VENMO" checked/);
    expect(after).not.toContain("555-0123");
    expect(after).not.toContain("(415)");
    const row = await env.DB.prepare("SELECT * FROM creators WHERE paypal_id = ?")
      .bind(payerId)
      .first();
    expect(row).toMatchObject({
      payout_wallet: "VENMO",
      venmo_receiver: "1-415-555-0123",
      venmo_receiver_type: "PHONE",
      source: "onboarding",
    });
    const back = await save(j, tokenOf(after), { method: "PAYPAL" });
    expect(back.status).toBe(303);
    expect(
      await env.DB.prepare("SELECT payout_wallet, venmo_receiver FROM creators WHERE paypal_id = ?")
        .bind(payerId)
        .first(),
    ).toEqual({ payout_wallet: "PAYPAL", venmo_receiver: null });
  });

  it("re-renders with a plain message for a bad Venmo detail, and saves nothing", async () => {
    const j = await signIn();
    const home = await (await j.fetch("/creators")).text();
    const payerId = /PayPal account ID <code>([A-Z0-9]+)<\/code>/.exec(home)?.[1] ?? "";
    const res = await save(j, tokenOf(home), { method: "VENMO", venmo: "123" });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Venmo payouts need a US mobile number");
    expect(html).toContain('value="123"');
    expect(
      await env.DB.prepare("SELECT 1 FROM creators WHERE paypal_id = ?").bind(payerId).first(),
    ).toBeNull();
  });

  it("refuses a cross-site post, a bad form token and a signed-out post", async () => {
    const j = await signIn();
    const home = await (await j.fetch("/creators")).text();
    const csrf = tokenOf(home);
    const body = new URLSearchParams({ csrf, method: "PAYPAL" }).toString();
    const post = (headers: Record<string, string>, b = body, via = j.fetch) =>
      via("/creators/payout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: b,
      });
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect((await save(j, "nope", { method: "PAYPAL" })).status).toBe(403);
    const anon = jar();
    const r = await post({ origin: ORIGIN }, body, anon.fetch);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/creators");
  });

  it("parsePayoutForm checks the choice before anything is sent", () => {
    expect(parsePayoutForm("PAYPAL", "ignored")).toEqual({ ok: true, method: "PAYPAL" });
    expect(parsePayoutForm("VENMO", "@quiet-rooms")).toEqual({
      ok: true,
      method: "VENMO",
      venmo: "@quiet-rooms",
    });
    for (const [m, v] of [
      ["VENMO", ""],
      ["VENMO", "+44 7700 900123"],
      ["VENMO", "no"],
      ["CASH", "@quiet-rooms"],
      [undefined, undefined],
    ])
      expect(parsePayoutForm(m, v).ok).toBe(false);
  });
});
