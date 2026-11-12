import { SITE_HEADER_CSS, SITE_NAV_TOUCH_CSS, SITE_THEME_CSS, siteHeader } from "@pact/protocol";

/** A browser asking for a page (not an API client) gets the 404 as a page, not as JSON. */
export function wantsHtml(path: string, accept: string | undefined): boolean {
  if (path.startsWith("/api/") || path === "/api") return false;
  return (accept ?? "").includes("text/html");
}

const CSS = `
@font-face{font-family:"Newsreader";font-style:normal;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-latin-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-mono-latin-v1.woff2") format("woff2-variations")}
:root{--serif:"Newsreader",Charter,Georgia,serif;--sans:"Geist",ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
html{font-size:17px}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55}
main{max-width:640px;margin:0 auto;padding:4.5rem 1.4rem 5rem}
.code{font-family:var(--mono);font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 .8rem}
h1{font-family:var(--serif);font-size:2.3rem;line-height:1.15;margin:0 0 1rem}
p{margin:0 0 1rem;color:var(--ink-2)}
ul{margin:1.2rem 0 0;padding:0;list-style:none;display:grid;gap:.55rem}
a{color:var(--ink)}
li a{display:inline-block;padding:.35rem 0;text-underline-offset:3px}
li span{color:var(--muted)}
`;

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
<meta name="robots" content="noindex">
<style>${SITE_THEME_CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}${CSS}</style></head><body>
${siteHeader()}
<main id="main">
<p class="code">404</p>
<h1>There is no page here.</h1>
<p>The link may be mistyped or out of date. These are the places worth seeing:</p>
<ul>${links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ul>
</main>
</body></html>`;
}
