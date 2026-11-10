import { SELF } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UPC_WINIX_A230 } from "@pact/protocol";
import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed tool results
type Json = any;

const ORIGIN = "https://example.com";
const selfFetch = ((input: string | URL | Request, init?: RequestInit) =>
  SELF.fetch(new Request(input, init))) as typeof fetch;

describe("public catalogue MCP server at /mcp", () => {
  it("initialize → tools/list → search_product → checkout; the engine records it as source mcp", async () => {
    const client = new Client({ name: "judge-agent", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: selfFetch }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search_product", "checkout"]);

    const found = (await client.callTool({
      name: "search_product",
      arguments: { query: "air purifier" },
    })) as Json;
    const offer = found.structuredContent.offers.find(
      (o: Json) => o.seller.id === "lumen" && o.upc === UPC_WINIX_A230,
    );
    const bought = (
      (await client.callTool({ name: "checkout", arguments: { offerId: offer.offerId } })) as Json
    ).structuredContent;
    expect(bought.status).toBe("COMPLETED");
    expect(bought.engineRecord).toBe("/api/cited/api/journeys?source=mcp");

    const mcp = (await (
      await SELF.fetch(`${ORIGIN}/api/cited/api/journeys?source=mcp`)
    ).json()) as Json;
    const mine = mcp.journeys.find((j: Json) => j.orderId === bought.orderId);
    expect(mine).toMatchObject({ source: "mcp", storeChosen: "lumen" });
    expect(String(mine.sessionId)).toMatch(/^mcp_/);
    expect(mine.verdict.creditable).toBe(mine.arm === "test");
    // Never credited, and never in the study's journeys the console reads.
    expect(mine.commission).toEqual({ pending: 0, paid: 0, voided: 0 });
    const study = (await (
      await SELF.fetch(`${ORIGIN}/api/cited/api/journeys?limit=200`)
    ).json()) as Json;
    expect(study.journeys.some((j: Json) => j.orderId === bought.orderId)).toBe(false);
    await client.close();
  });

  it("serves a how-to page to browsers, CORS preflight, and refuses GET streams", async () => {
    const page = await SELF.fetch(`${ORIGIN}/mcp`, { headers: { accept: "text/html" } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("claude mcp add --transport http cited https://example.com/mcp");
    expect(html).toContain("mcp-remote");

    const pre = await SELF.fetch(`${ORIGIN}/mcp`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-expose-headers")).toContain("mcp-session-id");

    const sse = await SELF.fetch(`${ORIGIN}/mcp`, { headers: { accept: "text/event-stream" } });
    expect(sse.status).toBe(405);

    const lost = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": "not-a-session",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(lost.status).toBe(404);
  });
});
