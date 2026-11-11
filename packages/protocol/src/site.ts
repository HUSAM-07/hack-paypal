/**
 * The CITED site navigation, shared by every public page (landing, /proof, /try, /mcp,
 * /creators, the console) so the top nav is the same wherever a judge lands.
 */
export type SiteNavKey = "console" | "payout" | "try" | "mcp" | "proof" | "studio" | "creators";

export const SITE_NAV: readonly { key: SiteNavKey; href: string; label: string }[] = [
  { key: "console", href: "/console", label: "Console" },
  { key: "payout", href: "/console/payout", label: "Payout" },
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
 * The dark theme shared by the server-rendered pages (console, /try, /creators, /mcp), the
 * same palette as the landing's stylesheet. Pages append it after their own CSS: it redefines
 * the tokens they already use and restyles the shared pieces (nav, buttons, headings).
 */
export const SITE_THEME_CSS = [
  ":root{color-scheme:dark;--bg:#0B0B0A;--paper:#131312;--raise:#1A1A18;--ink:#EDEBE5;--ink-2:#C4C1B8;--muted:#8F8C84;--line:#262522;--line-strong:#3B3A35;--test:#5FD9A0;--test-tint:rgba(95,217,160,.1);--held:#F0B545;--held-ink:#F0B545;--held-tint:rgba(240,181,69,.1);--void:#FF7B67;--cream:#EFE9DC;--pp-text:#79B2FF}",
  "::selection{background:var(--test);color:var(--bg)}",
  ":focus-visible{outline-color:var(--test)}",
  ".nav{align-items:center;padding-bottom:18px;border-bottom:1px solid var(--line)}",
  ".nav a{font-family:var(--mono);font-size:.62rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}",
  ".nav .mark{font-family:var(--serif);font-size:1.2rem;font-weight:500;letter-spacing:.01em;text-transform:none;color:var(--ink)}",
  ".nav a[aria-current]{box-shadow:inset 0 -1px 0 var(--test)}",
  "h1{font-weight:300}",
  ".btn{background:var(--cream);color:var(--bg);font-family:var(--mono);font-weight:500;letter-spacing:.07em;text-transform:uppercase;font-size:.72rem}",
  ".btn:hover{background:#fff}",
  ".btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line-strong)}",
  ".btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--ink-2)}",
  "code{background:var(--raise)}",
].join("");
