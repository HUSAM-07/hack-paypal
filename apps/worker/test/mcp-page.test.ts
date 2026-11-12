import { SELF } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UPC_LEVOIT_CORE300, UPC_WINIX_A230 } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { FEED_PATH, feedData, SHAPE_SALE_JS } from "../src/mcp-page";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON
type Json = any;

const ORIGIN = "https://example.com";
const selfFetch = ((input: string | URL | Request, init?: RequestInit) =>
  SELF.fetch(new Request(input, init))) as typeof fetch;

// The exact text the page ships to the browser.
const shapeSale = new Function(`${SHAPE_SALE_JS}; return shapeSale;`)() as (
  j: Json,
  d: Json,
) => Json;
const data = feedData();

const journey = (over: Json = {}): Json => ({
  orderId: "ORD-1",
  sessionId: "mcp_abc123",
  arm: "test",
  creatorsSeen: ["housefresh"],
  storeChosen: "lumen",
  items: [{ upc: UPC_WINIX_A230, amountMinor: 9599, currency: "USD" }],
  commission: { pending: 0, paid: 0, voided: 0 },
  holdStatus: "none",
  capturedAt: "2026-11-12T10:00:00.000Z",
  source: "mcp",
  verdict: { creditable: true, reason: "" },
  ...over,
});

describe("feed row shaping", () => {
  it("names the product, seller and price, and shows the test with its disclosure", () => {
    const row = shapeSale(journey(), data);
    expect(row).toMatchObject({
      product: "Winix A230",
      seller: "Lumen",
      price: "$95.99",
      group: "test",
      credit: "pending",
      sessionId: "mcp_abc123",
      orderId: "ORD-1",
    });
    expect(row.shown).toHaveLength(1);
    expect(row.shown[0].creator).toBe("HouseFresh");
    expect(row.shown[0].headline).toContain("Winix A230 vs Levoit Core 300");
    expect(row.shown[0].disclosure).toMatch(/may earn a commission/);
  });

  it("shows every creator whose test the session saw", () => {
    const row = shapeSale(journey({ creatorsSeen: ["housefresh", "airlab"] }), data);
    expect(row.shown.map((s: Json) => s.creator)).toEqual(["HouseFresh", "AirLab"]);
  });

  it("placebo: other content, not the test, and no credit", () => {
    const row = shapeSale(
      journey({ arm: "placebo", verdict: { creditable: false, reason: "" } }),
      data,
    );
    expect(row.group).toBe("placebo");
    expect(row.credit).toBe("none");
    expect(row.shown).toHaveLength(1);
    expect(row.shown[0].headline).toMatch(/^Other content/);
  });

  it("held out: nothing shown, no credit", () => {
    const row = shapeSale(
      journey({ arm: "none", creatorsSeen: [], verdict: { creditable: false, reason: "" } }),
      data,
    );
    expect(row).toMatchObject({ group: "none", shown: [], credit: "none" });
  });

  it("uses a real ledger state when the engine has one, and survives odd input", () => {
    expect(shapeSale(journey({ holdStatus: "voided" }), data).credit).toBe("voided");
    expect(shapeSale(journey({ holdStatus: "held" }), data).credit).toBe("held");
    const odd = shapeSale(
      { orderId: "o", sessionId: "s", arm: "weird", items: [{ upc: "9", amountMinor: 5 }] },
      data,
    );
    expect(odd).toMatchObject({ group: "none", product: "Product 9", price: "$0.05" });
    expect(odd.credit).toBe("none");
  });

  it("never carries markup from the API into the row as HTML (the page uses textContent)", () => {
    const row = shapeSale(journey({ storeChosen: "<img src=x onerror=alert(1)>" }), data);
    expect(row.seller).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("/mcp page", () => {
  it("has one-click setup for each client and the live feed, with a CSP that allows only its own script", async () => {
    const res = await SELF.fetch(`${ORIGIN}/mcp`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain("https:");
    const html = await res.text();
    expect(html).toContain("claude mcp add --transport http cited https://example.com/mcp");
    expect(html).toContain("&#34;url&#34;: &#34;https://example.com/mcp&#34;"); // Cursor
    expect(html).toContain("mcp-remote"); // Claude Desktop fallback
    expect(html.match(/data-copy="/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain("Kept out of the study numbers");
    expect(html).toContain(FEED_PATH);
    // Plain words: groups, not arms.
    expect(html.replace(/<script[\s\S]*?<\/script>/g, "")).not.toMatch(/\barm\b/i);
    // Nav is the shared header, with MCP current; links stay root-relative.
    expect(html).toContain('<a href="/mcp" aria-current="page">MCP</a>');
  });

  it("ships client script that parses", async () => {
    const html = await (
      await SELF.fetch(`${ORIGIN}/mcp`, { headers: { accept: "text/html" } })
    ).text();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    expect(scripts.length).toBe(1);
    // Syntax check only: constructing (not calling) an async function around the page script.
    expect(() => new Function(`return async function () {${scripts[0]}}`)).not.toThrow();
  });

  it("the feed data is embedded safely and lists the seeded products and sellers", async () => {
    const html = await (
      await SELF.fetch(`${ORIGIN}/mcp`, { headers: { accept: "text/html" } })
    ).text();
    const m = html.match(/<script type="application\/json" id="feed-data">([\s\S]*?)<\/script>/);
    const parsed = JSON.parse(m?.[1] ?? "null") as Json;
    expect(parsed.products[UPC_WINIX_A230]).toBe("Winix A230");
    expect(parsed.products[UPC_LEVOIT_CORE300]).toBe("Levoit Core 300");
    expect(parsed.sellers.lumen).toBe("Lumen");
    expect(parsed.feedPath).toBe(FEED_PATH);
  });

  it("a sale made over MCP shows up in the feed's read API with what the page needs", async () => {
    const client = new Client({ name: "judge-agent", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: selfFetch }),
    );
    const found = (await client.callTool({
      name: "search_product",
      arguments: { query: "air purifier" },
    })) as Json;
    const offer = found.structuredContent.offers.find((o: Json) => o.seller.id === "lumen");
    const bought = (
      (await client.callTool({ name: "checkout", arguments: { offerId: offer.offerId } })) as Json
    ).structuredContent;
    await client.close();

    const feed = (await (await SELF.fetch(`${ORIGIN}${FEED_PATH}`)).json()) as Json;
    const mine = feed.journeys.find((j: Json) => j.orderId === bought.orderId);
    expect(mine).toBeDefined();
    expect(feed.journeys.length).toBeLessThanOrEqual(20);
    const row = shapeSale(mine, data);
    expect(row.seller).toBe("Lumen");
    expect(row.sessionId).toMatch(/^mcp_/);
    if (mine.arm === "test") {
      expect(row.shown.length).toBeGreaterThan(0);
      expect(row.shown[0].disclosure.length).toBeGreaterThan(10);
      expect(row.credit).toBe("pending");
    } else {
      expect(row.credit).toBe("none");
    }
    // Newest first.
    const times = feed.journeys.map((j: Json) => j.capturedAt as string);
    expect([...times].sort().reverse()).toEqual(times);
  });
});
