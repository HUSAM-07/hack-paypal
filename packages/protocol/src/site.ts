import { markCutouts, SITE_ICONS_HTML, SITE_MARK } from "./meta";
import { SITE_STYLE_CSS } from "./theme";

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
 * Everything a server-rendered page needs before its own CSS: fonts, the semantic colour tokens
 * and the shared base and layout primitives (all from ./theme). Put it FIRST in the page's <style>;
 * page CSS reads the tokens and never defines colours of its own.
 */
export const SITE_THEME_CSS = SITE_STYLE_CSS;

/**
 * Goes in every page's <head>: icons, the web manifest and the browser theme colours (./meta),
 * then public/theme.js, which applies the saved light/dark choice before first paint and wires
 * every `[data-theme-toggle]` button (external, so script-src 'self' allows it).
 */
export const SITE_HEAD_HTML = `${SITE_ICONS_HTML}<script src="/theme.js"></script>`;

/** The light/dark toggle in the top bar. Both icons render; CSS shows the right one. */
export const SITE_THEME_TOGGLE_HTML =
  '<button type="button" class="site-icon" data-theme-toggle aria-label="Toggle dark mode"><svg class="theme-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z"/></svg><svg class="theme-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/></svg></button>';

/** GitHub link for the top bar. */
export const SITE_REPO_URL = "https://github.com/HUSAM-07/hack-paypal";
export const SITE_GITHUB_HTML = `<a class="site-icon" href="${SITE_REPO_URL}"><span class="site-sr">Source on GitHub</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 13.2c-2.6.8-2.6-1.3-3.6-1.6m7.2 3v-2.2c0-.7.1-1-.3-1.4 1.9-.2 3.6-.9 3.6-4a3.1 3.1 0 0 0-.8-2.1 2.9 2.9 0 0 0-.1-2.1s-.7-.2-2.2.8a7.6 7.6 0 0 0-4 0C4.3 2.6 3.6 2.8 3.6 2.8a2.9 2.9 0 0 0-.1 2.1 3.1 3.1 0 0 0-.8 2.1c0 3.1 1.7 3.8 3.6 4-.4.4-.4.8-.3 1.4v2.2"/></svg></a>`;

/** The nav entry the top bar shows as its call-to-action pill instead of a plain link. */
export const SITE_CTA_KEY: SiteNavKey = "try";

/**
 * The one top bar every CITED page renders, server pages and React pages alike, so moving
 * between pages never changes the frame. Sized in px: each page has its own root font size.
 * Colours read the page's tokens, so a dark page gets a dark bar.
 */
