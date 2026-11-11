import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { previewFor, withLinkPreview } from "../src/link-preview";

const ORIGIN = "https://example.com";
const ogTitles = (html: string) => html.match(/property="og:title"/g)?.length ?? 0;

describe("link previews", () => {
  it("adds one set of tags to the server-rendered pages that have none", async () => {
    for (const [path, title] of [
      ["/console?clean=1", "CITED: two AI agents, one request"],
      ["/console/payout?clean=1", "CITED: the day-30 payout"],
      ["/creators", "CITED for creators"],
      ["/mcp", "CITED catalogue MCP server"],
    ] as const) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: { accept: "text/html" } });
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(ogTitles(html), path).toBe(1);
      expect(html, path).toContain(`<meta property="og:title" content="${title}">`);
      expect(html.indexOf("og:title"), path).toBeLessThan(html.indexOf("</head>"));
    }
  });

  it("leaves pages that carry their own tags, non-HTML and errors alone", async () => {
    const own = new Response('<html><head><meta property="og:title" content="x"></head></html>', {
      headers: { "content-type": "text/html" },
    });
    expect(ogTitles(await (await withLinkPreview("/console", own)).text())).toBe(1);

    const json = Response.json({ ok: true });
    expect(await (await withLinkPreview("/console", json)).json()).toEqual({ ok: true });

    const missing = new Response("<html><head></head></html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
    expect(ogTitles(await (await withLinkPreview("/console", missing)).text())).toBe(0);

    expect(previewFor("/")).toBeUndefined();
    expect(previewFor("/consoles")).toBeUndefined();
    expect(previewFor("/console/payout")?.title).toBe("CITED: the day-30 payout");
  });
});
