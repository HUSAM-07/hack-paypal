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
  SITE_HEAD_HTML,
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  TOUR_SCRIPT,
  type VerifiedTest,
} from "@pact/protocol";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export const MCP_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** How often the open page asks the engine for new sales. The read API is cached for 10 s. */
export const FEED_POLL_MS = 5000;
export const FEED_LIMIT = 20;
export const FEED_PATH = `${PUBLIC_MCP_SALES_PATH}&limit=${FEED_LIMIT}`;
export const TESTS_PATH = "/api/cited/api/tests";

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
  /** The engine's public list of tests creators published, which names creators the page was not built with. */
  testsPath: string;
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
    testsPath: TESTS_PATH,
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

/**
 * Adds the tests creators published at /creators to the content the feed can name, from the
 * engine's `GET /tests` (newest first: the first test and placebo per creator win). Everything
 * is later written with textContent, never as HTML. Plain ES5, shipped to the browser as is.
 */
export const ADD_PUBLISHED_JS = `function addPublished(data, rows) {
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    var t = rows[i] && rows[i].test;
    if (!t || (t.kind !== "test" && t.kind !== "placebo") || typeof t.creatorId !== "string") continue;
    var bucket = data.content[t.kind];
    if (seen[t.kind + t.creatorId]) continue;
    seen[t.kind + t.creatorId] = true;
    var names = [];
    var skus = t.skus || [];
    for (var k = 0; k < skus.length; k++) names.push(data.products[skus[k].upc] || skus[k].brand + " " + skus[k].name);
    var topic = String(t.category || "").replace(/-/g, " ");
    bucket[t.creatorId] = {
      creator: rows[i].creatorName || t.creatorName || t.creatorId,
      headline: t.kind === "test"
        ? "Product test: " + names.join(" vs ")
        : "Other content, not a test of the product: " + (names.join(", ") || topic),
      disclosure: t.disclosure
    };
  }
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
${ADD_PUBLISHED_JS}
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
    var asked = [fetch(DATA.feedPath, { headers: { accept: "application/json" } }),
      fetch(DATA.testsPath, { headers: { accept: "application/json" } }).catch(function () { return null; })];
    var res = await asked[0];
    if (!res.ok) throw new Error("status " + res.status);
    var body = await res.json();
    var tres = await asked[1];
    if (tres && tres.ok) {
      var published = await tres.json().catch(function () { return null; });
      if (published && Array.isArray(published.tests)) addPublished(DATA, published.tests);
    }
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
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
body{font:400 15px/1.6 var(--font-sans)}
a{color:inherit;text-underline-offset:3px;text-decoration-color:var(--border)}
a:hover{text-decoration-color:var(--foreground)}
.num{font-variant-numeric:tabular-nums lining-nums}
.hero{padding:40px var(--pad) 32px}
.hero-top{display:flex;align-items:center;gap:12px;margin:0 0 14px}
.hero-top p{margin:0}
.stk{display:block;filter:var(--shadow-sticker);transform:rotate(-6deg)}
h1{margin:0 0 12px;font:400 clamp(34px,6vw,46px)/1.08 var(--font-serif);letter-spacing:-.015em;max-width:20ch;text-wrap:balance}
.lede{margin:0;color:var(--muted-foreground);max-width:62ch}
h2{margin:0;font:inherit;letter-spacing:inherit}
code{overflow-wrap:anywhere}
.setup{margin:0}
.client{padding:18px var(--pad) 20px;min-width:0}
.client h3{margin:0 0 4px;font:400 24px/1.2 var(--font-serif);letter-spacing:-.01em}
.client p{margin:0 0 10px;font-size:14px;color:var(--muted-foreground)}
.snip{display:flex;align-items:flex-start;gap:10px;background:var(--card);border:1px dashed var(--border);border-radius:6px;padding:10px 10px 10px 12px;margin-bottom:10px}
.snip pre{flex:1;min-width:0;margin:0;font:400 12.5px/1.55 var(--font-mono);color:var(--card-foreground);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2;padding-top:6px}
.copy{flex:none;height:30px;padding:0 12px;font-size:13px}
@media (pointer:coarse){.copy{min-height:44px;min-width:44px}}
.feed-head{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px}
.feed-head h2{flex:1 1 auto}
.keep{display:inline-block;font:500 11px/1.3 var(--font-mono);letter-spacing:.04em;color:var(--warning);background:var(--warning-soft);border-radius:999px;padding:4px 10px}
.count{font:400 12px/1 var(--font-mono);color:var(--muted-foreground)}
.feed-note{margin:0;font-size:14px;color:var(--muted-foreground);max-width:62ch}
.feed-status{margin:8px 0 0;font:400 12px/1.5 var(--font-mono);color:var(--muted-foreground);min-height:1.5em}
.feed-status.bad{color:var(--warning)}
ol.sales{list-style:none;margin:12px 0 0;padding:0;border-top:1px dashed var(--border)}
.sale{padding:18px var(--pad) 20px;border-bottom:1px dashed var(--border);display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.sale:last-child{border-bottom:0}
.sale-top{display:flex;flex-wrap:wrap;gap:4px 14px;font:400 11px/1.5 var(--font-mono);letter-spacing:.04em;color:var(--muted-foreground)}
.sale-top .ids{overflow-wrap:anywhere}
.buy{margin:0;font:400 24px/1.2 var(--font-serif);letter-spacing:-.01em}
.buy b{font-weight:400}
.shown{border-left:2px solid var(--subtle);padding:2px 0 2px 14px}
.shown.test{border-left-color:var(--primary)}
.shown.placebo{border-left-color:var(--warning)}
.grp{margin:0;font-size:13px;font-weight:600;color:var(--muted-foreground)}
.shown.test .grp{color:var(--primary)}
.shown.placebo .grp{color:var(--warning)}
.quote{margin-top:6px}
.q-head{margin:0;font-size:14px}
.q-disc{margin:2px 0 0;font:italic 400 16px/1.4 var(--font-serif);color:var(--muted-foreground);max-width:62ch}
.credit{margin:0;display:inline-block;justify-self:start;font-size:12px;font-weight:600;border-radius:999px;padding:4px 10px;background:var(--fill);color:var(--muted-foreground)}
.credit.pending,.credit.paid{background:var(--primary-soft);color:var(--primary)}
.credit.held{background:var(--warning-soft);color:var(--warning)}
.credit.voided{background:var(--destructive-soft);color:var(--destructive)}
.empty{margin-top:16px;padding:16px 18px}
.empty p{margin:0 0 6px}
.empty ol{margin:4px 0 0;padding-left:20px;font-size:14px;color:var(--muted-foreground)}
.empty li{margin:4px 0}
.empty .ask{color:var(--foreground)}
.after p{margin:0 0 10px;font-size:14px;color:var(--muted-foreground);max-width:66ch}
@media (max-width:640px){:root{--pad:16px}.snip{flex-direction:column;align-items:stretch}.copy{align-self:flex-start}}
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
    `<div class="snip"><pre id="${id}" tabindex="0" aria-label="${esc(label)}">${esc(text)}</pre><button type="button" class="copy ui-btn ui-btn-quiet" data-copy="${id}" aria-label="Copy ${esc(label)}">Copy</button></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Run your own agent · CITED</title>
