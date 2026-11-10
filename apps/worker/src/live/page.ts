/**
 * /try: one request, two live agents at once. The page is a mirrored ledger: the test lane on the
 * left, the held-out lane on the right, and between them a spine of the five stages every sale
 * passes through, so each row compares the two agents at the same moment of their run.
 * Everything a model or a third party wrote is rendered with textContent, never as HTML.
 */

import { UPC_WINIX_A230 } from "@pact/protocol";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The stages of a run, in order: the spine's rows. */
const STAGES: [id: string, label: string][] = [
  ["catalogue", "Catalogue"],
  ["reads", "Reads"],
  ["chooses", "Chooses"],
  ["paypal", "PayPal"],
  ["engine", "Engine"],
];

const CSS = `
@font-face{font-family:"Newsreader";font-style:normal;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Newsreader";font-style:italic;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-italic-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-latin-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-mono-latin-v1.woff2") format("woff2-variations")}
:root{
  --bg:#FAF8F4;--paper:#FFFFFF;--ink:#16181D;--muted:#5B5F68;--line:#E6E2DA;
  --test:#1F7A55;--test-tint:#E7F1EC;--held:#B7791F;--held-ink:#8A5A12;--held-tint:#F7EEDD;
  --pp-navy:#003087;
  --serif:"Newsreader",Charter,"Iowan Old Style","Palatino Linotype",Georgia,serif;
  --sans:"Geist",ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  --mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box}
html{font-size:20px;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.45;-webkit-font-smoothing:antialiased}
.num{font-variant-numeric:tabular-nums lining-nums}
a{color:inherit}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:2px}

.nav{display:flex;align-items:baseline;gap:2rem;max-width:1320px;margin:0 auto;padding:22px 48px 0;font-size:.8rem}
.nav .mark{font-family:var(--serif);font-size:1.15rem;font-weight:600;letter-spacing:.06em;text-decoration:none;margin-right:auto}
.nav a{color:var(--muted);text-decoration:none;padding:.3rem 0;white-space:nowrap}
.nav a:hover{color:var(--ink)}
.nav a[aria-current]{color:var(--ink);box-shadow:inset 0 -1.5px 0 var(--ink)}

main{max-width:1320px;margin:0 auto;padding:40px 48px 72px}
.eyebrow{margin:0 0 .5rem;font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
form{margin:0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
textarea{display:block;width:100%;max-width:34ch;resize:none;border:0;border-bottom:1.5px solid var(--line);background:transparent;color:var(--ink);
  font-family:var(--serif);font-weight:400;font-size:2.4rem;line-height:1.12;letter-spacing:-.012em;padding:0 0 .35rem;field-sizing:content;min-height:2.4em}
textarea:focus{outline:none;border-bottom-color:var(--ink)}
textarea:disabled{color:var(--muted)}
.controls{display:flex;align-items:center;gap:.8rem 1.2rem;flex-wrap:wrap;margin:1.3rem 0 0}
button{font:inherit;font-size:.9rem;font-weight:600;background:var(--ink);color:var(--bg);border:1.5px solid var(--ink);border-radius:999px;padding:.65rem 1.4rem;min-height:44px;cursor:pointer}
button:hover{background:#2B2E36}
button.quiet{background:transparent;color:var(--ink)}
button.quiet:hover{background:var(--paper)}
button:active{transform:scale(.96)}
button:disabled{background:transparent;border-color:var(--line);color:var(--muted);cursor:default;transform:none}
.who{font-size:.8rem;color:var(--muted);margin:0}
.who b{font-family:var(--mono);font-weight:500;color:var(--ink)}
.who.scripted b{color:var(--held-ink)}
.fixed{margin:.9rem 0 0;font-size:.8rem;color:var(--muted);max-width:46rem}
.status{min-height:1.4em;margin:.6rem 0 0;font-size:.85rem;color:var(--muted)}
.status.bad{color:var(--held-ink)}

/* The board: test lane | stage spine | held-out lane. Every row is one stage, both lanes. */
.board{display:grid;grid-template-columns:minmax(0,1fr) 7.5rem minmax(0,1fr);margin-top:2.2rem;border-top:1px solid var(--ink)}
.board[hidden]{display:none}
.board > *{grid-row:var(--r)}
.board .spine{grid-column:2}
.board .test{grid-column:1}
.board .held{grid-column:3}
.lh{padding:1.3rem 2rem 1.1rem 0;grid-row:1}
.lh.held{padding:1.3rem 0 1.1rem 2rem}
.lh h2{margin:0;display:flex;align-items:baseline;gap:.55rem;font-family:var(--serif);font-size:1.7rem;font-weight:500;letter-spacing:-.005em}
.lh h2::before{content:"";flex:none;width:.6rem;height:.6rem;border-radius:50%;background:var(--accent);transform:translateY(-.1em)}
.lh p{margin:.2rem 0 0;font-size:.8rem;color:var(--muted)}
.lh .agent{font-family:var(--mono);font-size:.7rem}
.test{--accent:var(--test);--accent-ink:var(--test);--tint:var(--test-tint)}
.held{--accent:var(--held);--accent-ink:var(--held-ink);--tint:var(--held-tint)}
.spine{position:relative;text-align:center;padding:1.15rem .4rem;border-top:1px solid var(--line)}
.spine::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--line)}
.spine span{position:relative;display:inline-block;background:var(--bg);padding:.15rem .35rem;font-size:.66rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.spine small{position:relative;display:block;margin-top:.35rem;background:var(--bg);font-size:.66rem;line-height:1.3;color:var(--muted)}
.spine.head{border-top:0}
.cell{border-top:1px solid var(--line);padding:1.1rem 2rem 1.2rem 0;min-height:4.6rem;transition:background-color .35s}
.cell.held{padding:1.1rem 0 1.2rem 2rem}
.cell:empty::before{content:"";display:block;width:1.6rem;height:2px;margin-top:.6rem;background:var(--line)}
.cell.now{box-shadow:inset 3px 0 0 var(--accent)}
.cell.held.now{box-shadow:inset -3px 0 0 var(--accent)}
.cell p{margin:0}
.cell .sub{color:var(--muted);font-size:.78rem;margin-top:.3rem}
.cell .thought{font-family:var(--serif);font-style:italic;font-size:1rem;line-height:1.35;color:#3A3D45;margin-top:.45rem}
.offers{width:100%;border-collapse:collapse;font-size:.8rem;margin-top:.35rem}
.offers td{padding:.26rem 0;border-top:1px solid var(--line)}
.offers td:first-child{color:var(--muted);width:2ch}
.offers td:last-child{text-align:right}
.offers tr:first-child td{border-top:0}
blockquote{margin:0;padding:.15rem 0 .15rem .9rem;border-left:2px solid var(--accent);font-family:var(--serif);font-size:1.05rem;line-height:1.35}
blockquote cite{display:block;font-family:var(--sans);font-style:normal;font-size:.68rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:.2rem}
.absent{font-family:var(--serif);font-size:1.05rem;color:var(--held-ink)}
.pick{font-family:var(--serif);font-size:1.35rem;font-weight:500;line-height:1.15}
.price{font-family:var(--sans);font-size:.95rem;font-weight:500;color:var(--muted);margin-left:.35rem}
code{font-family:var(--mono);font-size:.7rem;background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:.06rem .3rem;overflow-wrap:anywhere}
.pp{font-weight:700;font-style:italic;color:var(--pp-navy);letter-spacing:-.01em}
.ids{display:flex;flex-wrap:wrap;gap:.3rem .5rem;align-items:center;margin-top:.35rem;font-size:.75rem;color:var(--muted)}

/* The result row: what each agent bought, and whether HouseFresh earned anything. */
.out{background:var(--tint);border-top:3px solid var(--accent);padding:1.1rem 1.4rem 1.3rem;margin:0 1.2rem 0 0;transition:background-color .4s}
.out.held{margin:0 0 0 1.2rem}
.out.wait{background:transparent;border-top-color:var(--line)}
.out .k{font-size:.68rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--accent-ink)}
.out.wait .k{color:var(--muted)}
.out strong{display:block;font-family:var(--serif);font-weight:500;font-size:2.3rem;line-height:1.05;letter-spacing:-.015em;margin:.25rem 0 .5rem;text-wrap:balance}
.out.wait strong{color:var(--muted);font-size:1.6rem}
.out .credit{font-size:.9rem;margin:0}
.out .credit b{font-weight:600;color:var(--accent-ink)}
.out .why{font-family:var(--serif);font-style:italic;font-size:.95rem;margin:.6rem 0 0;color:#3A3D45}
.spine.result{border-top:1px solid var(--ink)}
.result-cell{border-top:1px solid var(--ink);padding-top:1.2rem}

.after{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:3rem;margin-top:2.6rem;padding-top:1.4rem;border-top:1px solid var(--line)}
.note p{margin:0;font-family:var(--serif);font-size:1.15rem;line-height:1.4;max-width:36rem}
.note p + p{margin-top:.6rem;font-family:var(--sans);font-size:.8rem;color:var(--muted)}
.tally h3{margin:0 0 .6rem;font-size:.7rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.tally[hidden]{display:none}
.trow{display:grid;grid-template-columns:6.5rem auto 1fr;align-items:center;gap:.8rem;padding:.45rem 0;border-top:1px solid var(--line);font-size:.85rem}
.trow b{font-weight:600;color:var(--accent-ink)}
.dots{display:flex;gap:.3rem}
.dot{width:.75rem;height:.75rem;border-radius:50%;border:1.5px solid var(--accent);background:transparent}
.dot.y{background:var(--accent)}
.dot.x{border-style:dashed;opacity:.5}
.tally .sub{font-size:.75rem;color:var(--muted);margin:.5rem 0 0}

@media (prefers-reduced-motion:no-preference){
  .cell > *{animation:arrive .3s ease-out}
  @keyframes arrive{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}

/* Narrow: the lanes interleave per stage, test above held, so each stage still compares. */
@media (max-width:860px){
  .nav,main{padding-left:20px;padding-right:20px}
  .nav{gap:.9rem;font-size:.72rem}
  main{padding-top:28px}
  textarea{font-size:1.7rem;max-width:none}
  .board{grid-template-columns:minmax(0,1fr)}
  .board > *,.board .spine,.board .test,.board .held{grid-row:auto;grid-column:auto}
  .spine.head{display:none}
  .lh,.lh.held{display:none}
  .spine{text-align:left;padding:1.1rem 0 .3rem;border-top:1px solid var(--ink)}
  .spine::before{display:none}
  .spine span{padding:0;background:none}
  .spine small{display:inline;margin:0 0 0 .5rem;background:none}
  .cell,.cell.held{border-top:0;padding:.55rem 0 .7rem .9rem;min-height:0;box-shadow:inset 3px 0 0 var(--accent)}
  .cell.held.now{box-shadow:inset 3px 0 0 var(--accent)}
  .cell::before,.cell:empty::before{content:attr(data-lane);display:block;width:auto;height:auto;margin:0 0 .25rem;background:none;font-size:.62rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--accent-ink)}
  .cell:empty::after{content:"waiting";display:block;font-size:.75rem;color:var(--muted)}
  .out,.out.held{margin:0 0 .8rem}
  .out strong{font-size:1.8rem}
  .result-cell{border-top:0;padding-top:.4rem}
  .after{grid-template-columns:1fr;gap:1.6rem}
}
`;

