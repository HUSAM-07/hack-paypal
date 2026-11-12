/**
 * The CITED site navigation, shared by every public page (landing, /proof, /try, /mcp,
 * /creators, the console) so the top nav is the same wherever a judge lands.
 */
export type SiteNavKey =
  | "console"
  | "payout"
  | "ledger"
  | "try"
  | "mcp"
  | "proof"
  | "studio"
  | "creators";

export const SITE_NAV: readonly { key: SiteNavKey; href: string; label: string }[] = [
  { key: "console", href: "/console", label: "Console" },
  { key: "payout", href: "/console/payout", label: "Payout" },
  { key: "ledger", href: "/console/ledger", label: "Ledger" },
  { key: "try", href: "/try", label: "Run an agent" },
  { key: "mcp", href: "/mcp", label: "MCP" },
  { key: "proof", href: "/proof", label: "Proof" },
  { key: "studio", href: "/studio", label: "Studio" },
  { key: "creators", href: "/creators", label: "Creators" },
];

/**
 * The nav links as HTML, for the server-rendered pages. `href` lets a page rewrite links,
 * e.g. the console, whose own links are relative to its mount point.
 */
export function siteNavLinks(
  current?: SiteNavKey,
  href: (path: string) => string = (p) => p,
): string {
  return SITE_NAV.map(
    (l) =>
      `<a href="${href(l.href)}"${l.key === current ? ' aria-current="page"' : ""}>${l.label}</a>`,
  ).join("");
}

/**
 * Touch screens get 44px-tall nav links (the pages' nav is small type on a tight line).
 * Server-rendered pages append this to their CSS; the landing has the same rule for `.top-nav`.
 */
export const SITE_NAV_TOUCH_CSS =
  "@media (pointer:coarse){.nav a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px}}";

/**
 * The light palette every CITED page shares: near-black ink on white, hairline greys, one cobalt
 * accent (the landing's). `--serif` is Instrument Serif for display headings, `--sans` DM Sans.
 */
export const SITE_PALETTE_CSS =
  ':root{color-scheme:light;--bg:#FFFFFF;--paper:#FFFFFF;--raise:#FAFAFA;--ink:#0A0A0A;--ink-2:#3F3F46;--muted:#737373;--line:#E5E5E5;--line-strong:#D4D4D4;--accent:#2547D0;--test:#2547D0;--test-tint:#E9EDFB;--held:#B7791F;--held-ink:#8A5A12;--held-tint:#F7EEDD;--void:#B42318;--cream:#0A0A0A;--link:#2547D0;--pp-text:#003087;--serif:"Instrument Serif",ui-serif,Georgia,serif;--sans:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}';

/**
 * The theme shared by the server-rendered pages (console, /try, /creators, /mcp, ledger, 404).
 * Pages append it after their own CSS: it redefines the tokens they already use and restyles the
 * shared pieces (buttons, headings, code) to match the landing: DM Sans text, Instrument Serif
 * display headings, dashed hairlines and 10px-radius buttons.
 */
export const SITE_THEME_CSS = [
  '@font-face{font-family:"Instrument Serif";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/instrument-serif-latin-v1.woff2") format("woff2")}',
  '@font-face{font-family:"Instrument Serif";font-style:italic;font-weight:400;font-display:swap;src:url("/fonts/instrument-serif-latin-italic-v1.woff2") format("woff2")}',
  SITE_PALETTE_CSS,
  "body{background:var(--bg);font-family:var(--sans);font-synthesis-weight:none;-webkit-font-smoothing:antialiased}",
  "::selection{background:var(--test-tint);color:var(--ink)}",
  ":focus-visible{outline-color:var(--accent)}",
  "h1,h2{font-family:var(--serif);font-weight:400;letter-spacing:-.015em}",
  "h1{line-height:1.05}",
  "hr{border:0;border-top:1px dashed var(--line)}",
  ".btn{background:var(--cream);color:var(--bg);font-family:var(--sans);font-weight:500;letter-spacing:0;text-transform:none;font-size:.9rem;border-radius:10px;padding:.6rem 1rem}",
  ".btn:hover{background:#27272A}",
  ".btn.ghost{background:color-mix(in srgb,var(--ink) 5%,transparent);color:var(--ink);box-shadow:none}",
  ".btn.ghost:hover{background:color-mix(in srgb,var(--ink) 9%,transparent)}",
  "code{font-family:var(--mono);background:var(--raise);box-shadow:inset 0 0 0 1px var(--line);border-radius:5px}",
].join("");

/** The nav entry the top bar shows as its call-to-action pill instead of a plain link. */
export const SITE_CTA_KEY: SiteNavKey = "try";

/**
 * The one top bar every CITED page renders, server pages and React pages alike, so moving
 * between pages never changes the frame. Sized in px: each page has its own root font size.
 * Colours read the page's tokens, so a dark page gets a dark bar.
 */
