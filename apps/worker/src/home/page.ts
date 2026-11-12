/**
 * The app side of the site: /signin and /home (the apps portal). The landing page markets both
 * verticals; these pages are where a signed-in person opens them. Server-rendered in the same
 * frame as /creators and the 404 page, with no scripts of their own (theme.js only).
 */
import {
  formatCurrency,
  SITE_HEAD_HTML,
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  siteMeta,
} from "@pact/protocol";
import type { ShopSummary } from "@shop/server";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (m: { amountMinor: number; currency: string }) =>
  formatCurrency(m.amountMinor, m.currency);

const CSS = `
*,*::before,*::after{box-sizing:border-box}
body{font:400 15px/1.6 var(--font-sans)}
a{color:inherit;text-underline-offset:3px}
.hero{padding:40px var(--pad) 28px}
h1{margin:0 0 10px;font:400 clamp(34px,6vw,48px)/1.08 var(--font-serif);letter-spacing:-.02em;text-wrap:balance}
h1 em{font-style:italic;color:var(--primary)}
.lede{margin:0;max-width:60ch;color:var(--muted-foreground)}
.apps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:0 var(--pad) 32px}
@media (max-width:720px){.apps{grid-template-columns:minmax(0,1fr)}}
.app{display:flex;flex-direction:column;gap:14px;min-width:0;padding:20px}
.app-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.app h2{margin:0;font:400 28px/1.1 var(--font-serif);letter-spacing:-.01em}
.app p{margin:0;color:var(--muted-foreground);font-size:14px}
.tag{font:500 11px/1 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground);padding:5px 8px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--border)}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.stat{padding:10px 12px;border-radius:8px;background:var(--fill)}
.stat b{display:block;font:500 22px/1.1 var(--font-sans);font-variant-numeric:tabular-nums}
.stat span{font-size:12px;color:var(--muted-foreground)}
.list{list-style:none;margin:0;padding:0;border-top:1px dashed var(--border)}
.list li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed var(--border);font-size:14px;min-width:0}
.list li span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list li span:last-child{flex:none;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto}
.who{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px var(--pad);border-block:1px dashed var(--border);font-size:14px}
.who form{margin:0 0 0 auto}
.linkish{font:inherit;background:none;border:0;padding:0;color:var(--muted-foreground);text-decoration:underline;text-underline-offset:3px;cursor:pointer;min-height:40px}
.linkish:hover{color:var(--foreground)}
.signin{display:grid;gap:12px;max-width:420px;padding:0 var(--pad) 40px}
.signin .ui-btn{height:44px;font-size:15px}
.note{font-size:13px;color:var(--muted-foreground)}
.err{margin:0 var(--pad) 16px;padding:10px 12px;border-radius:8px;background:var(--warning-soft);color:var(--warning-text);font-size:14px}
@media (pointer:coarse){.ui-btn{min-height:44px}}
`;