/* Client: POST the request to /try/pair, read the event stream, route each event to its lane. */
const JS = `
const $ = (s) => document.querySelector(s);
const form = $("#ask"), field = $("#request"), go = $("#go"), five = $("#five"), status = $("#status");
const board = $("#board"), tally = $("#tally");
const usd = (m) => "$" + (m / 100).toFixed(2);
const WINIX = ${JSON.stringify(UPC_WINIX_A230)};
const STAGES = ${JSON.stringify(STAGES.map(([id]) => id))};

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
const LANE = { test: "Test arm", held: "Held out" };
const cell = (lane, stage) => $("#" + lane + "-" + stage);

/* Per-lane state for the pair in progress. */
let lanes;
function reset() {
  lanes = {
    test: { stage: "catalogue", offers: null, paid: null, done: false, error: null },
    held: { stage: "catalogue", offers: null, paid: null, done: false, error: null },
  };
  for (const lane of ["test", "held"]) {
    for (const s of STAGES) { const c = cell(lane, s); c.replaceChildren(); c.classList.remove("now"); }
    setOut(lane, LANE[lane], "Waiting for the sale", null, null, true);
  }
  $("#same").textContent = "";
  cell("test", "catalogue").classList.add("now");
  cell("held", "catalogue").classList.add("now");
}
function at(lane, stage) {
  const st = lanes[lane];
  if (STAGES.indexOf(stage) < STAGES.indexOf(st.stage)) return cell(lane, stage);
  cell(lane, st.stage).classList.remove("now");
  st.stage = stage;
  const c = cell(lane, stage);
  c.classList.add("now");
  return c;
}
function setOut(lane, kicker, head, credit, why, wait) {
  const o = $("#" + lane + "-out");
  o.className = "out " + lane + (wait ? " wait" : "");
  o.replaceChildren(el("div", { class: "k" }, kicker), el("strong", {}, head));
  if (credit) o.append(credit);
  if (why) o.append(el("p", { class: "why" }, why));
}
function sameOrder() {
  const a = lanes.test.offers, b = lanes.held.offers;
  if (!a || !b) return;
  const key = (o) => o.map((x) => x.offerId).join("|");
  $("#same").textContent = key(a) === key(b) ? "same " + a.length + " offers, same order" : "rankings differ";
}

const handlers = {
  start(lane, e) { $("#" + lane + "-agent").textContent = e.scripted ? "scripted agent" : e.agent; },
  thought(lane, e) { cell(lane, lanes[lane].stage).append(el("p", { class: "thought" }, e.text)); },
  search(lane, e) {
    const c = at(lane, "catalogue");
    c.append(el("p", {}, "search_product “" + e.query + "”"));
    if (e.sellerId) c.append(el("p", { class: "sub" }, "reading " + e.sellerId + "’s offer"));
  },
  results(lane, e) {
    const st = lanes[lane];
    if (!st.offers) {
      st.offers = e.offers;
      const t = el("table", { class: "offers num" });
      e.offers.forEach((o, i) => t.append(el("tr", {}, el("td", {}, String(i + 1)), el("td", {}, o.product + " · " + o.seller), el("td", {}, usd(o.priceMinor)))));
      cell(lane, "catalogue").append(t);
      sameOrder();
    }
    const r = at(lane, "reads");
    if (r.childElementCount) return;
    const tests = e.content.filter((c) => c.kind === "test");
    if (tests.length) for (const c of tests) r.append(el("blockquote", {}, el("cite", {}, c.creatorId + " · product test"), c.summary));
    else r.append(el("p", { class: "absent" }, "No creator content. The test was held back."));
  },
  checkout(lane, e) { at(lane, "chooses").append(el("p", {}, "checkout " + e.offerId)); },
  paid(lane, e) {
    lanes[lane].paid = e;
    at(lane, "chooses").prepend(el("p", { class: "pick" }, e.product, el("span", { class: "price num" }, usd(e.total.amountMinor))));
    at(lane, "paypal").append(
      el("p", {}, "Paid " + e.seller + " through ", el("span", { class: "pp" }, "PayPal"), " from the buyer’s linked wallet"),
      el("div", { class: "ids" }, "order", el("code", {}, e.orderId), "capture", el("code", {}, e.captureId || "–")),
      el("p", { class: "sub" }, "Passport in custom_id: " + e.passportChars + " of 127 characters"));
  },
  joined(lane, e) {
    at(lane, "engine").append(el("p", {}, e.unattributedReason
      ? (e.unattributedReason === "capture_not_received" ? "The capture webhook hasn’t arrived." : "Passport rejected: " + e.unattributedReason)
      : "Capture webhook joined to the " + (e.arm === "none" ? "held-out" : e.arm) + " arm by the signed passport."));
  },
  verdict(lane, e) {
    const v = e.verdict, p = lanes[lane].paid;
    const head = p ? p.product : "No purchase";
    let credit;
    if (v.credited) {
      const names = v.credits.map((c) => (e.creatorNames[c.creatorId] || c.creatorId) + " " + usd(c.amount.amountMinor));
      credit = el("p", { class: "credit" }, el("b", {}, "Credited: " + names.join(", ")), " · 8% commission, pending until " + (v.holdUntil || "").slice(0, 10));
    } else {
      credit = el("p", { class: "credit" }, el("b", {}, "HouseFresh not credited"), " · " + v.why.replace(/^Not credited: /, ""));
    }
    setOut(lane, LANE[lane] + (p ? " · bought from " + p.seller + " · " + usd(p.total.amountMinor) : ""), head, credit, e.reason ? "“" + e.reason + "”" : null, false);
  },
  error(lane, e) {
    lanes[lane].error = e.message;
    if (!lanes[lane].paid) setOut(lane, LANE[lane], "No purchase", el("p", { class: "credit" }, e.message), null, false);
  },
  done(lane) { lanes[lane].done = true; cell(lane, lanes[lane].stage).classList.remove("now"); },
};

/* Runs one pair; resolves with the Winix pick per lane, or null if it didn't run. */
async function runPair(request) {
  const res = await fetch("/try/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request }) });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.message || "The side by side didn’t start (" + res.status + ").");
  }
  reset();
  board.hidden = false;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "", ended = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\\n\\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!line.startsWith("data: ")) continue;
      const e = JSON.parse(line.slice(6));
      if (e.type === "end") { ended = true; continue; }
      if (handlers[e.type] && lanes[e.lane]) handlers[e.type](e.lane, e);
    }
  }
  if (!ended) throw new Error("The connection closed before both agents finished.");
  const pick = (l) => lanes[l].paid ? lanes[l].paid.upc === WINIX : null;
  return { test: pick("test"), held: pick("held") };
}

function busy(on) { go.disabled = on; five.disabled = on; field.disabled = on; }
function say(msg, bad) { status.textContent = msg; status.className = "status" + (bad ? " bad" : ""); }

function drawTally(rows, of) {
  tally.hidden = false;
  for (const lane of ["test", "held"]) {
    const picks = rows.map((r) => r[lane]);
    const dots = $("#" + lane + "-dots");
    dots.replaceChildren(...Array.from({ length: of }, (_, i) =>
      el("span", { class: "dot" + (picks[i] === true ? " y" : picks[i] === false ? "" : " x"), "aria-hidden": "true" })));
    const n = picks.filter((p) => p === true).length;
    $("#" + lane + "-count").textContent = n + " of " + picks.length + " bought the Winix";
  }
}

async function start(times) {
  const request = field.value.trim();
  if (request.length < 3) { say("Write what the buyer wants first.", true); return; }
  busy(true);
  const rows = [];
  if (times > 1) drawTally(rows, times); else tally.hidden = true;
  try {
    for (let n = 1; n <= times; n++) {
      say(times > 1 ? "Pair " + n + " of " + times + ": both agents are shopping…" : "Both agents are shopping…");
      rows.push(await runPair(request));
      if (times > 1) drawTally(rows, times);
    }
    const errs = ["test", "held"].map((l) => lanes[l].error).filter(Boolean);
    if (errs.length) say(errs.join(" "), true);
    else say(times > 1 ? "Done: " + times + " pairs." : "Done. Run it again, or run five pairs and count the Winix picks.");
  } catch (err) {
    say((times > 1 && rows.length ? "Stopped after " + rows.length + " of " + times + " pairs. " : "") + err.message, true);
  } finally {
    busy(false);
    go.textContent = "Run again";
  }
}

form.addEventListener("submit", (ev) => { ev.preventDefault(); start(1); });
five.addEventListener("click", () => start(5));
`;

