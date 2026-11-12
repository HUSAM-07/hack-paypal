import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/ledger";
import { clearReadCache } from "../src/read-cache";

const ORIGIN = "https://example.com";

describe("/console/ledger", () => {
  it("serves an accessible page in the site frame, with the nav entry current", async () => {
    const res = await SELF.fetch(`${ORIGIN}/console/ledger`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<a class="site-skip" href="#main">');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<a href="/console/ledger" aria-current="page">Ledger</a>');
    expect(html).toContain("<h1>Does the ledger match PayPal?</h1>");
    expect(html).toContain("our simulation of it");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('property="og:title"'); // link preview tags are added
    // The data is drawn with textContent, never as HTML.
    expect(html).not.toContain("innerHTML");
  });

  it("returns the checks as JSON, read-only, and shares one result for a few seconds", async () => {
    clearReadCache();
    const a = await SELF.fetch(`${ORIGIN}/console/ledger/checks.json`);
    expect(a.status).toBe(200);
    expect(a.headers.get("cache-control")).toBe("no-store");
    const first = (await a.json()) as {
      generatedAt: string;
      paypalMode: string;
      report: { counts: { fail: number } };
    };
    expect(first.paypalMode).toBe("simulated");
    expect(first.report.counts.fail).toBe(0);
    const b = (await (await SELF.fetch(`${ORIGIN}/console/ledger/checks.json`)).json()) as {
      generatedAt: string;
    };
    expect(b.generatedAt).toBe(first.generatedAt);
  });

  it("accepts no writes", async () => {
    const res = await SELF.fetch(`${ORIGIN}/console/ledger/checks.json`, {
      method: "POST",
      body: "{}",
    });
    expect(res.status).not.toBe(200);
  });

  it("reads only the engine's public GET endpoints", async () => {
    const seen: string[] = [];
    const engine = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      seen.push(`${req.method} ${new URL(req.url).pathname}`);
      return new Response("{}", {
        status: new URL(req.url).pathname.endsWith("mock/state") ? 404 : 200,
      });
    }) as typeof fetch;
    const snap = await loadSnapshot(engine);
    expect(snap.mock).toBeNull();
    expect(seen.every((s) => s.startsWith("GET /api/"))).toBe(true);
    expect(seen).toHaveLength(6);
  });
});
