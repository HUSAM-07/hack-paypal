import { SELF } from "cloudflare:test";
import { env as rawEnv } from "cloudflare:workers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UPC_LEVOIT_CORE300, UPC_WINIX_A230 } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { creatorIdFor } from "../src/creators/session";
import { ADD_PUBLISHED_JS, FEED_PATH, feedData, SHAPE_SALE_JS } from "../src/mcp-page";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON
type Json = any;
const env = rawEnv as unknown as { DB: D1Database };
const ORIGIN = "https://example.com";
const selfFetch = ((input: string | URL | Request, init?: RequestInit) =>
  SELF.fetch(new Request(input, init))) as typeof fetch;

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
  };
}

async function signIn() {
  const j = jar();
  const connect = await j.fetch("/creators/connect");
  const consentUrl = new URL(connect.headers.get("location") ?? "");
  const html = await (await j.fetch(consentUrl.pathname + consentUrl.search)).text();
  const agree = /href="([^"]+)">Agree and connect/.exec(html)?.[1]?.replaceAll("&#38;", "&");
  const cb = new URL(agree ?? "");
  await j.fetch(cb.pathname + cb.search);
  return j;
}

/** Signs in as a new creator and publishes a test; returns the creator's id and the page after. */
async function publish(name: string, over: Record<string, string> = {}) {
  const j = await signIn();
  const home = await (await j.fetch("/creators")).text();
  const payerId = /PayPal account ID <code>([A-Z0-9]+)<\/code>/.exec(home)?.[1] ?? "";
  const csrf = /name="csrf" value="([^"]+)"/.exec(home)?.[1] ?? "";
  const body = new URLSearchParams({
    csrf,
    name,
    verdict: UPC_LEVOIT_CORE300,
    summary: `${name} ran both units for a week in one bedroom; the Core 300 was quieter at night and held PM2.5 lower.`,
    disclosure: "I may earn a commission from CITED when an agent buys after reading this.",
    placeboTopic: "desk lamps",
    placeboSummary: "Three desk lamps compared on glare, colour and how warm the base gets.",
    ...over,
  });
  body.append("skus", UPC_WINIX_A230);
  body.append("skus", UPC_LEVOIT_CORE300);
  const res = await j.fetch("/creators/tests", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const done =
    res.status === 303 ? await (await j.fetch(res.headers.get("location") ?? "")).text() : "";
  return { status: res.status, done, creatorId: await creatorIdFor(payerId) };
}

