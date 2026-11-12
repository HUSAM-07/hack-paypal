// @vitest-environment node
import { readFileSync } from "node:fs";
import { SITE_HEAD_HTML, SITE_STYLE_CSS } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { SITE_HEAD_FILE, SITE_THEME_CSS_FILE, siteThemeCssFile } from "./site-theme";

describe("generated theme files (run scripts/gen-theme-css.ts after changing the theme)", () => {
  it("site-theme.css matches @pact/protocol's theme", () => {
    expect(readFileSync(SITE_THEME_CSS_FILE, "utf8")).toBe(siteThemeCssFile(SITE_STYLE_CSS));
  });
  it("site-head.html matches SITE_HEAD_HTML", () => {
    expect(readFileSync(SITE_HEAD_FILE, "utf8")).toBe(`${SITE_HEAD_HTML}\n`);
  });
});
