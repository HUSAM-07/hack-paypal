/**
 * Writes src/styles/site-theme.css from @pact/protocol's theme (fonts, semantic tokens, base and
 * layout primitives), so React entries load the same CSS the server-rendered pages inline.
 *
 *   npx tsx apps/web/scripts/gen-theme-css.ts
 *
 * src/styles/site-theme.test.ts fails when the committed file drifts from the source.
 */
import { writeFileSync } from "node:fs";
import { SITE_STYLE_CSS } from "@pact/protocol";
import { SITE_THEME_CSS_FILE, siteThemeCssFile } from "../src/styles/site-theme";

writeFileSync(SITE_THEME_CSS_FILE, siteThemeCssFile(SITE_STYLE_CSS));
console.log(`wrote ${SITE_THEME_CSS_FILE}`);
