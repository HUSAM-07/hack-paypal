import { SELF } from "cloudflare:test";
import {
  airlabWinixTest,
  housefreshWinixTest,
  narrowCloseTest,
  UPC_LEVOIT_CORE300,
  UPC_WINIX_A230,
} from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { renderProfile, shapeProfile } from "../src/creators/profile";

const ORIGIN = "https://example.com";
const get = (path: string) => SELF.fetch(`${ORIGIN}${path}`);

describe("shapeProfile", () => {
  it("shows measured lift only for fixture tests a study measured", () => {
    const v = shapeProfile({
      creatorId: "housefresh",
      name: "HouseFresh",
      tests: [housefreshWinixTest, narrowCloseTest, airlabWinixTest].map((test) => ({
        test,
        publishedAt: null,
      })),
      batches: [],
    });
    const [winix, close, notStudied] = v.tests;
    expect(winix?.measured?.proofHref).toBe("/proof#result");
    expect(winix?.measured?.credited).toBe(true);
    expect(close?.measured?.proofHref).toBe("/proof#secondary");
    expect(close?.measured?.credited).toBe(false);
    expect(notStudied?.measured).toBeNull();
  });

  it("never marks a live creator's test as measured, even with a fixture's test id", () => {
    const v = shapeProfile({
      creatorId: "c-abc123abc123",
      name: "Quiet Rooms",
      tests: [
        {
          test: { ...housefreshWinixTest, creatorId: "c-abc123abc123" },
          publishedAt: "2026-11-12T10:00:00.000Z",
        },
      ],
      batches: [],
    });
    expect(v.tests[0]?.measured).toBeNull();
    expect(v.tests[0]?.date).toBe("2026-11-12");
  });

  it("cleans and escapes creator text, and drops payer ids from payout items", () => {
    const evil =
      '<script>alert(1)</script> "x" <img src=x onerror=alert(1)> https://evil.example/p';
    const v = shapeProfile({
      creatorId: "c-abc123abc123",
      name: `Bad ${evil}`,
      tests: [
        {
          test: {
            ...housefreshWinixTest,
            creatorId: "c-abc123abc123",
            summary: `${evil} ${"z".repeat(20)}`,
            disclosure: `${evil} may earn a commission`,
          },
          publishedAt: "2026-11-12T10:00:00.000Z",
        },
      ],
      ledger: {
        totalsByCurrency: { USD: { pending: 500, voided: 100, paid: 250, frozen: 50, held: 25 } },
      },
      batches: [
        {
          senderBatchId: "b1",
          status: "SUCCESS",
          createdAt: "2026-11-12T10:00:00.000Z",
          items: [
            {
              creatorId: "c-abc123abc123",
              receiver: "SECRETPAYERID1",
              amountMinor: 250,
              currency: "USD",
            },
            {
              creatorId: "someone-else",
              receiver: "OTHERPAYER",
              amountMinor: 999,
              currency: "USD",
            },
          ],
        },
      ],
    });
    const out = renderProfile(v);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("SECRETPAYERID1");
    expect(out).not.toContain("OTHERPAYER");
    expect(out).toContain("New, not yet measured");
    expect(v.ledger[0]).toMatchObject({
      earned: "$7.50",
      paid: "$2.50",
      waiting: "$4.25",
      frozen: "$0.50",
      held: "$0.25",
      voided: "$1.00",
    });
    expect(v.payouts).toEqual([
      { batchId: "b1", status: "SUCCESS", date: "2026-11-12", amount: "$2.50" },
    ]);
  });
});

describe("/creators/:creatorId", () => {
  it("renders a demo creator with the study's measured lift and a link to /proof", async () => {
    const res = await get("/creators/housefresh");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("HouseFresh");
    expect(html).toContain('href="/proof#result"');
    expect(html).toContain("80% lower bound");
    expect(html).toContain("How CITED pays");
    expect(html).not.toMatch(/\barm\b/i);
  });

  it("says plainly when a test has no measured lift", async () => {
    const html = await (await get("/creators/airlab")).text();
    expect(html).toContain("No measured lift for this test yet");
  });

  it("is 404 for an unknown or malformed creator, and fixed /creators paths still win", async () => {
    expect((await get("/creators/nobody-here")).status).toBe(404);
    expect((await get("/creators/%3Cscript%3E")).status).toBe(404);
    const connect = await SELF.fetch(`${ORIGIN}/creators/connect`, { redirect: "manual" });
    expect(connect.status).toBe(302);
  });

  it("serves a published creator, escaped, as new and not yet measured", async () => {
    const jar = new Map<string, string>();
    const f = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      const r = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
      for (const c of r.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const [k, ...v] = (pair ?? "").split("=");
        if (k) jar.set(k, v.join("="));
      }
      return r;
    };
    const connect = await f("/creators/connect");
    const consent = new URL(connect.headers.get("location") ?? "");
    const page = await (await f(consent.pathname + consent.search)).text();
    const agree =
      /href="([^"]+)">Agree and connect/.exec(page)?.[1]?.replaceAll("&#38;", "&") ?? "";
    const cb = new URL(agree);
    await f(cb.pathname + cb.search);
    const home = await (await f("/creators")).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(home)?.[1] ?? "";
    const body = new URLSearchParams({
      csrf,
      name: 'Profile <b>Tester</b> "Q"',
      verdict: UPC_LEVOIT_CORE300,
      summary:
        "Both units ran a week in one bedroom <script>alert(1)</script>; the Core 300 was quieter at night.",
      disclosure: "I may earn a commission from CITED when an agent buys after reading this.",
      placeboTopic: "desk lamps",
      placeboSummary: "Three desk lamps compared on glare, colour and how warm the base gets.",
    });
    body.append("skus", UPC_WINIX_A230);
    body.append("skus", UPC_LEVOIT_CORE300);
    const post = await f("/creators/tests", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(post.status).toBe(303);
    const done = await (await f(post.headers.get("location") ?? "/creators")).text();
    const id =
      /href="\/creators\/(c-[0-9a-f]{12})"/.exec(done)?.[1] ??
      /studio\/creator\?creator=(c-[0-9a-f]{12})/.exec(done)?.[1] ??
      "";
    expect(id).toMatch(/^c-[0-9a-f]{12}$/);
    const profile = await (await get(`/creators/${id}`)).text();
    expect(profile).toContain("New, not yet measured");
    expect(profile).not.toContain("<script>alert");
    expect(profile).not.toContain("<b>Tester");
    expect(profile).toContain("Profile");
    expect(profile).toContain("Winix A230 vs Levoit Core 300");
  });
});