async function agent() {
  const client = new Client({ name: "judge-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: selfFetch }),
  );
  return client;
}

/** Opens public sessions until one is shown a creator test, as the random groups allow. */
async function sessionShown(creatorId: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const client = await agent();
    const found = (await client.callTool({
      name: "search_product",
      arguments: { query: "air purifier" },
    })) as Json;
    const content: Json[] = found.structuredContent.creatorContent;
    if (content.some((t) => t.creatorId === creatorId && t.kind === "test"))
      return { client, found };
    await client.close();
  }
  throw new Error("no session was shown the test");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shapeSale = new Function(`${SHAPE_SALE_JS}; return shapeSale;`)() as (
  j: Json,
  d: Json,
) => Json;
const addPublished = new Function(`${ADD_PUBLISHED_JS}; return addPublished;`)() as (
  d: Json,
  rows: Json,
) => void;

describe("a test published at /creators, served to a public MCP agent", () => {
  let first: { creatorId: string };

  it("the success state tells the creator how to see it", async () => {
    const out = await publish("Quiet Rooms");
    expect(out.status).toBe(303);
    expect(out.done).toContain("Point an agent at");
    expect(out.done).toContain("search for <b>air purifiers</b>");
    first = out;
  });

  it("an agent's session is shown the creator's test with the disclosure; the sale names the creator on the feed", async () => {
    const { client, found } = await sessionShown(first.creatorId);
    const mine = found.structuredContent.creatorContent.find(
      (t: Json) => t.creatorId === first.creatorId,
    );
    expect(mine).toMatchObject({
      kind: "test",
      creatorName: "Quiet Rooms",
      verdictUpc: UPC_LEVOIT_CORE300,
    });
    expect(mine.disclosure).toMatch(/commission/i);
    // The creator's content is in addition to the built-in test; it changed no offer or price.
    expect(found.structuredContent.creatorContent[0].creatorId).toBe("housefresh");
    expect(found.structuredContent.offers).toHaveLength(6);

    const offer = found.structuredContent.offers.find((o: Json) => o.seller.id === "lumen");
    const bought = (
      (await client.callTool({ name: "checkout", arguments: { offerId: offer.offerId } })) as Json
    ).structuredContent;
    await client.close();

    const feed = (await (await SELF.fetch(`${ORIGIN}${FEED_PATH}`)).json()) as Json;
    const sale = feed.journeys.find((j: Json) => j.orderId === bought.orderId);
    expect(sale.arm).toBe("test");
    expect(sale.creatorsSeen).toEqual(["housefresh", first.creatorId]);
    expect(sale.verdict.creditable).toBe(true);

    // What the page does with it: it learns the creator's name from the public list of tests.
    const list = (await (await SELF.fetch(`${ORIGIN}/api/cited/api/tests`)).json()) as Json;
    const data = feedData();
    addPublished(data, list.tests);
    const row = shapeSale(sale, data);
    expect(row.credit).toBe("pending");
    expect(row.shown.map((s: Json) => s.creator)).toEqual(["HouseFresh", "Quiet Rooms"]);
    expect(row.shown[1].headline).toBe("Product test: Winix A230 vs Levoit Core 300");
  });

  it("never reaches the study, the ledger or the stateless demo catalogue", async () => {
    const credits = await env.DB.prepare("SELECT COUNT(*) AS n FROM credits").first<{
      n: number;
    }>();
    expect(credits?.n).toBe(0);
    const res = await SELF.fetch(`${ORIGIN}/api/cited/api/journeys`);
    const study = (await res.json()) as Json;
    expect(JSON.stringify(study)).not.toContain(first.creatorId);
    // The catalogue's open demo endpoint: same MCP tools, but not a public session.
    const demo = new Client({ name: "demo", version: "1.0.0" });
    await demo.connect(
      new StreamableHTTPClientTransport(new URL(`${ORIGIN}/catalogue/mcp`), { fetch: selfFetch }),
    );
    for (let i = 0; i < 6; i++) {
      const out = (await demo.callTool({
        name: "search_product",
        arguments: { query: "air purifier", sessionId: `demo-${i}` },
      })) as Json;
      const ids = (out.structuredContent?.creatorContent ?? []).map((t: Json) => t.creatorId);
      expect(ids).not.toContain(first.creatorId);
    }
    await demo.close();
  });

  it("rejects products outside the catalogue and cleans markup out of what is stored", async () => {
    const j = await signIn();
    const home = await (await j.fetch("/creators")).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(home)?.[1] ?? "";
    const bad = new URLSearchParams({
      csrf,
      name: "<b>Eve</b>",
      verdict: "999999999999",
      summary: "x".repeat(80),
      disclosure: "I may earn a commission.",
      placeboTopic: "lamps",
      placeboSummary: "y".repeat(50),
    });
    bad.append("skus", UPC_WINIX_A230);
    bad.append("skus", "999999999999");
    const res = await j.fetch("/creators/tests", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: bad.toString(),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Pick at least two products");

    const dirty = await publish("<script>x()</script>Mallory", {
      summary: `Both units ran a week. <img src=x onerror=alert(1)> [read more](https://evil.example/p) ${"padding ".repeat(20)}`,
    });
    const row = await env.DB.prepare(
      "SELECT body FROM creator_tests WHERE creator_id = ? AND kind = 'test'",
    )
      .bind(dirty.creatorId)
      .first<{ body: string }>();
    expect(row?.body).not.toMatch(/[<>]|evil\.example|onerror=alert\(1\)>/);
    const named = await env.DB.prepare("SELECT name FROM creators WHERE creator_id = ?")
      .bind(dirty.creatorId)
      .first<{ name: string }>();
    expect(named?.name).toBe("x() Mallory");
  });

  it("only the newest three creators are live at once; the oldest drops out", async () => {
    for (const n of ["Second", "Third", "Fourth"]) {
      // Stored timestamps tick with the clock; keep them apart.
      await sleep(1100);
      await publish(n);
    }
    await sleep(3300); // the catalogue re-reads the engine every few seconds
    const seen = new Set<string>();
    for (let i = 0; i < 12 && seen.size < 3; i++) {
      const client = await agent();
      const found = (await client.callTool({
        name: "search_product",
        arguments: { query: "air purifier" },
      })) as Json;
      for (const t of found.structuredContent.creatorContent)
        seen.add(`${t.creatorName ?? t.creatorId}`);
      await client.close();
    }
    expect(seen.has("Quiet Rooms")).toBe(false);
    expect([...seen].filter((s) => s !== "housefresh").sort()).toEqual([
      "Fourth",
      "Second",
      "Third",
    ]);
  });
});