const laneHead = (lane: "test" | "held", title: string, sub: string, agent: string) =>
  `<div class="lh ${lane}"><h2>${title}</h2><p>${sub}</p><p class="agent" id="${lane}-agent">${esc(agent)}</p></div>`;

export function tryPage(o: { request: string; agent: string; scripted: boolean }): string {
  // DOM order is spine, test, held (read in that order on a phone); wide screens place each
  // row by --r so the stage label sits between the two lanes.
  const rows = STAGES.map(
    ([id, label], i) =>
      `<div class="spine" style="--r:${i + 2}"><span>${label}</span>${id === "catalogue" ? '<small id="same" aria-live="polite"></small>' : ""}</div><div class="cell test" style="--r:${i + 2}" id="test-${id}" data-lane="Test arm"></div><div class="cell held" style="--r:${i + 2}" id="held-${id}" data-lane="Held out"></div>`,
  ).join("");
  const last = STAGES.length + 2;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Two agents, one request · CITED</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style></head><body>
<nav class="nav" aria-label="CITED"><a class="mark" href="/">CITED</a>
<a href="/console">Console</a><a href="/console/payout">Payout</a><a href="/try" aria-current="page">Run an agent</a></nav>
<main>
<p class="eyebrow">One request, two live shopping agents</p>
<form id="ask">
<label class="sr" for="request">What should the agents buy?</label>
<textarea id="request" name="request" rows="2" maxlength="280" spellcheck="false">${esc(o.request)}</textarea>
<div class="controls">
<button id="go" type="submit">Run side by side</button>
<button id="five" type="button" class="quiet">Run 5 pairs</button>
<p class="who${o.scripted ? " scripted" : ""}">Agents: <b>${esc(o.agent)}</b> · each pays the seller through PayPal from the buyer’s linked wallet (simulated PayPal)</p>
</div>
<p class="fixed">Both agents get the same request and the same offers in the same order. For this side by side we fix the arms; the real catalogue assigns them at random.</p>
<p id="status" class="status" role="status" aria-live="polite"></p>
</form>
<section id="board" class="board" hidden aria-label="The two agents' runs">
<div class="spine head" style="--r:1"></div>${laneHead("test", "Test arm", "Sees HouseFresh’s test of the Winix A230", o.agent)}${laneHead("held", "Held out", "Sees everything except the test", o.agent)}
${rows}
<div class="spine result" style="--r:${last}"><span>Bought</span></div><div class="result-cell test" style="--r:${last}"><div id="test-out" class="out test wait" aria-live="polite"></div></div><div class="result-cell held" style="--r:${last}"><div id="held-out" class="out held wait" aria-live="polite"></div></div>
</section>
<section class="after">
<div class="note"><p>One pair is an anecdote. Across 147 forced-buy sessions on GPT, Gemini and Sonnet, agents shown the test bought the Winix every time, held-out agents 8% of the time: a lift of +94 percentage points. <a href="/proof">See the proof</a>.</p>
<p>Live runs keep their own record. They never change the recorded demo’s numbers on the console, and a side by side counts as two runs against the hourly limit.</p></div>
<div id="tally" class="tally" hidden aria-live="polite"><h3>Winix picks over five pairs</h3>
<div class="trow test"><b>Test arm</b><span class="dots" id="test-dots"></span><span id="test-count" class="num"></span></div>
<div class="trow held"><b>Held out</b><span class="dots" id="held-dots"></span><span id="held-count" class="num"></span></div>
<p class="sub">Filled: bought the Winix. Dashed: not run yet, or no purchase.</p></div>
</section>
</main>
<script>${JS}</script>
</body></html>`;
}
