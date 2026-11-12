/**
 * The /console/ledger page. Everything the engine returned is written with textContent, never
 * as HTML. Styled like /mcp and /try (shared theme, header and skip link from @pact/protocol).
 */
import {
  SITE_HEAD_HTML,
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  siteMeta,
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
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
body{font:400 15px/1.6 var(--font-sans)}
a{color:inherit;text-underline-offset:3px;text-decoration-color:var(--border)}
a:hover{text-decoration-color:var(--foreground)}
.num{font-variant-numeric:tabular-nums lining-nums}
.hero{padding:40px var(--pad) 32px}
.hero .ui-label{margin:0 0 12px}
h1{margin:0 0 12px;font:400 clamp(34px,5vw,48px)/1.08 var(--font-serif);letter-spacing:-.015em;max-width:22ch;text-wrap:balance}
.lede{margin:0;color:var(--muted-foreground);max-width:62ch}
.mode{margin:8px 0 0;font-size:14px;color:var(--muted-foreground);max-width:62ch}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-top:22px}
.summary{margin:0;font-size:14px;font-weight:600;border-radius:10px;padding:8px 14px}
.summary.pass{background:var(--primary-soft);color:var(--primary)}
.summary.fail{background:var(--destructive-soft);color:var(--destructive)}
.ui-btn:disabled{opacity:.6;cursor:default}
.status{margin:10px 0 0;font:400 12px/1.5 var(--font-mono);color:var(--muted-foreground);min-height:1.5em}
.status.bad{color:var(--destructive)}
ol.checks,ul.notrun{list-style:none;margin:0;padding:0}
.check{padding:18px var(--pad) 20px;border-bottom:1px dashed var(--border);display:grid;gap:10px;min-width:0}
.check:last-child{border-bottom:0}
.head{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 12px}
.mark{flex:none;font:500 11px/1 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;border-radius:6px;padding:5px 8px;background:var(--warning-soft);color:var(--warning)}
.check.pass .mark{background:var(--primary-soft);color:var(--primary)}
.check.fail .mark{background:var(--destructive-soft);color:var(--destructive)}
h3{margin:0;font:400 22px/1.2 var(--font-serif);letter-spacing:-.01em;min-width:0;overflow-wrap:anywhere;flex:1 1 16rem}
.cmp{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:12px;align-items:center;max-width:46rem}
.side{display:flex;flex-direction:column;gap:3px;min-width:0;background:var(--card);border:1px dashed var(--border);border-radius:6px;padding:10px 14px}
.lbl{font:400 11px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground);overflow-wrap:anywhere}
.val{font:500 15px/1.4 var(--font-mono);overflow-wrap:anywhere}
.eq{font:500 18px/1 var(--font-mono);color:var(--muted-foreground)}
.check.fail .eq{color:var(--destructive)}
.plain{margin:0;font-size:14px;color:var(--muted-foreground);max-width:62ch}
.notrun li{margin:0 0 10px;font-size:14px;color:var(--muted-foreground);max-width:70ch}
.notrun b{color:var(--foreground);font-weight:600}
.after p{margin:0;font-size:14px;color:var(--muted-foreground);max-width:70ch}
@media (pointer:coarse){.ui-btn{min-height:44px}}
@media (max-width:760px){:root{--pad:16px}.cmp{grid-template-columns:minmax(0,1fr)}.eq{justify-self:center}}
`;

/** The page: what is compared, then every check, then what was not run and why. */
export function ledgerPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Does the ledger match PayPal? · CITED</title>
${siteMeta({ title: "Does the ledger match PayPal? · CITED", description: "Every credited sale in the CITED ledger, checked against the PayPal capture it came from.", path: "/console/ledger" })}
${SITE_HEAD_HTML}
<style>${SITE_THEME_CSS}${CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}</style></head><body>
${siteHeader("ledger")}
<div class="ui-frame-wide"><main id="main">
<section class="hero">
<p class="ui-label">Console · Reconciliation</p>
<h1>Does the ledger match PayPal?</h1>
<p class="lede">These checks run just now, on the live engine's public data. Each one compares two numbers that should be equal: what CITED's ledger says, and what PayPal's records say. Nothing here can change the ledger: the page only reads.</p>
<p class="mode" id="mode">PayPal here is our simulation of it: no real money moves.</p>
<div class="bar"><p class="summary" id="summary" role="status" hidden></p><button type="button" class="ui-btn ui-btn-solid" id="again">Run the checks again</button></div>
<p class="status" id="status" role="status" aria-live="polite">Reading the live ledger…</p>
</section>

<section class="ui-band">
<h2 class="ui-band-h">The checks</h2>
<ol class="checks" id="checks" hidden aria-label="Reconciliation checks"></ol>
<noscript><p class="plain ui-band-body">This page needs JavaScript to run the checks. The raw result is at <a href="/console/ledger/checks.json"><code>/console/ledger/checks.json</code></a>.</p></noscript>
</section>

<section class="ui-band" id="notrun-wrap" hidden>
<h2 class="ui-band-h">Checks not run here</h2>
<ul class="notrun ui-band-body" id="notrun"></ul>
</section>

<section class="ui-band after">
<div class="ui-band-body">
<p>Results are read once and shared for about twenty seconds, so pressing the button more often shows the same answer. The one-command demo runs the full set of 45 checks end to end; see the <a href="/proof">proof page</a> for the recorded study, or <a href="/console/payout">the day-30 payout</a> for the money itself.</p>
</div>
</section>
</main></div>
<script>${CLIENT_JS}</script>
${TOUR_SCRIPT}
</body></html>`;
}
