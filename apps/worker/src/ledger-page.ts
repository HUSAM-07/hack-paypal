/**
 * The /console/ledger page. Everything the engine returned is written with textContent, never
 * as HTML. Styled like /mcp and /try (shared theme, header and skip link from @pact/protocol).
 */
import {
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  TOUR_SCRIPT,
} from "@pact/protocol";

export const STATUS_WORDS: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  skip: "Not run",
};
export const STATUS_MARKS: Record<string, string> = { pass: "✓", fail: "✗", skip: "–" };

const CLIENT_JS = `
var WORDS = ${JSON.stringify(STATUS_WORDS)};
var MARKS = ${JSON.stringify(STATUS_MARKS)};
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function side(s) {
  var d = el("div", "side");
  d.appendChild(el("span", "lbl", s.label));
  d.appendChild(el("span", "val num", s.value));
  return d;
}
function item(c) {
  var li = el("li", "check " + c.status);
  var head = el("div", "head");
  head.appendChild(el("span", "mark", MARKS[c.status] + " " + WORDS[c.status]));
  head.appendChild(el("h3", "", c.title));
  li.appendChild(head);
  if (c.left && c.right) {
    var cmp = el("div", "cmp");
    cmp.appendChild(side(c.left));
    cmp.appendChild(el("span", "eq", c.status === "fail" ? "\\u2260" : "="));
    cmp.appendChild(side(c.right));
    li.appendChild(cmp);
  }
  li.appendChild(el("p", "plain", c.plain));
  return li;
}
function say(msg, bad) { var s = $("status"); s.textContent = msg; s.className = "status" + (bad ? " bad" : ""); }
function draw(body) {
  var r = body.report, k = r.counts;
  var list = $("checks");
  list.textContent = "";
  for (var i = 0; i < r.checks.length; i++) list.appendChild(item(r.checks[i]));
  var skipped = r.notRun;
  var nr = $("notrun");
  nr.textContent = "";
  for (var j = 0; j < skipped.length; j++) {
    var li = el("li");
    li.appendChild(el("b", "", skipped[j].title));
    li.appendChild(document.createTextNode(". " + skipped[j].reason));
    nr.appendChild(li);
  }
  var ran = k.pass + k.fail;
  var sum = $("summary");
  sum.className = "summary " + (k.fail ? "fail" : "pass");
  sum.textContent = k.fail
    ? k.fail + " of " + ran + " checks do not match"
    : "All " + ran + " checks match" + (k.skip ? " (" + k.skip + " not run)" : "");
  $("mode").textContent = body.paypalMode === "simulated"
    ? "PayPal here is our simulation of it: no real money moves."
    : "PayPal here is the PayPal sandbox: test money only.";
  list.hidden = false; $("notrun-wrap").hidden = false; sum.hidden = false;
  var t = new Date(body.generatedAt);
  say("Read from the live engine at " + (isNaN(t.getTime()) ? "just now" : t.toLocaleTimeString()) + ".", false);
}
async function run() {
  var btn = $("again");
  btn.disabled = true;
  say("Reading the live ledger\\u2026", false);
  try {
    var res = await fetch(${JSON.stringify("/console/ledger/checks.json")}, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("status " + res.status);
    draw(await res.json());
  } catch (err) {
    say("Could not read the live engine just now. Try again in a moment.", true);
  }
  btn.disabled = false;
}
$("again").addEventListener("click", run);
run();
`;

