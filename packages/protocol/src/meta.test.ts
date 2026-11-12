import { describe, expect, it } from "vitest";
import { robotsTxt, SITE_HEAD_HTML, SITE_PAGES, siteMeta, sitemapXml } from "./index";

describe("site metadata", () => {
  it("lists every public page in the sitemap, on the request's origin", () => {
    const xml = sitemapXml("https://example.test");
    for (const p of SITE_PAGES) expect(xml).toContain(`<loc>https://example.test${p.path}</loc>`);
    expect(xml).not.toContain("/app");
    expect(xml).not.toContain("/studio");
  });
  it("points robots.txt at the sitemap and keeps APIs out", () => {
    const txt = robotsTxt("https://example.test");
    expect(txt).toContain("Sitemap: https://example.test/sitemap.xml");
    expect(txt).toContain("Disallow: /api/");
  });
  it("gives a page its canonical URL and share card, escaped", () => {
    const html = siteMeta({ title: 'A "quoted" <title>', path: "/try" });
    expect(html).toContain(
      '<link rel="canonical" href="https://pact-worker.vincent-wesley-liem.workers.dev/try">',
    );
    expect(html).toContain("A &quot;quoted&quot; &lt;title&gt;");
    expect(html).toContain('name="twitter:card"');
  });
  it("marks noindex pages and drops their canonical", () => {
    const html = siteMeta({ title: "x", path: "/", noindex: true });
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain("canonical");
  });
  it("puts icons, the manifest and theme colours in every page head", () => {
    expect(SITE_HEAD_HTML).toContain('href="/favicon.svg"');
    expect(SITE_HEAD_HTML).toContain('rel="manifest"');
    expect(SITE_HEAD_HTML).toContain('name="theme-color"');
    expect(SITE_HEAD_HTML).toContain('src="/theme.js"');
  });
});
