/**
 * The page a judge opens at /mcp: how to point their own agent at the public MCP server, and a
 * live feed of what the engine recorded for the sales public MCP agents made. Read-only: the feed
 * polls the engine's existing public read API (`PUBLIC_MCP_SALES_PATH`), nothing is written.
 * Everything that came from the API is rendered with textContent, never as HTML.
 */
import { PRODUCTS, PUBLIC_MCP_SALES_PATH } from "@cited/catalogue-mcp";
import {
  airlabWinixTest,
  housefreshPlacebo,
  housefreshWinixTest,
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  type VerifiedTest,
} from "@pact/protocol";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export const MCP_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** How often the open page asks the engine for new sales. The read API is cached for 10 s. */
export const FEED_POLL_MS = 5000;
export const FEED_LIMIT = 20;
export const FEED_PATH = `${PUBLIC_MCP_SALES_PATH}&limit=${FEED_LIMIT}`;

const SELLER_NAMES: Record<string, string> = {
  northwind: "Northwind",
  lumen: "Lumen",
  megamart: "MegaMart",
};
const CREATOR_NAMES: Record<string, string> = { housefresh: "HouseFresh", airlab: "AirLab" };

export interface FeedShown {
  creator: string;
  headline: string;
  disclosure: string;
}

/** What the feed needs to name things: products, sellers, and the content each group sees. */
export interface FeedData {
  products: Record<string, string>;
  sellers: Record<string, string>;
  /** Content by group, then creator id. */
  content: { test: Record<string, FeedShown>; placebo: Record<string, FeedShown> };
  feedPath: string;
  pollMs: number;
}

const skuList = (t: VerifiedTest) => t.skus.map((s) => `${s.brand} ${s.name}`);

function shownFrom(t: VerifiedTest): FeedShown {
  return {
    creator: CREATOR_NAMES[t.creatorId] ?? t.creatorId,
    headline:
      t.kind === "test"
        ? `Product test: ${skuList(t).join(" vs ")}`
        : `Other content, not a test of the product: ${skuList(t).join(", ")}`,
    disclosure: t.disclosure,
  };
}

export function feedData(): FeedData {
  return {
    products: Object.fromEntries(PRODUCTS.map((p) => [p.upc, `${p.brand} ${p.name}`])),
    sellers: SELLER_NAMES,
    content: {
      test: Object.fromEntries(
        [housefreshWinixTest, airlabWinixTest].map((t) => [t.creatorId, shownFrom(t)]),
      ),
      placebo: { [housefreshPlacebo.creatorId]: shownFrom(housefreshPlacebo) },
    },
    feedPath: FEED_PATH,
    pollMs: FEED_POLL_MS,
  };
}

/**
 * Turns one engine journey (`/journeys?source=mcp`) into what a row shows. Plain ES5 on purpose:
 * this source is shipped to the browser as is, and the tests run this same text.
 * Credit status: public-MCP sales never reach the ledger, so the engine's own commission is zero
 * and the status says what CITED would do: pending (held 30 days, then paid) for a sale that
 * followed the creator's test, none otherwise. A real ledger state wins if the engine ever has one.
 */
export const SHAPE_SALE_JS = `function shapeSale(j, data) {
  var items = j.items || [];
  var total = 0, currency = "USD";
  for (var i = 0; i < items.length; i++) { total += items[i].amountMinor || 0; currency = items[i].currency || currency; }
  var first = items[0] || {};
  var arm = j.arm === "test" || j.arm === "placebo" ? j.arm : "none";
  var seen = j.creatorsSeen || [];
  var shown = [];
  if (arm !== "none") {
    for (var k = 0; k < seen.length; k++) {
      var c = data.content[arm][seen[k]];
      if (c) shown.push(c);
    }
  }
  var state = j.holdStatus && j.holdStatus !== "none" ? j.holdStatus : (j.verdict && j.verdict.creditable ? "pending" : "none");
  var sign = currency === "USD" ? "$" : currency + " ";
  var price = sign + (total / 100).toFixed(2);
  return {
    orderId: j.orderId,
    sessionId: j.sessionId,
    capturedAt: j.capturedAt,
    product: data.products[first.upc] || "Product " + (first.upc || "unknown"),
    seller: data.sellers[j.storeChosen] || j.storeChosen || "unknown seller",
    price: price,
    group: arm,
    shown: shown,
    credit: state
  };
}`;