export const SITE_HEADER_CSS = [
  '@font-face{font-family:"DM Sans";font-style:normal;font-weight:100 1000;font-display:swap;src:url("/fonts/dm-sans-latin-v1.woff2") format("woff2-variations")}',
  ".site-top{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg,#fff) 80%,transparent);-webkit-backdrop-filter:saturate(1.6) blur(12px);backdrop-filter:saturate(1.6) blur(12px);border-bottom:1px dashed var(--line,#E5E5E5)}",
  ".site-bar{box-sizing:border-box;max-width:var(--site-col,1200px);margin:0 auto;padding:0 clamp(14px,3vw,24px);height:60px;display:flex;align-items:center;gap:6px}",
  ".site-col .site-bar{border-inline:1px solid var(--line,#E5E5E5)}",
  '.site-mark{display:inline-flex;align-items:center;gap:8px;margin-right:8px;font:650 16px/1 "DM Sans",ui-sans-serif,system-ui,sans-serif;letter-spacing:-.01em;color:var(--ink,#0A0A0A);text-decoration:none;flex:none}',
  ".site-mark svg{width:24px;height:24px;flex:none;color:var(--accent,#2547D0);transition:transform .3s cubic-bezier(.34,1.56,.64,1)}",
  ".site-mark:hover svg{transform:rotate(-14deg) scale(1.06)}",
  ".site-nav{display:flex;gap:6px;min-width:0;overflow-x:auto;scrollbar-width:none}",
  ".site-nav::-webkit-scrollbar{display:none}",
  '.site-nav a,.site-cta,.site-icon{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;border-radius:10px;font:500 13px/1 "DM Sans",ui-sans-serif,system-ui,sans-serif;text-decoration:none;white-space:nowrap;transition:background-color .15s,color .15s,transform .15s}',
  ".site-nav a{padding:0 12px;background:color-mix(in srgb,var(--ink,#0A0A0A) 5%,transparent);color:var(--ink-2,#3F3F46)}",
  ".site-nav a:hover{background:color-mix(in srgb,var(--ink,#0A0A0A) 9%,transparent);color:var(--ink,#0A0A0A)}",
  ".site-nav a[aria-current]{background:color-mix(in srgb,var(--accent,#2547D0) 12%,transparent);color:var(--accent,#2547D0)}",
  ".site-tools{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none;padding-left:6px}",
  ".site-icon{width:30px;padding:0;border:0;cursor:pointer;background:color-mix(in srgb,var(--ink,#0A0A0A) 5%,transparent);color:var(--ink-2,#3F3F46)}",
  ".site-icon:hover{color:var(--ink,#0A0A0A);background:color-mix(in srgb,var(--ink,#0A0A0A) 9%,transparent)}",
  ".site-icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}",
  ".site-cta{padding:0 13px;background:var(--ink,#0A0A0A);color:var(--bg,#fff)}",
  ".site-cta:hover{opacity:.86}.site-cta:active,.site-icon:active,.site-nav a:active{transform:scale(.96)}",
  ".site-mark:focus-visible,.site-nav a:focus-visible,.site-cta:focus-visible,.site-icon:focus-visible{outline:2px solid var(--accent,#2547D0);outline-offset:2px}",
  "@media (max-width:760px){.site-bar{height:auto;flex-wrap:wrap;padding-top:10px;padding-bottom:10px;row-gap:8px}.site-nav{order:3;flex-basis:100%}}",
  "@media (pointer:coarse){.site-nav a,.site-cta,.site-icon{min-height:40px}.site-icon{min-width:40px}}",
  ".site-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}",
  ".clean .site-top{display:none}",
  '.site-skip{position:absolute;left:12px;top:-64px;z-index:60;background:var(--ink,#0A0A0A);color:var(--bg,#fff);font:500 13px/1 "DM Sans",system-ui,sans-serif;padding:12px 16px;border-radius:8px;text-decoration:none}',
  ".site-skip:focus{top:12px;outline:2px solid var(--accent,#2547D0);outline-offset:2px}",
  ".clean .site-skip{display:none}",
].join("");

/** CITED's mark: a ring with an arc cut out (a holdout) and a dot (the credited sale). */
export const SITE_MARK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M16.6 8.2A6 6 0 1 0 17.6 14" fill="none" stroke="var(--bg,#fff)" stroke-width="2.2" stroke-linecap="round"/><circle cx="17.4" cy="10.9" r="1.5" fill="var(--bg,#fff)"/></svg>';

/** The skip link, first in the tab order; the page's `<main>` carries `id="main"`. */
export const SITE_SKIP_HTML = `<a class="site-skip" href="#main">Skip to content</a>`;

/** The top bar as HTML, for the server-rendered pages (`href` as in `siteNavLinks`). */
export function siteHeader(
  current?: SiteNavKey,
  href: (path: string) => string = (p) => p,
): string {
  const cta = SITE_NAV.find((l) => l.key === SITE_CTA_KEY);
  const links = SITE_NAV.filter((l) => l.key !== SITE_CTA_KEY)
    .map(
      (l) =>
        `<a href="${href(l.href)}"${l.key === current ? ' aria-current="page"' : ""}>${l.label}</a>`,
    )
    .join("");
  const ctaHtml = cta
    ? `<div class="site-tools"><a class="site-cta" href="${href(cta.href)}"${current === SITE_CTA_KEY ? ' aria-current="page"' : ""}>${cta.label}</a></div>`
    : "";
  return `${SITE_SKIP_HTML}<header class="site-top"><div class="site-bar"><a class="site-mark" href="${href("/")}">${SITE_MARK_SVG}CITED</a><nav class="site-nav" aria-label="CITED">${links}</nav>${ctaHtml}</div></header>`;
}

/**
 * The judge tour's script (apps/web/src/tour). Every public page loads it; it draws nothing
 * unless the tour was started with `?tour=N`. A module script, so it runs after the page parses.
 */
export const TOUR_SCRIPT = '<script type="module" src="/fx/tour.js"></script>';
