import { describe, expect, it } from "vitest";
import { SITE_NAV, siteHeader, siteNavLinks } from "./site";

describe("site nav", () => {
  it("links every public CITED page", () => {
    expect(SITE_NAV.map((l) => l.href)).toEqual([
      "/console",
      "/console/ledger",
      "/try",
      "/mcp",
      "/proof",
      "/studio",
      "/creators",
      "/shop",
    ]);
  });

  it("puts the account link in every top bar", () => {
    expect(siteHeader()).toContain('<a class="site-account" href="/home" data-account>Sign in</a>');
  });

  it("marks the current page and lets a page rewrite hrefs", () => {
    const html = siteNavLinks("mcp", (p) => `..${p}`);
    expect(html).toContain('<a href="../mcp" aria-current="page">MCP</a>');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });
});