/** The words the page uses for each group and credit state (kept beside the shape function). */
export const GROUP_WORDS: Record<string, string> = {
  test: "Test group",
  placebo: "Placebo group",
  none: "Held-out group",
};
export const CREDIT_WORDS: Record<string, string> = {
  pending: "Pending: would be held 30 days, then paid to the creator",
  held: "Held: waiting out the 30-day hold, then paid",
  voided: "Voided: the sale was refunded",
  paid: "Paid to the creator",
  none: "No credit: the test did not cause this sale",
};

const CLIENT_JS = `
var DATA = JSON.parse(document.getElementById("feed-data").textContent);
var GROUP_WORDS = ${JSON.stringify(GROUP_WORDS)};
var CREDIT_WORDS = ${JSON.stringify(CREDIT_WORDS)};
var GROUP_NOTE = {
  test: "Shown the creator's test",
  placebo: "Shown other content from the creator, not the test",
  none: "Shown no creator content"
};
${SHAPE_SALE_JS}
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function timeOf(iso) {
  var d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function row(s) {
  var li = el("li", "sale");
  var top = el("div", "sale-top");
  top.appendChild(el("span", "when num", timeOf(s.capturedAt)));
  top.appendChild(el("span", "ids", "Session " + s.sessionId + " · order " + s.orderId));
  li.appendChild(top);
  var buy = el("p", "buy");
  buy.appendChild(el("b", "", s.product));
  buy.appendChild(document.createTextNode(" from " + s.seller + " for "));
  buy.appendChild(el("b", "num", s.price));
  li.appendChild(buy);
  var shown = el("div", "shown " + s.group);
  shown.appendChild(el("p", "grp", GROUP_WORDS[s.group] + ": " + GROUP_NOTE[s.group]));
  for (var i = 0; i < s.shown.length; i++) {
    var q = el("div", "quote");
    q.appendChild(el("p", "q-head", s.shown[i].creator + " · " + s.shown[i].headline));
    q.appendChild(el("p", "q-disc", "Disclosure shown to the agent: " + s.shown[i].disclosure));
    shown.appendChild(q);
  }
  li.appendChild(shown);
  li.appendChild(el("p", "credit " + s.credit, CREDIT_WORDS[s.credit] || s.credit));
  return li;
}
function draw(journeys) {
  var list = $("sales");
  list.textContent = "";
  for (var i = 0; i < journeys.length; i++) list.appendChild(row(shapeSale(journeys[i], DATA)));
  $("empty").hidden = journeys.length > 0;
  list.hidden = journeys.length === 0;
  $("count").textContent = journeys.length === 0 ? "" : journeys.length + (journeys.length === 1 ? " sale" : " sales");
}
function say(msg, bad) { var s = $("feed-status"); s.textContent = msg; s.className = "feed-status" + (bad ? " bad" : ""); }
async function poll() {
  try {
    var res = await fetch(DATA.feedPath, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("status " + res.status);
    var body = await res.json();
    draw(Array.isArray(body.journeys) ? body.journeys : []);
    say("Updated " + new Date().toLocaleTimeString() + ". Checks again every " + DATA.pollMs / 1000 + " seconds.", false);
  } catch (err) {
    say("Could not reach the engine just now. Trying again.", true);
  }
}
function tick() { if (!document.hidden) poll(); }
poll();
setInterval(tick, DATA.pollMs);
document.addEventListener("visibilitychange", tick);

document.addEventListener("click", function (ev) {
  var b = ev.target.closest && ev.target.closest("button[data-copy]");
  if (!b) return;
  var src = $(b.getAttribute("data-copy"));
  var text = src.textContent;
  var done = function () {
    var was = b.getAttribute("data-label") || b.textContent;
    b.setAttribute("data-label", was);
    b.textContent = "Copied";
    setTimeout(function () { b.textContent = was; }, 1600);
  };
  var fallback = function () {
    var r = document.createRange(); r.selectNodeContents(src);
    var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    try { document.execCommand("copy"); done(); } catch (e) { b.textContent = "Press Ctrl+C"; }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
});
`;