export const SITE_HEADER_CSS = [
  // Anchor jumps land below the sticky bar on every page (the bar is taller once the nav wraps).
  ":root{--site-top-h:61px}html{scroll-padding-top:calc(var(--site-top-h) + 12px)}",
  ".site-top{position:sticky;top:0;z-index:50;background:color-mix(in oklab,var(--background) 80%,transparent);-webkit-backdrop-filter:saturate(1.6) blur(12px);backdrop-filter:saturate(1.6) blur(12px);border-bottom:1px dashed var(--border)}",
  ".site-bar{box-sizing:border-box;max-width:var(--site-col,var(--frame-wide));margin:0 auto;padding:0 clamp(14px,3vw,24px);height:60px;display:flex;align-items:center;gap:6px;border-inline:1px solid var(--border)}",
  ".site-mark{display:inline-flex;align-items:center;gap:8px;margin-right:8px;font:650 16px/1 var(--font-sans);letter-spacing:-.01em;color:var(--foreground);text-decoration:none;flex:none}",
  ".site-mark svg{width:24px;height:24px;flex:none;color:var(--primary);transition:transform .3s cubic-bezier(.2,.7,.2,1)}",
  "@media (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference){.site-mark:hover svg{transform:rotate(-14deg) scale(1.06)}}",
  ".site-nav{display:flex;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none;padding:3px;border-radius:13px;background:var(--fill);box-shadow:inset 0 0 0 1px var(--border)}",
  ".site-nav::-webkit-scrollbar{display:none}",
  ".site-nav a,.site-cta,.site-icon{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;border-radius:10px;font:500 13px/1 var(--font-sans);text-decoration:none;white-space:nowrap;transition:background-color .15s,color .15s,transform .15s}",
  ".site-nav a{position:relative;height:28px;padding:0 12px;border-radius:10px;background:transparent;color:var(--muted-foreground)}",
  ".site-nav a:hover{background:var(--fill-strong);color:var(--foreground)}",
  ".site-nav a[aria-current]{padding-left:22px;background:var(--background);color:var(--foreground);box-shadow:0 0 0 1px var(--border),0 1px 3px var(--shadow-color)}",
  '.site-nav a[aria-current]::before{content:"";position:absolute;left:10px;top:50%;width:6px;height:6px;margin-top:-3px;border-radius:50%;background:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}',
  ".site-tools{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none;padding-left:6px}",
  ".site-icon{width:30px;padding:0;border:0;cursor:pointer;background:transparent;color:var(--muted-foreground)}",
  ".site-icon:hover{color:var(--foreground);background:var(--fill-strong)}",
  ".site-icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}",
  ".site-cta{position:relative;overflow:hidden;height:32px;padding:0 14px;background:var(--primary);color:var(--primary-foreground);box-shadow:inset 0 1px 0 color-mix(in oklab,var(--primary-foreground) 22%,transparent),0 1px 2px var(--shadow-color),0 4px 14px -6px var(--primary)}",
  '.site-cta::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,color-mix(in oklab,var(--primary-foreground) 28%,transparent) 50%,transparent 65%);transform:translateX(-120%);transition:transform .5s cubic-bezier(.2,.7,.2,1)}',
  ".site-cta:hover::after{transform:translateX(120%)}",
  ".site-cta .site-cta-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in oklab,var(--primary-foreground) 25%,transparent)}",
  ".site-cta:hover{transform:translateY(-1px)}.site-cta:active,.site-icon:active,.site-nav a:active{transform:scale(.96)}",
  ".site-mark:focus-visible,.site-nav a:focus-visible,.site-cta:focus-visible,.site-icon:focus-visible{outline:2px solid var(--primary);outline-offset:2px}",
  // The nav scrolls, so its focus ring sits inside the pill instead of being clipped.
  ".site-nav a:focus-visible{outline-offset:-2px}",
  "@media (max-width:900px){.site-nav a{padding:0 9px}.site-nav a[aria-current]{padding-left:19px}.site-nav a[aria-current]::before{left:8px}}",
  "@media (max-width:760px){:root{--site-top-h:101px}.site-bar{height:auto;flex-wrap:wrap;padding-top:10px;padding-bottom:10px;row-gap:8px}.site-nav{order:3;flex-basis:100%}}",
  // Narrow phones: drop the GitHub icon so the mark, theme toggle and CTA stay on one row.
  "@media (max-width:400px){.site-tools>a.site-icon{display:none}.site-mark{margin-right:0}.site-cta{padding:0 10px}}",
  "@media (pointer:coarse){.site-nav a,.site-cta,.site-icon{min-height:40px}.site-icon{min-width:40px}}",
  ".site-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}",
  ".clean .site-top{display:none}",
  ".site-skip{position:absolute;left:12px;top:-64px;z-index:60;background:var(--foreground);color:var(--background);font:500 13px/1 var(--font-sans);padding:12px 16px;border-radius:8px;text-decoration:none}",
  ".site-skip:focus{top:12px;outline:2px solid var(--primary);outline-offset:2px}",
  ".clean .site-skip{display:none}",
].join("");

/** CITED's mark (geometry in ./meta SITE_MARK): a disc in currentColor, the cut-outs in the page background. */
export const SITE_MARK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="${SITE_MARK.disc.cx}" cy="${SITE_MARK.disc.cy}" r="${SITE_MARK.disc.r}" fill="currentColor"/>${markCutouts("var(--background)")}</svg>`;

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
    ? `<a class="site-cta" href="${href(cta.href)}"${current === SITE_CTA_KEY ? ' aria-current="page"' : ""}><span class="site-cta-dot" aria-hidden="true"></span>${cta.label}</a>`
    : "";
  const tools = `<div class="site-tools">${SITE_GITHUB_HTML}${SITE_THEME_TOGGLE_HTML}${ctaHtml}</div>`;
  return `${SITE_SKIP_HTML}<header class="site-top"><div class="site-bar"><a class="site-mark" href="${href("/")}">${SITE_MARK_SVG}CITED</a><nav class="site-nav" aria-label="CITED">${links}</nav>${tools}</div></header>`;
}

/**
 * The judge tour's script (apps/web/src/tour). Every public page loads it; it draws nothing
 * unless the tour was started with `?tour=N`. A module script, so it runs after the page parses.
 */
export const TOUR_SCRIPT = '<script type="module" src="/fx/tour.js"></script>';
