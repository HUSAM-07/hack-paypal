/**
 * Writes src/styles/site-theme.css and src/styles/site-head.html (the <head> tags Vite puts in
 * every HTML entry) from @pact/protocol's theme (fonts, semantic tokens, base and
 * layout primitives), so React entries load the same CSS the server-rendered pages inline.
 *
 *   npx tsx apps/web/scripts/gen-theme-css.ts
 *
 * src/styles/site-theme.test.ts fails when the committed file drifts from the source.
 */
import { writeFileSync } from "node:fs";
import { SITE_HEAD_HTML, SITE_STYLE_CSS } from "@pact/protocol";
import { SITE_HEAD_FILE, SITE_THEME_CSS_FILE, siteThemeCssFile } from "../src/styles/site-theme";

writeFileSync(SITE_THEME_CSS_FILE, siteThemeCssFile(SITE_STYLE_CSS));
writeFileSync(SITE_HEAD_FILE, `${SITE_HEAD_HTML}\n`);
console.log(`wrote ${SITE_THEME_CSS_FILE} and ${SITE_HEAD_FILE}`);