const CSS = `
@font-face{font-family:"Newsreader";font-style:normal;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-latin-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-mono-latin-v1.woff2") format("woff2-variations")}
:root{--bg:#FAF8F4;--paper:#FFFFFF;--ink:#16181D;--muted:#5B5F68;--line:#E6E2DA;--test:#1F7A55;--test-tint:#E7F1EC;--held:#B7791F;--held-ink:#8A5A12;--held-tint:#F7EEDD;--serif:"Newsreader",Charter,Georgia,serif;--sans:"Geist",ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
html{font-size:20px;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:inherit}
.num{font-variant-numeric:tabular-nums lining-nums}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:2px}
main{max-width:1180px;margin:0 auto;padding:40px clamp(16px,4vw,56px) 72px}
h1{font-family:var(--serif);font-weight:300;font-size:clamp(1.9rem,4vw,2.6rem);line-height:1.1;letter-spacing:-.015em;margin:0 0 .6rem;max-width:22ch;text-wrap:balance}
.lede{margin:0;color:var(--muted);font-size:.9rem;max-width:44rem}
h2{font-family:var(--mono);font-size:.72rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin:2.6rem 0 1rem;padding-top:1rem;border-top:1px solid var(--ink)}
code,pre{font-family:var(--mono)}
code{font-size:.75rem;background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:.06rem .3rem;overflow-wrap:anywhere}
.setup{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2rem 3rem}
.client h3{margin:0 0 .3rem;font-family:var(--serif);font-size:1.25rem;font-weight:500}
.client p{margin:0 0 .6rem;font-size:.8rem;color:var(--muted)}
.client.wide{grid-column:1/-1}
.snip{display:flex;align-items:flex-start;gap:.6rem;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:.7rem .8rem;margin-bottom:.6rem}
.snip pre{flex:1;min-width:0;margin:0;font-size:.72rem;line-height:1.5;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
.copy{flex:none;font:500 .66rem/1 var(--mono);letter-spacing:.07em;text-transform:uppercase;background:transparent;color:var(--ink);border:0;box-shadow:inset 0 0 0 1px #CFC9BD;border-radius:999px;padding:.6rem .85rem;min-height:36px;cursor:pointer}
.copy:hover{box-shadow:inset 0 0 0 1px #33363D}
.copy:active{transform:scale(.96)}
@media (pointer:coarse){.copy{min-height:44px;min-width:44px}}
.feed-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:.4rem 1.2rem}
.feed-head h2{margin:2.6rem 0 0;flex:1 1 auto;border-top:0;padding-top:0}
.keep{display:inline-block;font-size:.72rem;font-weight:600;letter-spacing:.02em;color:var(--held-ink);background:var(--held-tint);border-radius:999px;padding:.3rem .75rem}
.feed-wrap{border-top:1px solid var(--ink);margin-top:.8rem}
.feed-note{margin:.8rem 0 0;font-size:.8rem;color:var(--muted);max-width:46rem}
.feed-status{margin:.5rem 0 0;font-size:.75rem;color:var(--muted);min-height:1.3em}
.feed-status.bad{color:var(--held-ink)}
.count{font-size:.8rem;color:var(--muted)}
ol.sales{list-style:none;margin:0;padding:0}
.sale{padding:1.1rem 0 1.2rem;border-bottom:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr);gap:.45rem}
.sale-top{display:flex;flex-wrap:wrap;gap:.2rem 1rem;font-size:.72rem;color:var(--muted)}
.sale-top .ids{font-family:var(--mono);overflow-wrap:anywhere}
.buy{margin:0;font-family:var(--serif);font-size:1.35rem;line-height:1.2}
.buy b{font-weight:500}
.shown{border-left:3px solid var(--line);padding:.1rem 0 .1rem .9rem}
.shown.test{border-left-color:var(--test)}
.shown.placebo,.shown.none{border-left-color:var(--held)}
.grp{margin:0;font-size:.75rem;font-weight:600;letter-spacing:.02em}
.shown.test .grp{color:var(--test)}
.shown.placebo .grp,.shown.none .grp{color:var(--held-ink)}
.quote{margin-top:.4rem}
.q-head{margin:0;font-size:.85rem}
.q-disc{margin:.15rem 0 0;font-family:var(--serif);font-style:italic;font-size:.9rem;color:var(--muted);max-width:52rem}
.credit{margin:0;display:inline-block;justify-self:start;font-size:.75rem;font-weight:600;border-radius:999px;padding:.3rem .75rem;background:var(--raise,#F1EDE5);color:var(--muted)}
.credit.pending,.credit.paid{background:var(--test-tint);color:var(--test)}
.credit.held,.credit.voided{background:var(--held-tint);color:var(--held-ink)}
.empty{padding:1.6rem 0 .4rem}
.empty p{margin:0 0 .5rem;font-size:.9rem;max-width:44rem}
.empty ol{margin:.3rem 0 0;padding-left:1.2rem;font-size:.85rem;color:var(--muted)}
.empty li{margin:.3rem 0}
.empty .ask{color:var(--ink)}
.after{margin-top:2rem;font-size:.8rem;color:var(--muted);max-width:50rem}
.after p{margin:0 0 .5rem}
@media (max-width:760px){html{font-size:18px}.setup{grid-template-columns:minmax(0,1fr)}.snip{flex-direction:column;align-items:stretch}.copy{align-self:flex-start}}
`;

