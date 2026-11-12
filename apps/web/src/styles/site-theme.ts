import { fileURLToPath } from "node:url";

/** Where the generated stylesheet lives (imported first by every React entry). */
export const SITE_THEME_CSS_FILE = fileURLToPath(new URL("./site-theme.css", import.meta.url));

/** The shared <head> tags (icons, manifest, theme colours, theme.js) Vite injects into each entry. */
export const SITE_HEAD_FILE = fileURLToPath(new URL("./site-head.html", import.meta.url));

/** The file's exact contents for a given SITE_STYLE_CSS: a header, then one rule per line. */
export function siteThemeCssFile(css: string): string {
  const body = css.replace(/}(?=\S)/g, "}\n");
  return `/* Generated from packages/protocol/src/theme.ts by scripts/gen-theme-css.ts. Do not edit. */\n${body}\n`;
}
