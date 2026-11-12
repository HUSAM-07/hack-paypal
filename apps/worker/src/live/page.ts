/**
 * /try: one request, two live agents at once. The page is a mirrored ledger: the test lane on the
 * left, the held-out lane on the right, and between them a spine of the five stages every sale
 * passes through, so each row compares the two agents at the same moment of their run.
 * Everything a model or a third party wrote is rendered with textContent, never as HTML.
 */
import {
  SITE_HEAD_HTML,
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  siteMeta,
} from "@pact/protocol";
import { TRY_CATEGORIES, type TryCategoryId, tryCategory } from "./categories";

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
*,*::before,*::after{box-sizing:border-box}
body{font:400 15px/1.55 var(--font-sans)}
.num{font-variant-numeric:tabular-nums lining-nums}
a{color:inherit;text-underline-offset:3px;text-decoration-color:var(--border)}
a:hover{text-decoration-color:var(--foreground)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

.hero{padding:36px var(--pad) 32px}
.eyebrow{margin:0 0 22px;font:400 clamp(34px,5vw,48px)/1.06 var(--font-serif);letter-spacing:-.015em;max-width:22ch;text-wrap:balance}
form{margin:0}
.cats{border:0;margin:0 0 22px;padding:0;min-width:0}
.cats legend,.examples legend{padding:0;margin:0 0 10px;font:400 11px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.cats .opts{display:flex;flex-wrap:wrap;gap:6px}
.cats label{position:relative;display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:10px;font:500 14px/1 var(--font-sans);background:var(--fill);color:var(--foreground);cursor:pointer;transition:background-color .15s,color .15s}
.cats label:hover{background:var(--fill-strong);color:var(--foreground)}
.cats input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.cats label:has(input:checked){background:var(--foreground);color:var(--background)}
.cats label:has(input:focus-visible){outline:2px solid var(--primary);outline-offset:2px}
.cats label:has(input:disabled){cursor:default;opacity:.6}
.examples{margin:16px 0 0;padding:0;border:0;min-width:0}
.examples .opts{display:flex;flex-wrap:wrap;gap:8px}
textarea{display:block;width:100%;max-width:36ch;resize:none;border:0;border-bottom:1px dashed var(--border);border-radius:0;background:transparent;color:var(--foreground);
  font:400 clamp(26px,3.4vw,34px)/1.15 var(--font-serif);letter-spacing:-.01em;padding:0 0 8px;field-sizing:content;min-height:2.4em}
textarea::placeholder{color:var(--muted-foreground)}
textarea:focus{outline:none;border-bottom:1px solid var(--foreground)}
textarea:disabled{color:var(--muted-foreground)}
.controls{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;margin:20px 0 0}
.ui-btn:disabled{opacity:.5;cursor:default;transform:none}
.chip{display:inline-block;padding:3px 10px 2px;border:0;border-radius:3px;font:italic 400 17px/1.3 var(--font-serif);text-align:left;color:var(--foreground);background:var(--band);box-shadow:inset 0 0 0 1px var(--border);cursor:pointer;transition:background-color .15s}
.chip:hover{background:var(--hover)}
.chip:active{transform:scale(.98)}
.chip:disabled{opacity:.5;cursor:default;transform:none}
@media (pointer:coarse){.ui-btn,.chip,.cats label{min-height:44px}}
.who{font-size:13px;color:var(--muted-foreground);margin:0}
.who b{font-family:var(--font-mono);font-weight:500;color:var(--foreground)}
.who.scripted b{color:var(--warning)}
.fixed{margin:14px 0 0;font-size:14px;color:var(--muted-foreground);max-width:62ch}
.status{min-height:1.5em;margin:8px 0 0;font:400 12px/1.5 var(--font-mono);color:var(--muted-foreground)}
.status.bad{color:var(--destructive)}

/* The board: test lane | stage spine | held-out lane. Every row is one stage, both lanes. */
.board{display:grid;grid-template-columns:minmax(0,1fr) 120px minmax(0,1fr);padding:0 var(--pad) 28px}
.board[hidden]{display:none}
.board > *{grid-row:var(--r)}
.board .spine{grid-column:2}
.board .test{grid-column:1}
.board .held{grid-column:3}
.test{--lane:var(--primary);--lane-ink:var(--primary);--lane-tint:var(--primary-soft)}
.held{--lane:var(--subtle);--lane-ink:var(--muted-foreground);--lane-tint:var(--fill)}
.lh{padding:24px 28px 18px 0;grid-row:1}
.lh.held{padding:24px 0 18px 28px}
.lh h2{margin:0;display:flex;align-items:baseline;gap:10px;font:400 28px/1.15 var(--font-serif);letter-spacing:-.01em}
.lh h2::before{content:"";flex:none;width:9px;height:9px;border-radius:50%;background:var(--lane);transform:translateY(-.15em)}
.lh p{margin:3px 0 0;font-size:14px;color:var(--muted-foreground)}
.lh .agent{font:400 11px/1.5 var(--font-mono);letter-spacing:.04em}
.spine{position:relative;text-align:center;padding:18px 6px;border-top:1px dashed var(--border)}
.spine::before{content:"";position:absolute;left:50%;top:0;bottom:0;border-left:1px dashed var(--border)}
.spine span{position:relative;display:inline-block;background:var(--background);padding:3px 6px;font:500 11px/1.3 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.spine small{position:relative;display:block;margin-top:6px;background:var(--background);font-size:11px;line-height:1.3;color:var(--muted-foreground)}
.spine.head{border-top:0}
.cell{border-top:1px dashed var(--border);padding:18px 28px 20px 0;min-height:92px;font-size:14px;transition:background-color .35s}
.cell.held{padding:18px 0 20px 28px}
.cell:empty::before{content:"";display:block;width:28px;height:2px;margin-top:10px;background:var(--subtle)}
.cell.now{box-shadow:inset 2px 0 0 var(--lane-ink)}
.cell.held.now{box-shadow:inset -2px 0 0 var(--lane-ink)}
.cell.test.now{padding-left:14px}
.cell.held.now{padding-right:14px}
.cell p{margin:0}
.cell .sub{color:var(--muted-foreground);font-size:13px;margin-top:5px}
.cell .thought{font:italic 400 17px/1.35 var(--font-serif);color:var(--muted-foreground);margin-top:8px}
.offers{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
.offers td{padding:5px 0;border-top:1px dashed var(--border)}
.offers td:first-child{font-family:var(--font-mono);color:var(--muted-foreground);width:3ch}
.offers td:last-child{text-align:right;font-family:var(--font-mono)}
.offers tr:first-child td{border-top:0}
blockquote{margin:0;padding:2px 0 2px 14px;border-left:2px solid var(--lane);font:400 18px/1.35 var(--font-serif)}
blockquote cite{display:block;font:500 11px/1.4 var(--font-mono);font-style:normal;letter-spacing:.06em;text-transform:uppercase;color:var(--lane-ink);margin-bottom:4px}
.absent{font:italic 400 18px/1.35 var(--font-serif);color:var(--muted-foreground)}
.pick{font:400 24px/1.15 var(--font-serif);letter-spacing:-.01em}
.price{font:500 14px/1 var(--font-mono);color:var(--muted-foreground);margin-left:8px}
code{font-size:12px;overflow-wrap:anywhere}
.pp{font-weight:700;font-style:italic;color:var(--paypal);letter-spacing:-.01em}
.ids{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center;margin-top:6px;font:400 11px/1.4 var(--font-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--muted-foreground)}
.ids code{text-transform:none;letter-spacing:0}

/* The result row: what each agent bought, and whether the creator earned anything. */
.out{background:var(--lane-tint);border:1px dashed var(--lane);border-top:2px solid var(--lane);border-radius:0 0 6px 6px;padding:18px 22px 20px;margin:0 20px 0 0;transition:background-color .4s}
.out.held{margin:0 0 0 20px}
.out.wait{background:transparent;border-color:var(--border)}
.out .k{font:500 11px/1.5 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--lane-ink)}
.out.wait .k{color:var(--muted-foreground)}
.out strong{display:block;font:400 38px/1.05 var(--font-serif);letter-spacing:-.015em;margin:6px 0 10px;text-wrap:balance}
.out.wait strong{color:var(--muted-foreground);font-size:26px}
.out .credit{font-size:14px;margin:0}
.out .credit b{font-weight:600;color:var(--lane-ink)}
.out .why{font:italic 400 17px/1.4 var(--font-serif);margin:10px 0 0;color:var(--muted-foreground)}
.spine.result{border-top:1px solid var(--border)}
.result-cell{border-top:1px solid var(--border);padding-top:20px}

.after{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.after > *{padding:4px var(--pad) 0}
.note{border-right:1px dashed var(--border)}
.note p{margin:0;font:400 20px/1.4 var(--font-serif);max-width:36em}
.note p + p{margin-top:10px;font:400 14px/1.6 var(--font-sans);color:var(--muted-foreground)}
.tally h3{margin:0 0 10px;font:400 11px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.tally[hidden]{display:none}
.trow{display:grid;grid-template-columns:110px auto 1fr;align-items:center;gap:14px;padding:8px 0;border-top:1px dashed var(--border);font-size:14px}
.trow b{font-weight:600;color:var(--lane-ink)}
.dots{display:flex;gap:5px}
.dot{width:12px;height:12px;border-radius:50%;border:1.5px solid var(--lane-ink);background:transparent}
.dot.y{background:var(--lane-ink)}
.dot.x{border-style:dashed;opacity:.5}
.tally .sub{font-size:13px;color:var(--muted-foreground);margin:8px 0 0}

@media (prefers-reduced-motion:no-preference){
  .cell > *{animation:arrive .3s ease-out}
  @keyframes arrive{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}

/* Narrow: the lanes interleave per stage, test above held, so each stage still compares. */
@media (max-width:860px){
  :root{--pad:16px}
  textarea{max-width:none}
  .board{grid-template-columns:minmax(0,1fr)}
  .board > *,.board .spine,.board .test,.board .held{grid-row:auto;grid-column:auto}
  .spine.head{display:none}
  .lh,.lh.held{display:none}
  .spine{text-align:left;padding:18px 0 6px;border-top:1px dashed var(--border)}
  .spine::before{display:none}
  .spine span{padding:0;background:none}
  .spine small{display:inline;margin:0 0 0 8px;background:none}
  .cell,.cell.held,.cell.test.now,.cell.held.now{border-top:0;padding:9px 0 12px 14px;min-height:0;box-shadow:inset 2px 0 0 var(--lane)}
  .cell::before,.cell:empty::before{content:attr(data-lane);display:block;width:auto;height:auto;margin:0 0 4px;background:none;font:500 11px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--lane-ink)}
  .cell:empty::after{content:"waiting";display:block;font-size:13px;color:var(--muted-foreground)}
  .out,.out.held{margin:0 0 14px}
  .out strong{font-size:30px}
  .result-cell{border-top:0;padding-top:8px}
  .after{grid-template-columns:minmax(0,1fr)}
  .note{border-right:0;padding-bottom:20px}
}
`;

/** What the page's script needs of each category. */
const CLIENT_CATS = TRY_CATEGORIES.map((c) => ({
  id: c.id,
  creatorId: c.creatorId,
  creatorName: c.creatorName,
  testedUpc: c.tested.upc,
  testedName: c.tested.name,
  testedShort: c.tested.short,
  placeholder: c.placeholder,
  examples: c.examples,
  note: c.note,
}));

/* Client: POST the request to /try/pair, read the event stream, route each event to its lane. */
const JS = `
const $ = (s) => document.querySelector(s);
const form = $("#ask"), field = $("#request"), go = $("#go"), five = $("#five"), status = $("#status");
const picker = $("#cats"), examples = $("#examples");
const board = $("#board"), tally = $("#tally");
const usd = (m) => "$" + (m / 100).toFixed(2);
const CATS = ${JSON.stringify(CLIENT_CATS)};
const NAMES = Object.fromEntries(CATS.map((c) => [c.creatorId, c.creatorName]));
let cat = CATS.find((c) => c.id === picker.querySelector("input:checked").value) || CATS[0];
const STAGES = ${JSON.stringify(STAGES.map(([id]) => id))};

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
const LANE = { test: "Test group", held: "Held out" };
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

/* A category sets the placeholder, the examples, the lane captions and the note. */
function drawExamples() {
  examples.querySelector(".opts").replaceChildren(...cat.examples.map((text) => {
    const b = el("button", { type: "button", class: "quiet chip" }, text);
    b.addEventListener("click", () => { field.value = text; field.focus(); });
    return b;
  }));
}
function setCategory(next) {
  const wasStock = !field.value.trim() || cat.examples.includes(field.value.trim());
  cat = next;
  field.placeholder = cat.placeholder;
  if (wasStock) field.value = cat.examples[0];
  drawExamples();
  $("#test-sub").textContent = "Sees " + cat.creatorName + "'s test of the " + cat.testedName;
  $("#note-text").textContent = cat.note;
  $("#tally-title").textContent = cat.testedShort + " picks over five pairs";
  board.hidden = true; tally.hidden = true;
  say("");
  history.replaceState(null, "", cat.id === CATS[0].id ? "/try" : "/try?category=" + cat.id);
}
picker.addEventListener("change", (ev) => {
  const next = CATS.find((c) => c.id === ev.target.value);
  if (next && next !== cat) setCategory(next);
});
drawExamples();

const handlers = {
  start(lane, e) { $("#" + lane + "-agent").textContent = e.scripted ? "scripted agent" : e.agent; },
  thought(lane, e) { cell(lane, lanes[lane].stage).append(el("p", { class: "thought" }, e.text)); },
  search(lane, e) {
    const c = at(lane, "catalogue");
    c.append(el("p", {}, "search_product '" + e.query + "'"));
    if (e.sellerId) c.append(el("p", { class: "sub" }, "reading " + e.sellerId + "'s offer"));
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
    if (tests.length) for (const c of tests) r.append(el("blockquote", {}, el("cite", {}, (NAMES[c.creatorId] || c.creatorId) + " · product test"), c.summary), el("p", { class: "sub" }, c.disclosure));
    else r.append(el("p", { class: "absent" }, "No creator content. The test was held back."));
  },
  checkout(lane, e) { at(lane, "chooses").append(el("p", {}, "checkout " + e.offerId)); },
  paid(lane, e) {
    lanes[lane].paid = e;
    at(lane, "chooses").prepend(el("p", { class: "pick" }, e.product, el("span", { class: "price num" }, usd(e.total.amountMinor))));
    at(lane, "paypal").append(
      el("p", {}, "Paid " + e.seller + " through ", el("span", { class: "pp" }, "PayPal"), " from the buyer's linked wallet"),
      el("div", { class: "ids" }, "order", el("code", {}, e.orderId), "capture", el("code", {}, e.captureId || "–")),
      el("p", { class: "sub" }, "Passport in custom_id: " + e.passportChars + " of 127 characters"));
  },
  joined(lane, e) {
    at(lane, "engine").append(el("p", {}, e.unattributedReason
      ? (e.unattributedReason === "capture_not_received" ? "The capture webhook hasn't arrived." : "Passport rejected: " + e.unattributedReason)
      : "Capture webhook joined to the " + (e.arm === "none" ? "held-out" : e.arm) + " group by the signed passport."));
  },
  verdict(lane, e) {
    const v = e.verdict, p = lanes[lane].paid;
    const head = p ? p.product : "No purchase";
    let credit;
    if (v.credited) {
      const names = v.credits.map((c) => (e.creatorNames[c.creatorId] || c.creatorId) + " " + usd(c.amount.amountMinor));
      credit = el("p", { class: "credit" }, el("b", {}, "Credited: " + names.join(", ")), " · 8% commission, pending until " + (v.holdUntil || "").slice(0, 10));
    } else {
      credit = el("p", { class: "credit" }, el("b", {}, cat.creatorName + " not credited"), " · " + v.why.replace(/^Not credited: /, ""));
    }
    setOut(lane, LANE[lane] + (p ? " · bought from " + p.seller + " · " + usd(p.total.amountMinor) : ""), head, credit, e.reason ? '"' + e.reason + '"' : null, false);
  },
  error(lane, e) {
    lanes[lane].error = e.message;
    if (!lanes[lane].paid) setOut(lane, LANE[lane], "No purchase", el("p", { class: "credit" }, e.message), null, false);
  },
  done(lane) { lanes[lane].done = true; cell(lane, lanes[lane].stage).classList.remove("now"); },
};

/* Runs one pair; resolves with the Winix pick per lane, or null if it didn't run. */
async function runPair(request) {
  const res = await fetch("/try/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, category: cat.id }) });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.message || "The side by side didn't start (" + res.status + ").");
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
  const tested = cat.testedUpc;
  const pick = (l) => lanes[l].paid ? lanes[l].paid.upc === tested : null;
  return { test: pick("test"), held: pick("held") };
}

function busy(on) {
  go.disabled = on; five.disabled = on; field.disabled = on;
  for (const i of picker.querySelectorAll("input")) i.disabled = on;
  for (const b of examples.querySelectorAll("button")) b.disabled = on;
}
function say(msg, bad) { status.textContent = msg; status.className = "status" + (bad ? " bad" : ""); }

function drawTally(rows, of) {
  tally.hidden = false;
  for (const lane of ["test", "held"]) {
    const picks = rows.map((r) => r[lane]);
    const dots = $("#" + lane + "-dots");
    dots.replaceChildren(...Array.from({ length: of }, (_, i) =>
      el("span", { class: "dot" + (picks[i] === true ? " y" : picks[i] === false ? "" : " x"), "aria-hidden": "true" })));
    const n = picks.filter((p) => p === true).length;
    $("#" + lane + "-count").textContent = n + " of " + picks.length + " bought the " + cat.testedShort;
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
    else say(times > 1 ? "Done: " + times + " pairs." : "Done. Run it again, or run five pairs and count the " + cat.testedShort + " picks.");
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

export function tryPage(o: {
  request: string;
  agent: string;
  scripted: boolean;
  category?: TryCategoryId;
}): string {
  const cat = tryCategory(o.category ?? "purifier");
  // DOM order is spine, test, held (read in that order on a phone); wide screens place each
  // row by --r so the stage label sits between the two lanes.
  const rows = STAGES.map(
    ([id, label], i) =>
      `<div class="spine" style="--r:${i + 2}"><span>${label}</span>${id === "catalogue" ? '<small id="same" aria-live="polite"></small>' : ""}</div><div class="cell test" style="--r:${i + 2}" id="test-${id}" data-lane="Test group"></div><div class="cell held" style="--r:${i + 2}" id="held-${id}" data-lane="Held out"></div>`,
  ).join("");
  const last = STAGES.length + 2;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Two agents, one request · CITED</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${siteMeta({ title: "Run a shopping agent · CITED", description: "Type what the buyer wants. An agent shops, pays a seller through PayPal, and CITED decides whether the creator earns.", path: "/try" })}
${SITE_HEAD_HTML}
<style>${SITE_THEME_CSS}${CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}</style></head><body>
${siteHeader("try")}
<div class="ui-frame-wide"><main id="main">
<section class="hero">
<h1 class="eyebrow">One request, two live shopping agents</h1>
<form id="ask">
<fieldset class="cats" id="cats"><legend>What are they shopping for?</legend><div class="opts">${TRY_CATEGORIES.map(
    (c) =>
      `<label><input type="radio" name="category" value="${c.id}"${c.id === cat.id ? " checked" : ""}>${esc(c.label)}</label>`,
  ).join("")}</div></fieldset>
<label class="sr" for="request">What should the agents buy?</label>
<textarea id="request" name="request" rows="2" maxlength="280" spellcheck="false" placeholder="${esc(cat.placeholder)}">${esc(o.request)}</textarea>
<fieldset class="examples" id="examples"><legend>Or start from an example</legend><div class="opts">${cat.examples.map((x) => `<button type="button" class="quiet chip">${esc(x)}</button>`).join("")}</div></fieldset>
<div class="controls">
<button id="go" type="submit" class="ui-btn ui-btn-solid">Run side by side</button>
<button id="five" type="button" class="ui-btn ui-btn-quiet">Run 5 pairs</button>
<p class="who${o.scripted ? " scripted" : ""}">Agents: <b>${esc(o.agent)}</b> · each pays the seller through PayPal from the buyer's linked wallet (simulated PayPal)</p>
</div>
<p class="fixed">Both agents get the same request and the same offers in the same order. For this side by side we fix the groups; the real catalogue assigns them at random.</p>
<p id="status" class="status" role="status" aria-live="polite"></p>
</form>
</section>
<section id="board" class="board ui-band" hidden aria-label="The two agents' runs">
<div class="spine head" style="--r:1"></div>${laneHead("test", "Test group", `Sees ${esc(cat.creatorName)}'s test of the ${esc(cat.tested.name)}`, o.agent)}${laneHead("held", "Held out", "Sees everything except the test", o.agent)}
${rows}
<div class="spine result" style="--r:${last}"><span>Bought</span></div><div class="result-cell test" style="--r:${last}"><div id="test-out" class="out test wait" aria-live="polite"></div></div><div class="result-cell held" style="--r:${last}"><div id="held-out" class="out held wait" aria-live="polite"></div></div>
</section>
<section class="after ui-band">
<div class="note"><p><span id="note-text">${esc(cat.note)}</span> <a href="/proof">See the proof</a>.</p>
<p>Live runs keep their own record. They never change the recorded demo's numbers on the console, and a side by side counts as two runs against the hourly limit.</p></div>
<div id="tally" class="tally" hidden aria-live="polite"><h3 id="tally-title">${esc(cat.tested.short)} picks over five pairs</h3>
<div class="trow test"><b>Test group</b><span class="dots" id="test-dots"></span><span id="test-count" class="num"></span></div>
<div class="trow held"><b>Held out</b><span class="dots" id="held-dots"></span><span id="held-count" class="num"></span></div>
<p class="sub">Filled: bought the tested product. Dashed: not run yet, or no purchase.</p></div>
</section>
</main></div>
<script>${JS}</script>
</body></html>`;
}