/** The public MCP server's page: connect your agent, then watch the sales it makes. */
export function mcpPage(origin: string): string {
  const url = `${origin}/mcp`;
  const claudeCode = `claude mcp add --transport http cited ${url}`;
  // Cursor reads remote servers from a `url` entry in mcp.json.
  const cursor = JSON.stringify({ mcpServers: { cited: { url } } }, null, 2);
  // Older Claude Desktop builds only run local servers; mcp-remote bridges to a remote URL.
  const desktop = JSON.stringify(
    { mcpServers: { cited: { command: "npx", args: ["-y", "mcp-remote", url] } } },
    null,
    2,
  );
  const prompt = "Find a small-bedroom air purifier around $100 and buy it for me.";
  const data = JSON.stringify(feedData()).replaceAll("<", "\\u003c");
  const snip = (id: string, label: string, text: string) =>
    `<div class="snip"><pre id="${id}" tabindex="0" aria-label="${esc(label)}">${esc(text)}</pre><button type="button" class="copy" data-copy="${id}" aria-label="Copy ${esc(label)}">Copy</button></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Run your own agent · CITED</title>
<style>${CSS}${SITE_NAV_TOUCH_CSS}${SITE_THEME_CSS}${SITE_HEADER_CSS}</style></head><body>
${siteHeader("mcp")}
<main>
<h1>Point your own agent at CITED</h1>
<p class="lede">This is a public shopping server for AI agents (an MCP server). Your agent searches air purifier offers synced to PayPal and buys one. Simulated PayPal: no real money moves, and there is nothing to sign in to. Below, you can watch what CITED recorded for the sale.</p>

<h2>1. Connect your agent</h2>
<div class="setup">
<div class="client"><h3>Claude Code</h3><p>Run this in a terminal, then start <code>claude</code>.</p>${snip("c-code", "Claude Code command", claudeCode)}</div>
<div class="client"><h3>Cursor</h3><p>Add this to <code>~/.cursor/mcp.json</code> (or <code>.cursor/mcp.json</code> in a project).</p>${snip("c-cursor", "Cursor config", cursor)}</div>
<div class="client"><h3>Claude Desktop</h3><p>Settings, then Connectors, then Add custom connector, and paste the address. If your version has no connectors page, add the second block to <code>claude_desktop_config.json</code> instead (needs Node.js).</p>${snip("c-desktop-url", "server address", url)}${snip("c-desktop", "Claude Desktop config", desktop)}</div>
<div class="client"><h3>Any other MCP client</h3><p>Use this address. It speaks Streamable HTTP, takes no sign-in, and answers JSON.</p>${snip("c-url", "server address", url)}</div>
</div>

<h2>2. Ask it to buy</h2>
<div class="client wide"><p>Try this in your agent. Each connection is its own shopping session, and CITED decides at random whether that session is shown a creator's test, other content from the same creator, or nothing.</p>${snip("c-prompt", "example request", prompt)}</div>

<div class="feed-head"><h2>3. Your agent's sales</h2><span class="keep">Kept out of the study numbers</span><span class="count num" id="count"></span></div>
<div class="feed-wrap">
<p class="feed-note">Every agent connected to this server shows up here, newest first. Yours has the order number your agent reported. These sales are recorded and checked the same way as the study's, but they never change the study's numbers or any creator's balance.</p>
<p class="feed-status" id="feed-status" role="status" aria-live="polite">Loading…</p>
<div class="empty" id="empty" hidden>
<p><b>No sales yet.</b> Nothing has been bought through this server recently.</p>
<ol><li>Connect your agent above.</li><li>Ask it: <span class="ask">${esc(prompt)}</span></li><li>Its sale appears here within a few seconds.</li></ol>
</div>
<ol class="sales" id="sales" hidden aria-label="Sales made by agents connected to this server"></ol>
</div>
<script type="application/json" id="feed-data">${data}</script>

<div class="after">
<p>What the credit line means: if the agent was shown the creator's test, CITED would hold a credit for the creator for 30 days and pay it only if the sale is not refunded. If it was not shown the test, the sale earns nothing. These sales are never actually credited or paid.</p>
<p>Limits: 60 requests a minute per address, three orders per session. See the recorded study on <a href="/proof">the proof page</a>, or watch two agents side by side on <a href="/try">Run an agent</a>. The raw record is at <a href="${esc(FEED_PATH)}"><code>${esc(FEED_PATH)}</code></a>.</p>
</div>
</main>
<script>${CLIENT_JS}</script>
</body></html>`;
}