const CSS = `
@font-face{font-family:"Newsreader";font-style:normal;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-latin-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-mono-latin-v1.woff2") format("woff2-variations")}
:root{--bg:#FAF8F4;--paper:#FFFFFF;--ink:#16181D;--muted:#5B5F68;--line:#E6E2DA;--test:#1F7A55;--test-tint:#E7F1EC;--held-ink:#8A5A12;--held-tint:#F7EEDD;--void:#9B3B2A;--void-tint:#F8E9E5;--serif:"Newsreader",Charter,Georgia,serif;--sans:"Geist",ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
html{font-size:20px;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:inherit}
.num{font-variant-numeric:tabular-nums lining-nums}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:2px}
main{max-width:1180px;margin:0 auto;padding:40px clamp(16px,4vw,56px) 72px}
h1{font-family:var(--serif);font-weight:300;font-size:clamp(1.9rem,4vw,2.6rem);line-height:1.1;letter-spacing:-.015em;margin:0 0 .6rem;max-width:22ch;text-wrap:balance}
.lede{margin:0;color:var(--muted);font-size:.9rem;max-width:46rem}
h2{font-family:var(--mono);font-size:.72rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin:2.4rem 0 1rem;padding-top:1rem;border-top:1px solid var(--ink)}
code{font-family:var(--mono);font-size:.75rem;background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:.06rem .3rem;overflow-wrap:anywhere}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1.2rem;margin-top:1.6rem}
.summary{margin:0;font-size:.85rem;font-weight:600;border-radius:999px;padding:.4rem .9rem}
.summary.pass{background:var(--test-tint);color:var(--test)}
.summary.fail{background:var(--void-tint);color:var(--void)}
.btn{font:500 .72rem/1 var(--mono);letter-spacing:.07em;text-transform:uppercase;background:var(--ink);color:var(--bg);border:0;border-radius:999px;padding:.8rem 1.1rem;min-height:40px;cursor:pointer}
.btn:disabled{opacity:.6;cursor:default}
.btn:active{transform:scale(.96)}
.status{margin:.7rem 0 0;font-size:.75rem;color:var(--muted);min-height:1.3em}
.status.bad{color:var(--void)}
.mode{margin:.3rem 0 0;font-size:.8rem;color:var(--muted);max-width:46rem}
ol.checks,ul.notrun{list-style:none;margin:0;padding:0}
.check{padding:1.1rem 0 1.2rem;border-bottom:1px solid var(--line);display:grid;gap:.55rem;min-width:0}
.head{display:flex;align-items:baseline;flex-wrap:wrap;gap:.3rem .8rem}
.mark{flex:none;font:600 .72rem/1 var(--sans);border-radius:999px;padding:.3rem .65rem;background:var(--held-tint);color:var(--held-ink)}
.check.pass .mark{background:var(--test-tint);color:var(--test)}
.check.fail .mark{background:var(--void-tint);color:var(--void)}
h3{margin:0;font-family:var(--serif);font-weight:500;font-size:1.2rem;line-height:1.2;min-width:0;overflow-wrap:anywhere;flex:1 1 16rem}
.cmp{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:.8rem;align-items:center;max-width:46rem}
.side{display:flex;flex-direction:column;gap:.15rem;min-width:0;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:.55rem .75rem}
.lbl{font-size:.7rem;color:var(--muted);overflow-wrap:anywhere}
.val{font-family:var(--mono);font-size:.85rem;overflow-wrap:anywhere}
.eq{font:500 1rem/1 var(--mono);color:var(--muted)}
.check.fail .eq{color:var(--void)}
.plain{margin:0;font-size:.8rem;color:var(--muted);max-width:46rem}
.after{margin-top:.2rem;font-size:.8rem;color:var(--muted);max-width:50rem}
.after p{margin:0 0 .5rem}
ul.notrun li{margin:0 0 .7rem;font-size:.8rem;color:var(--muted);max-width:50rem}
ul.notrun b{color:var(--ink);font-weight:600}
@media (pointer:coarse){.btn{min-height:44px}}
@media (max-width:760px){html{font-size:18px}.cmp{grid-template-columns:minmax(0,1fr)}.eq{justify-self:center}}
`;

/** The page: what is compared, then every check, then what was not run and why. */
export function ledgerPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Does the ledger match PayPal? · CITED</title>
<style>${CSS}${SITE_NAV_TOUCH_CSS}${SITE_THEME_CSS}${SITE_HEADER_CSS}</style></head><body>
${siteHeader("ledger")}
<main id="main">
<h1>Does the ledger match PayPal?</h1>
<p class="lede">These checks run just now, on the live engine's public data. Each one compares two numbers that should be equal: what CITED's ledger says, and what PayPal's records say. Nothing here can change the ledger: the page only reads.</p>
<p class="mode" id="mode">PayPal here is our simulation of it: no real money moves.</p>
<div class="bar"><p class="summary" id="summary" role="status" hidden></p><button type="button" class="btn" id="again">Run the checks again</button></div>
<p class="status" id="status" role="status" aria-live="polite">Reading the live ledger…</p>

<h2>The checks</h2>
<ol class="checks" id="checks" hidden aria-label="Reconciliation checks"></ol>
<noscript><p class="plain">This page needs JavaScript to run the checks. The raw result is at <a href="/console/ledger/checks.json"><code>/console/ledger/checks.json</code></a>.</p></noscript>

<div id="notrun-wrap" hidden>
<h2>Checks not run here</h2>
<ul class="notrun" id="notrun"></ul>
</div>

<div class="after">
<p>Results are read once and shared for about twenty seconds, so pressing the button more often shows the same answer. The one-command demo runs the full set of 45 checks end to end; see the <a href="/proof">proof page</a> for the recorded study, or <a href="/console/payout">the day-30 payout</a> for the money itself.</p>
</div>
</main>
<script>${CLIENT_JS}</script>
${TOUR_SCRIPT}
</body></html>`;
}
