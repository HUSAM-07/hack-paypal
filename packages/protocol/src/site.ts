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
 * The theme shared by the server-rendered pages (console, /try, /creators, /mcp), the
 * same palette as the landing's stylesheet. Pages append it after their own CSS: it redefines
 * the tokens they already use and restyles the shared pieces (nav, buttons, headings).
 */
export const SITE_THEME_CSS = [
  ":root{color-scheme:light;--bg:#FAF8F4;--paper:#FFFFFF;--raise:#F1EDE5;--ink:#16181D;--ink-2:#33363D;--muted:#5B5F68;--line:#E6E2DA;--line-strong:#CFC9BD;--test:#1F7A55;--test-tint:#E7F1EC;--held:#B7791F;--held-ink:#8A5A12;--held-tint:#F7EEDD;--void:#9B3B2A;--cream:#16181D;--pp-text:#003087}",
  "::selection{background:var(--test-tint);color:var(--ink)}",
  ":focus-visible{outline-color:var(--test)}",
  ".nav{align-items:center;padding-bottom:18px;border-bottom:1px solid var(--line)}",
  ".nav a{font-family:var(--mono);font-size:.62rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}",
  ".nav .mark{font-family:var(--serif);font-size:1.2rem;font-weight:500;letter-spacing:.01em;text-transform:none;color:var(--ink)}",
  ".nav a[aria-current]{box-shadow:inset 0 -1px 0 var(--test)}",
  "h1{font-weight:300}",
  ".btn{background:var(--cream);color:var(--bg);font-family:var(--mono);font-weight:500;letter-spacing:.07em;text-transform:uppercase;font-size:.72rem}",
  ".btn:hover{background:#2B2E36}",
  ".btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line-strong)}",
  ".btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--ink-2)}",
  "code{background:var(--raise)}",
].join("");
