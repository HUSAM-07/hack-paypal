import { describe, expect, it } from "vitest";
import { notFoundPage, wantsHtml } from "../src/not-found";

describe("404", () => {
  it("serves a page to browsers and JSON to API clients", () => {
    expect(wantsHtml("/nope", "text/html,application/xhtml+xml")).toBe(true);
    expect(wantsHtml("/nope", "application/json")).toBe(false);
    expect(wantsHtml("/nope", undefined)).toBe(false);
    expect(wantsHtml("/api/cited/nope", "text/html")).toBe(false);
  });

  it("the page links back into the product and has one main landmark", () => {
    const html = notFoundPage();
    expect(html).toContain('<main id="main">');
    expect(html).toContain('href="/proof"');
    expect(html).toContain("<title>Page not found · CITED</title>");
  });
});
