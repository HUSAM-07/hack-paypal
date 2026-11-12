/**
 * Renders the share image to public/<SITE_OG_IMAGE.path> at 1200×630 from the site's own theme
 * (tokens, fonts and the mark), so the card always matches the pages. Needs a local Chrome:
 * `npx tsx scripts/gen-og.ts` from apps/web. The PNG is committed, so builds never run this.
 * Bump the file name in SITE_OG_IMAGE when the card changes (share caches key on the URL).
 *
 * The figures are the price-matched eval (packages/evals/results/cited-price-matched).
 */
import { readFileSync } from "node:fs";
import { SITE_MARK_SVG, SITE_OG_IMAGE, SITE_STYLE_CSS } from "@pact/protocol";
import { chromium } from "playwright";

const at = (p: string) => new URL(`../${p}`, import.meta.url);
// The theme's @font-face rules point at /fonts/…; inline them, the page has no origin.
const css = SITE_STYLE_CSS.replace(
  /url\("\/fonts\/([^"]+)"\)/g,
  (_, file: string) =>
    `url(data:font/woff2;base64,${readFileSync(at(`public/fonts/${file}`)).toString("base64")})`,
);

const rows = [
  { label: "Shown the creator's test", n: "57/57", pct: 100, arm: "primary" },
  { label: "Placebo, same creator", n: "3/54", pct: 6, arm: "warning" },
  { label: "Nothing shown", n: "3/36", pct: 8, arm: "subtle" },
];

const html = `<!doctype html><html class="light"><style>${css}
html,body{margin:0;background:var(--background)}
.card{box-sizing:border-box;width:1200px;height:630px;padding:56px 72px 52px;display:flex;flex-direction:column;
  color:var(--foreground);font-family:var(--font-sans);font-variant-numeric:tabular-nums;
  background:radial-gradient(color-mix(in oklab,var(--foreground) 9%,transparent) 1px,transparent 1.2px) 0 0/18px 18px,var(--background)}
.top{display:flex;align-items:center;justify-content:space-between;padding-bottom:22px;border-bottom:1px dashed var(--border)}
.brand{display:flex;align-items:center;gap:12px;font:650 26px/1 var(--font-sans);letter-spacing:-.01em}
.brand svg{width:38px;height:38px;color:var(--primary)}
.label{font:500 15px/1 var(--font-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground)}
h1{margin:34px 0 0;font:400 66px/1.02 var(--font-serif);letter-spacing:-.01em}
h1 em{color:var(--muted-foreground)}
.rows{margin-top:auto;display:grid;grid-template-columns:330px 1fr 64px 76px;align-items:center;gap:24px 20px}
.name{font:600 22px/1.2 var(--font-sans)}
.track{height:26px;border-radius:6px;background:var(--fill);overflow:hidden}
.bar{height:100%;border-radius:6px}
.n{font:500 16px/1 var(--font-mono);color:var(--muted-foreground);text-align:right}
.pct{font:650 26px/1 var(--font-sans);text-align:right}
.pct.primary{color:var(--primary)}
.foot{margin-top:30px;padding-top:20px;border-top:1px dashed var(--border);font:500 20px/1.3 var(--font-sans)}
.foot b{color:var(--primary);font-weight:700}.foot span{color:var(--muted-foreground)}
</style><div class="card">
<div class="top"><div class="brand">${SITE_MARK_SVG}CITED</div><div class="label">Share of agents that bought the Winix</div></div>
<h1>Pays creators on proven lift,<br><em>not last-click cookies.</em></h1>
<div class="rows">${rows
  .map(
    (r) =>
      `<div class="name">${r.label}</div><div class="track"><div class="bar" style="width:${r.pct}%;background:var(--${r.arm})"></div></div><div class="n">${r.n}</div><div class="pct ${r.arm}">${r.pct}%</div>`,
  )
  .join("")}</div>
<div class="foot"><b>+94pp</b> lift vs placebo · <b>+90.3pp</b> at the 80% lower bound · <span>147 pre-registered, price-matched sessions</span></div>
</div></html>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: at(`public${SITE_OG_IMAGE.path}`).pathname });
await browser.close();
console.log(`wrote public${SITE_OG_IMAGE.path}`);