${SITE_HEAD_HTML}
<style>${SITE_THEME_CSS}${CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}</style></head><body class="site-col">
${siteHeader("mcp")}
<div class="ui-frame"><main id="main">
<section class="hero">
<div class="hero-top"><img class="stk" src="/art/stickers/robot.webp" alt="" width="44" height="44"><p class="ui-label">Public MCP server</p></div>
<h1>Point your own agent at CITED</h1>
<p class="lede">This is a public shopping server for AI agents (an MCP server). Your agent searches air purifier offers synced to PayPal and buys one. Simulated PayPal: no real money moves, and there is nothing to sign in to. Below, you can watch what CITED recorded for the sale.</p>
</section>

<section class="ui-band">
<h2 class="ui-band-h">1. Connect your agent</h2>
<div class="setup ui-grid2">
<div class="client"><h3>Claude Code</h3><p>Run this in a terminal, then start <code>claude</code>.</p>${snip("c-code", "Claude Code command", claudeCode)}</div>
<div class="client"><h3>Cursor</h3><p>Add this to <code>~/.cursor/mcp.json</code> (or <code>.cursor/mcp.json</code> in a project).</p>${snip("c-cursor", "Cursor config", cursor)}</div>
<div class="client"><h3>Claude Desktop</h3><p>Settings, then Connectors, then Add custom connector, and paste the address. If your version has no connectors page, add the second block to <code>claude_desktop_config.json</code> instead (needs Node.js).</p>${snip("c-desktop-url", "server address", url)}${snip("c-desktop", "Claude Desktop config", desktop)}</div>
<div class="client"><h3>Any other MCP client</h3><p>Use this address. It speaks Streamable HTTP, takes no sign-in, and answers JSON.</p>${snip("c-url", "server address", url)}</div>
</div>
</section>

<section class="ui-band">
<h2 class="ui-band-h">2. Ask it to buy</h2>
<div class="client wide"><p>Try this in your agent. Each connection is its own shopping session, and CITED decides at random whether that session is shown a creator's test, other content from the same creator, or nothing.</p>${snip("c-prompt", "example request", prompt)}</div>
</section>

<section class="ui-band" id="sales-feed">
<div class="feed-head ui-band-h" id="feed"><h2>3. Your agent's sales</h2><span class="keep">Kept out of the study numbers</span><span class="count num" id="count"></span></div>
<div class="feed-wrap">
<div class="ui-band-body">
<p class="feed-note">Every agent connected to this server shows up here, newest first. Yours has the order number your agent reported. These sales are recorded and checked the same way as the study's, but they never change the study's numbers or any creator's balance.</p>
<p class="feed-status" id="feed-status" role="status" aria-live="polite">Loading…</p>
<div class="empty ui-card ui-dots" id="empty" hidden>
<p><b>No sales yet.</b> Nothing has been bought through this server recently.</p>
<ol><li>Connect your agent above.</li><li>Ask it: <span class="ask">${esc(prompt)}</span></li><li>Its sale appears here within a few seconds.</li></ol>
</div>
</div>
<ol class="sales" id="sales" hidden aria-label="Sales made by agents connected to this server"></ol>
</div>
<script type="application/json" id="feed-data">${data}</script>
</section>

<section class="ui-band after">
<div class="ui-band-body">
<p>What the credit line means: if the agent was shown the creator's test, CITED would hold a credit for the creator for 30 days and pay it only if the sale is not refunded. If it was not shown the test, the sale earns nothing. These sales are never actually credited or paid.</p>
<p>Limits: 60 requests a minute per address, three orders per session. See the recorded study on <a href="/proof">the proof page</a>, or watch two agents side by side on <a href="/try">Run an agent</a>. The raw record is at <a href="${esc(FEED_PATH)}"><code>${esc(FEED_PATH)}</code></a>.</p>
</div>
</section>
</main></div>
<script>${CLIENT_JS}</script>
${TOUR_SCRIPT}
</body></html>`;
}