function shell(title: string, path: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${siteMeta({ title, path, noindex: true })}${SITE_HEAD_HTML}
<style>${SITE_THEME_CSS}${CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}</style></head><body>
${siteHeader()}
<div class="ui-frame-wide"><main id="main">${body}</main></div>
</body></html>`;
}

const ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Try again when you're ready.",
  invalid: "That sign-in link expired. Start again.",
  failed: "We couldn't finish signing you in. Try again in a moment.",
};

export function signInPage(opts: { returnTo: string; error?: string; googleEnabled: boolean }) {
  const start = `/api/auth/google/start?${new URLSearchParams({ returnTo: opts.returnTo })}`;
  const error =
    opts.error && ERRORS[opts.error] ? `<p class="err" role="alert">${ERRORS[opts.error]}</p>` : "";
  const google = opts.googleEnabled
    ? `<a class="ui-btn ui-btn-solid" href="${esc(start)}">Continue with Google</a>`
    : `<p class="note">Sign-in is turned off on this deployment.</p>`;
  return shell(
    "Sign in · CITED",
    "/signin",
    `<section class="hero"><p class="ui-label">The app</p>
<h1>Sign in to <em>your apps</em>.</h1>
<p class="lede">One account opens both: Shop, your PayPal shopping agent, and CITED's console. Nothing is spent without your OK.</p></section>
${error}<div class="signin">${google}
<a class="ui-btn ui-btn-quiet" href="/creators/connect">I'm a creator: log in with PayPal</a>
<p class="note">Just looking? The <a href="/console">CITED demo</a> and <a href="/shop?mock">a Shop walkthrough</a> need no account.</p></div>`,
  );
}

export interface HomeView {
  name: string;
  shop: ShopSummary | null;
  shopEnabled: boolean;
}

function shopTile(v: HomeView): string {
  const s = v.shop;
  const stats = s
    ? `<div class="stats">
<div class="stat"><b>${s.watching}</b><span>watching</span></div>
<div class="stat"><b>${s.coolingOff}</b><span>in undo window</span></div>
<div class="stat"><b>${s.orders}</b><span>orders</span></div></div>
<p>${s.walletConnected ? `PayPal wallet connected${s.wallet ? `: ${esc(s.wallet)}` : ""}.` : "Wallet not connected yet. You'll link PayPal once, the first time a purchase needs it."}${s.needsReview ? ` <b>${s.needsReview} watch${s.needsReview === 1 ? "" : "es"} need your review.</b>` : ""}</p>`
    : `<p>Tell it what you want and your price. It searches, watches, and buys through PayPal only under rules you approve, with a 10-minute undo.</p>`;
  const rows = s
    ? [
        ...s.recentOrders.map(
          (o) =>
            `<li><span>${esc(o.title)}</span><span>${money(o.total)} · ${o.status === "coolingOff" ? "undo open" : esc(o.status)}</span></li>`,
        ),
        ...s.recentWatches.map(
          (w) =>
            `<li><span>${esc(w.title)}</span><span>target ${money(w.target)}${w.last ? ` · now ${money(w.last)}` : ""}</span></li>`,
        ),
      ].join("")
    : "";
  return `<article class="app ui-card" aria-labelledby="app-shop">
<div class="app-top"><h2 id="app-shop">Shop</h2><span class="tag">for you, the buyer</span></div>
${stats}${rows ? `<ul class="list">${rows}</ul>` : ""}
<div class="links">${v.shopEnabled ? `<a class="ui-btn ui-btn-solid" href="/shop">Open Shop</a>` : `<span class="note">Shop is off on this deployment.</span>`}</div>
</article>`;
}

function citedTile(): string {
  return `<article class="app ui-card" aria-labelledby="app-cited">
<div class="app-top"><h2 id="app-cited">CITED</h2><span class="tag">for creators and brands</span></div>
<p>Creators get paid when their tests cause a sale. Brands pay only for proven lift, settled through PayPal.</p>
<ul class="list">
<li><span><a href="/console">Console</a></span><span>two agents, one sale</span></li>
<li><span><a href="/studio?view=first">Studio</a></span><span>the brand's dashboard</span></li>
<li><span><a href="/try">Run an agent</a></span><span>live, on the PayPal sandbox</span></li>
<li><span><a href="/proof">Proof</a></span><span>the pre-registered study</span></li></ul>
<div class="links"><a class="ui-btn ui-btn-solid" href="/console">Open console</a><a class="ui-btn ui-btn-quiet" href="/creators">Creators: connect PayPal</a></div>
</article>`;
}

export function homePage(v: HomeView): string {
  return shell(
    "Your apps · CITED",
    "/home",
    `<section class="hero"><p class="ui-label">Your apps</p>
<h1>Hi ${esc(v.name)}. <em>What are we doing today?</em></h1>
<p class="lede">Two apps on one PayPal rail. Shop buys for you; CITED pays the people whose reviews your agents trust.</p></section>
<div class="who"><span>Signed in as <b>${esc(v.name)}</b></span>
<form method="post" action="/home/signout"><button class="linkish" type="submit">Sign out</button></form></div>
<div class="ui-band"><div class="apps">${shopTile(v)}${citedTile()}</div></div>`,
  );
}
