import {
  SITE_HEADER_CSS,
  SITE_ICONS_HTML,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  siteMeta,
} from "@pact/protocol";

/** The 404 page inlines its CSS and loads the site fonts; no scripts, no forms, no frames. */
export const NOT_FOUND_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** A browser asking for a page (not an API client) gets the 404 as a page, not as JSON. */
export function wantsHtml(path: string, accept: string | undefined): boolean {
  if (path.startsWith("/api/") || path === "/api") return false;
  return (accept ?? "").includes("text/html");
}

const CSS = `
*,*::before,*::after{box-sizing:border-box}
body{font:400 15px/1.6 var(--font-sans)}
.hero{padding:40px var(--pad) 32px}
.hero-top{display:flex;align-items:center;gap:12px;margin:0 0 14px}
.hero-top p{margin:0}
.stk{display:block;filter:var(--shadow-sticker);transform:rotate(-6deg)}
h1{margin:0 0 10px;font:400 clamp(34px,6vw,44px)/1.1 var(--font-serif);letter-spacing:-.015em;text-wrap:balance}
.lede{margin:0;max-width:56ch;color:var(--muted-foreground)}
ul{margin:0;padding:0 calc(var(--pad) - 12px);list-style:none}
.row-title{flex:1;min-width:0;font:500 15px/1.45 var(--font-sans);transition:color .15s}
.ui-row:hover .row-title{color:var(--primary)}
.row-arrow{flex:none;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;color:var(--muted-foreground);transition:transform .2s,color .2s}
.ui-row:hover .row-arrow{color:var(--primary);transform:translate(2px,-2px)}
`;

const ARROW =
  '<svg class="row-arrow" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M4.5 9.5 9.5 4.5M5.5 4.5h4v4"/></svg>';

/** The page a browser sees for a URL CITED does not serve. */
export function notFoundPage(): string {
  const links: [string, string][] = [
    ["/", "Start here: what CITED is"],
    ["/?tour=1#problem", "Take the 2-minute tour"],
    ["/proof", "The pre-registered study"],
    ["/studio?view=first", "The brand's dashboard in AG Studio"],
    ["/mcp", "Point your own agent at CITED"],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page not found · CITED</title>
${siteMeta({ title: "Page not found · CITED", path: "/", noindex: true })}${SITE_ICONS_HTML}
<style>${SITE_THEME_CSS}${CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}</style></head><body class="site-col">
${siteHeader()}
<div class="ui-frame"><main id="main">
<section class="hero">
<div class="hero-top"><img class="stk" src="/art/stickers/magnifier.webp" alt="" width="44" height="44"><p class="ui-label">Error 404</p></div>
<h1>There is no page here.</h1>
<p class="lede">The link may be mistyped or out of date. These are the places worth seeing:</p>
</section>
<section class="ui-band" aria-labelledby="go">
<h2 class="ui-band-h" id="go">Places worth seeing</h2>
<ul>${links.map(([href, label]) => `<li><a class="ui-row" href="${href}"><span class="row-title">${label}</span>${ARROW}</a></li>`).join("")}</ul>
</section>
</main></div>
</body></html>`;
}
