/**
 * Renders the share image (art/og-cited-proof.svg) to public/og/cited-proof-v1.png at 1200×630,
 * with the site's own fonts. Needs a local Chrome: `npx tsx scripts/gen-og.ts` from apps/web.
 * The PNG is committed, so builds never run this.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const at = (p: string) => new URL(`../${p}`, import.meta.url);
const font = (file: string) =>
  `data:font/woff2;base64,${readFileSync(at(`public/fonts/${file}`)).toString("base64")}`;
const svg = readFileSync(at("art/og-cited-proof.svg"), "utf8");
const html = `<!doctype html><style>
@font-face{font-family:"Newsreader";font-style:normal;font-weight:200 800;src:url(${font("newsreader-latin-opsz-v1.woff2")})}
@font-face{font-family:"Newsreader";font-style:italic;font-weight:200 800;src:url(${font("newsreader-latin-opsz-italic-v1.woff2")})}
@font-face{font-family:"Geist";font-weight:100 900;src:url(${font("geist-latin-v1.woff2")})}
html,body{margin:0}svg{display:block;font-variant-numeric:tabular-nums}
</style>${svg}`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: at("public/og/cited-proof-v1.png").pathname });
await browser.close();
console.log("wrote public/og/cited-proof-v1.png");
