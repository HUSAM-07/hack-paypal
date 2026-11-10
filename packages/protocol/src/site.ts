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
