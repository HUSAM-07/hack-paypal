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
 * The light palette every CITED page shares. `--serif` keeps its name (dozens of rules use it)
 * but now holds the display stack: large Geist at a light weight, not a serif.
 */
export const SITE_PALETTE_CSS =
  ':root{color-scheme:light;--bg:#FFFFFF;--paper:#FFFFFF;--raise:#F6F6F7;--ink:#0B0D10;--ink-2:#33363D;--muted:#5F636B;--line:#ECECEE;--line-strong:#D9DADD;--test:#1F7A55;--test-tint:#E8F3EE;--held:#B7791F;--held-ink:#8A5A12;--held-tint:#F7EEDD;--void:#9B3B2A;--cream:#0B0D10;--link:#2E6BE6;--pp-text:#003087;--serif:"Geist","Geist Fallback",ui-sans-serif,system-ui,sans-serif}';

/**
 * The theme shared by the server-rendered pages (console, /try, /creators, /mcp). Pages append
 * it after their own CSS: it redefines the tokens they already use and restyles the shared
 * pieces (buttons, headings) into black pills and light display type.
 */
export const SITE_THEME_CSS = [
  SITE_PALETTE_CSS,
  "body{background:var(--bg)}",
  "::selection{background:var(--test-tint);color:var(--ink)}",
  ":focus-visible{outline-color:var(--link)}",
  "h1,h2{font-weight:400;letter-spacing:-.025em}",
  ".btn{background:var(--cream);color:var(--bg);font-family:var(--sans);font-weight:500;letter-spacing:0;text-transform:none;font-size:.9rem;border-radius:999px;padding:.6rem 1.1rem}",
  ".btn:hover{background:#2B2E36}",
  ".btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line-strong)}",
  ".btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--ink-2)}",
  "code{background:var(--raise)}",
].join("");

/** The nav entry the top bar shows as its call-to-action pill instead of a plain link. */
export const SITE_CTA_KEY: SiteNavKey = "try";

/**
 * The one top bar every CITED page renders, server pages and React pages alike, so moving
 * between pages never changes the frame. Sized in px: each page has its own root font size.
 * Colours read the page's tokens, so a dark page gets a dark bar.
 */
export const SITE_HEADER_CSS = [
  ".site-top{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg,#fff) 82%,transparent);-webkit-backdrop-filter:saturate(1.6) blur(12px);backdrop-filter:saturate(1.6) blur(12px);border-bottom:1px solid var(--line,#ECECEE)}",
  ".site-bar{box-sizing:border-box;max-width:1200px;margin:0 auto;padding:0 clamp(16px,4vw,40px);height:60px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:24px}",
  '.site-mark{display:inline-flex;align-items:center;gap:9px;font:600 17px/1 "Geist",ui-sans-serif,system-ui,sans-serif;letter-spacing:-.01em;color:var(--ink,#0B0D10);text-decoration:none;justify-self:start}',
  ".site-mark svg{width:24px;height:24px;flex:none}",
  ".site-nav{display:flex;gap:28px;overflow-x:auto;scrollbar-width:none}",
  ".site-nav::-webkit-scrollbar{display:none}",
  '.site-nav a{font:450 14px/1 "Geist",ui-sans-serif,system-ui,sans-serif;color:var(--ink-2,#33363D);text-decoration:none;white-space:nowrap;padding:8px 0}',
  ".site-nav a:hover,.site-nav a[aria-current]{color:var(--ink,#0B0D10)}",
  ".site-nav a[aria-current]{box-shadow:inset 0 -1.5px 0 currentColor}",
  '.site-cta{justify-self:end;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:999px;background:var(--ink,#0B0D10);color:var(--bg,#fff);font:500 13.5px/1 "Geist",ui-sans-serif,system-ui,sans-serif;text-decoration:none;white-space:nowrap;transition:transform .15s,opacity .15s}',
  ".site-cta:hover{opacity:.86}.site-cta:active{transform:scale(.97)}",
  ".site-mark:focus-visible,.site-nav a:focus-visible,.site-cta:focus-visible{outline:2px solid var(--link,#2E6BE6);outline-offset:3px;border-radius:6px}",
  "@media (max-width:860px){.site-bar{height:auto;grid-template-columns:1fr auto;padding-top:12px;padding-bottom:2px;row-gap:2px}.site-nav{grid-column:1/-1;grid-row:2;gap:20px}}",
  "@media (pointer:coarse){.site-nav a{display:inline-flex;align-items:center;min-height:44px}}",
  ".clean .site-top{display:none}",
  ".site-skip{position:absolute;left:12px;top:-64px;z-index:60;background:#16181D;color:#FAF8F4;font:500 13px/1 system-ui,sans-serif;padding:12px 16px;border-radius:4px;text-decoration:none}",
  ".site-skip:focus{top:12px;outline:2px solid #1F7A55;outline-offset:2px}",
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
    ? `<a class="site-cta" href="${href(cta.href)}"${current === SITE_CTA_KEY ? ' aria-current="page"' : ""}>${cta.label}</a>`
    : "";
  return `${SITE_SKIP_HTML}<header class="site-top"><div class="site-bar"><a class="site-mark" href="${href("/")}">${SITE_MARK_SVG}CITED</a><nav class="site-nav" aria-label="CITED">${links}</nav>${ctaHtml}</div></header>`;
}

/**
 * The judge tour's script (apps/web/src/tour). Every public page loads it; it draws nothing
 * unless the tour was started with `?tour=N`. A module script, so it runs after the page parses.
 */
export const TOUR_SCRIPT = '<script type="module" src="/fx/tour.js"></script>';
