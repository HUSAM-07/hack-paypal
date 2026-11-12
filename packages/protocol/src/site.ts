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
 * The theme shared by the server-rendered pages (console, /try, /creators, /mcp), the
 * same palette as the landing's stylesheet. Pages append it after their own CSS: it redefines
 * the tokens they already use and restyles the shared pieces (buttons, headings).
 */
export const SITE_THEME_CSS = [
  ":root{color-scheme:light;--bg:#FAF8F4;--paper:#FFFFFF;--raise:#F1EDE5;--ink:#16181D;--ink-2:#33363D;--muted:#5B5F68;--line:#E6E2DA;--line-strong:#CFC9BD;--test:#1F7A55;--test-tint:#E7F1EC;--held:#B7791F;--held-ink:#8A5A12;--held-tint:#F7EEDD;--void:#9B3B2A;--cream:#16181D;--pp-text:#003087}",
  "::selection{background:var(--test-tint);color:var(--ink)}",
  ":focus-visible{outline-color:var(--test)}",
  "h1{font-weight:300}",
  ".btn{background:var(--cream);color:var(--bg);font-family:var(--mono);font-weight:500;letter-spacing:.07em;text-transform:uppercase;font-size:.72rem}",
  ".btn:hover{background:#2B2E36}",
  ".btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line-strong)}",
  ".btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--ink-2)}",
  "code{background:var(--raise)}",
].join("");

/**
 * The one top bar every CITED page renders, server pages and React pages alike, so moving
 * between pages never changes the frame. Sized in px: each page has its own root font size.
 */
export const SITE_HEADER_CSS = [
  ".site-top{position:sticky;top:0;z-index:50;background:rgba(250,248,244,.92);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid #E6E2DA}",
  ".site-bar{box-sizing:border-box;max-width:1280px;margin:0 auto;padding:0 clamp(16px,4vw,56px);height:64px;display:flex;align-items:center;justify-content:space-between;gap:24px}",
  '.site-mark{font:500 23px/1 "Newsreader",Georgia,serif;letter-spacing:.01em;color:#16181D;text-decoration:none;flex:none}',
  ".site-nav{display:flex;gap:26px;overflow-x:auto;scrollbar-width:none}",
  ".site-nav::-webkit-scrollbar{display:none}",
  '.site-nav a{font:500 11.5px/1 "Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#33363D;text-decoration:none;white-space:nowrap;padding:8px 0}',
  ".site-nav a:hover{color:#16181D}",
  ".site-nav a[aria-current]{color:#16181D;box-shadow:inset 0 -1px 0 #1F7A55}",
  ".site-mark:focus-visible,.site-nav a:focus-visible{outline:2px solid #1F7A55;outline-offset:3px;border-radius:2px}",
  "@media (max-width:760px){.site-bar{height:auto;flex-wrap:wrap;padding-top:14px;padding-bottom:4px;row-gap:4px}.site-nav{flex-basis:100%;gap:18px}}",
  "@media (pointer:coarse){.site-nav a{display:inline-flex;align-items:center;min-height:44px}}",
  ".clean .site-top{display:none}",
  ".site-skip{position:absolute;left:12px;top:-64px;z-index:60;background:#16181D;color:#FAF8F4;font:500 13px/1 system-ui,sans-serif;padding:12px 16px;border-radius:4px;text-decoration:none}",
  ".site-skip:focus{top:12px;outline:2px solid #1F7A55;outline-offset:2px}",
  ".clean .site-skip{display:none}",
].join("");

/** The skip link, first in the tab order; the page's `<main>` carries `id="main"`. */
export const SITE_SKIP_HTML = `<a class="site-skip" href="#main">Skip to content</a>`;

/** The top bar as HTML, for the server-rendered pages (`href` as in `siteNavLinks`). */
export function siteHeader(
  current?: SiteNavKey,
  href: (path: string) => string = (p) => p,
): string {
  return `${SITE_SKIP_HTML}<header class="site-top"><div class="site-bar"><a class="site-mark" href="${href("/")}">CITED</a><nav class="site-nav" aria-label="CITED">${siteNavLinks(current, href)}</nav></div></header>`;
}

/**
 * The judge tour's script (apps/web/src/tour). Every public page loads it; it draws nothing
 * unless the tour was started with `?tour=N`. A module script, so it runs after the page parses.
 */
export const TOUR_SCRIPT = '<script type="module" src="/fx/tour.js"></script>';
