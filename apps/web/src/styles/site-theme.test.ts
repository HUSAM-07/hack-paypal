// @vitest-environment node
import { readFileSync } from "node:fs";
import { SITE_STYLE_CSS } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { SITE_THEME_CSS_FILE, siteThemeCssFile } from "./site-theme";

describe("site-theme.css", () => {
  it("matches @pact/protocol's theme (run scripts/gen-theme-css.ts after changing it)", () => {
    expect(readFileSync(SITE_THEME_CSS_FILE, "utf8")).toBe(siteThemeCssFile(SITE_STYLE_CSS));
  });
});
