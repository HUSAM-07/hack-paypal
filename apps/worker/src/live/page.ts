/**
 * /try: the request is the headline; the run unfolds beneath it as the console's timeline, and
 * the timeline takes the colour of the arm the catalogue drew (test green, placebo/held amber).
 * Everything a model or a third party wrote is rendered with textContent, never as HTML.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
  --accent:var(--muted);--accent-ink:var(--ink);--tint:#F1EEE8;
}
*{box-sizing:border-box}
html{font-size:20px;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.45;-webkit-font-smoothing:antialiased}
.num{font-variant-numeric:tabular-nums lining-nums}
a{color:inherit}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:2px}
body.arm-test{--accent:var(--test);--accent-ink:var(--test);--tint:var(--test-tint)}
body.arm-placebo,body.arm-none{--accent:var(--held);--accent-ink:var(--held-ink);--tint:var(--held-tint)}

.nav{display:flex;align-items:baseline;gap:2rem;max-width:1180px;margin:0 auto;padding:22px 48px 0;font-size:.8rem}
.nav .mark{font-family:var(--serif);font-size:1.15rem;font-weight:600;letter-spacing:.06em;text-decoration:none;margin-right:auto}
.nav a{color:var(--muted);text-decoration:none;padding:.3rem 0;white-space:nowrap}
.nav a:hover{color:var(--ink)}
.nav a[aria-current]{color:var(--ink);box-shadow:inset 0 -1.5px 0 var(--ink)}

main{max-width:1180px;margin:0 auto;padding:40px 48px 64px}
.eyebrow{margin:0 0 .5rem;font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
form{margin:0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
textarea{display:block;width:100%;max-width:32ch;resize:none;border:0;border-bottom:1.5px solid var(--line);background:transparent;color:var(--ink);
  font-family:var(--serif);font-weight:400;font-size:2.6rem;line-height:1.12;letter-spacing:-.012em;padding:0 0 .35rem;field-sizing:content;min-height:2.4em}
textarea:focus{outline:none;border-bottom-color:var(--ink)}
textarea:disabled{color:var(--muted)}
.controls{display:flex;align-items:center;gap:1.4rem;flex-wrap:wrap;margin:1.3rem 0 0}
button{font:inherit;font-size:.9rem;font-weight:600;background:var(--ink);color:var(--bg);border:0;border-radius:999px;padding:.7rem 1.5rem;min-height:44px;cursor:pointer}
button:hover{background:#2B2E36}
button:active{transform:scale(.96)}
button:disabled{background:var(--muted);cursor:default;transform:none}
.who{font-size:.8rem;color:var(--muted);margin:0}
.who b{font-family:var(--mono);font-weight:500;color:var(--ink)}
.who.scripted b{color:var(--held-ink)}
.status{min-height:1.4em;margin:1rem 0 0;font-size:.85rem;color:var(--muted)}
.status.bad{color:var(--held-ink)}

.run{display:grid;grid-template-columns:minmax(0,1fr) 22rem;gap:3.2rem;margin-top:2.4rem;border-top:1px solid var(--ink);padding-top:1.6rem}
.run[hidden]{display:none}
.steps{list-style:none;margin:0;padding:0;position:relative}
.steps::before{content:"";position:absolute;left:5px;top:.55rem;bottom:.6rem;width:2px;background:var(--accent);opacity:.35;transition:background-color .4s}
.step{position:relative;display:grid;grid-template-columns:6.4rem minmax(0,1fr);gap:.9rem;padding:0 0 1.5rem 1.6rem}
.step::before{content:"";position:absolute;left:0;top:.42rem;width:12px;height:12px;border-radius:50%;background:var(--bg);border:2px solid var(--accent);transition:border-color .4s}
.step .k{font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);padding-top:.32rem}
.step p{margin:0}
.step .sub{color:var(--muted);font-size:.8rem;margin-top:.25rem}
.thought p{font-family:var(--serif);font-style:italic;font-size:1.08rem;line-height:1.35;color:#3A3D45}
.arm{display:inline-flex;align-items:flex-start;gap:.5rem;font-family:var(--serif);font-size:1.55rem;font-weight:500;line-height:1.1}
.arm::before{content:"";flex:none;width:.6rem;height:.6rem;margin-top:.42em;border-radius:50%;background:var(--accent)}
.offers{width:100%;max-width:34rem;border-collapse:collapse;font-size:.85rem;margin-top:.15rem}
.offers td{padding:.32rem 0;border-top:1px solid var(--line)}
.offers td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.offers tr:first-child td{border-top:0}
blockquote{margin:.6rem 0 0;padding:.1rem 0 .1rem .9rem;border-left:2px solid var(--accent);font-family:var(--serif);font-size:1rem;line-height:1.35;max-width:38rem}
blockquote cite{display:block;font-family:var(--sans);font-style:normal;font-size:.7rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem}
.paid{font-family:var(--serif);font-size:1.55rem;font-weight:500;line-height:1.15}
.paid .price{font-family:var(--sans);font-size:1.05rem;font-weight:500;color:var(--muted);margin-left:.35rem}
code{font-family:var(--mono);font-size:.75rem;background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:.08rem .35rem;overflow-wrap:anywhere}
.pp{font-weight:700;font-style:italic;color:var(--pp-navy);letter-spacing:-.01em}
.ids{display:flex;flex-wrap:wrap;gap:.4rem .6rem;align-items:center;margin-top:.4rem;font-size:.8rem}

aside{align-self:start;position:sticky;top:24px}
.verdict{border-top:3px solid var(--accent);background:var(--tint);padding:1.1rem 1.3rem 1.25rem;transition:background-color .4s,border-color .4s}
.verdict .k{font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--accent-ink)}
.verdict strong{display:block;font-family:var(--serif);font-weight:500;font-size:2.2rem;line-height:1.08;letter-spacing:-.015em;margin:.25rem 0 .45rem;text-wrap:balance}
.verdict p{margin:0;font-size:.9rem}
.verdict dl{margin:.9rem 0 0;font-size:.8rem}
.verdict dl div{display:grid;grid-template-columns:6.2rem minmax(0,1fr);gap:.6rem;padding:.4rem 0;border-top:1px solid rgba(22,24,29,.1)}
.verdict dt{color:var(--muted)}
.verdict dd{margin:0}
.verdict .why{font-family:var(--serif);font-style:italic;font-size:.95rem}
.verdict.wait strong{color:var(--muted)}
.foot{margin-top:1.2rem;font-size:.75rem;color:var(--muted)}

@media (prefers-reduced-motion:no-preference){
  .step{animation:arrive .32s ease-out}
  @keyframes arrive{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (max-width:900px){
  .nav,main{padding-left:20px;padding-right:20px}
  .nav{gap:.9rem;font-size:.72rem}
  main{padding-top:28px}
  textarea{font-size:1.75rem;max-width:none}
  .run{grid-template-columns:1fr;gap:1.8rem}
  aside{position:static;order:-1}
  .step{grid-template-columns:1fr;gap:.2rem}
  .step .k{padding-top:0}
  .verdict strong{font-size:1.8rem}
}
`;

/* Client: POST the request, read the event stream, append one step per event. */
const JS = `
const $ = (s) => document.querySelector(s);
const form = $("#ask"), field = $("#request"), go = $("#go"), status = $("#status");
const run = $("#run"), steps = $("#steps"), verdict = $("#verdict");
const usd = (m) => "$" + (m / 100).toFixed(2);
const ARM = { test: "Test arm: shown the creator’s test", placebo: "Placebo arm: shown the creator’s other content", none: "Held out: no creator content" };

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
function step(label, ...body) {
  const li = el("li", { class: "step" }, el("span", { class: "k" }, label), el("div", {}, ...body));
  steps.append(li);
  return li;
}
function setVerdict(kicker, head, body, rows) {
  verdict.className = "verdict" + (rows ? "" : " wait");
  verdict.replaceChildren(el("div", { class: "k" }, kicker), el("strong", {}, head));
  if (body) verdict.append(el("p", {}, body));
  if (rows && rows.length) {
    const dl = el("dl");
    for (const [dt, dd, cls] of rows) dl.append(el("div", {}, el("dt", {}, dt), el("dd", cls ? { class: cls } : {}, dd)));
    verdict.append(dl);
  }
}

let paid = null, reason = null, arm = null;
const handlers = {
  start(e) { status.textContent = (e.scripted ? "Scripted agent" : e.agent) + " is shopping…"; },
  thought(e) { step("Thinks", el("p", {}, e.text)).classList.add("thought"); },
  search(e) {
    step("Searches", el("p", {}, "search_product “" + e.query + "”"),
      e.sellerId ? el("p", { class: "sub" }, "reading " + e.sellerId + "’s offer") : null);
  },
  results(e) {
    if (e.arm && !arm) {
      arm = e.arm;
      document.body.classList.add("arm-" + arm);
      step("Arm", el("span", { class: "arm" }, ARM[arm] || arm),
        el("p", { class: "sub" }, "Drawn by the holdout schedule and signed into the passport. Ranking is the same in every arm."));
    }
    const t = el("table", { class: "offers num" });
    for (const o of e.offers) t.append(el("tr", {}, el("td", {}, o.seller), el("td", {}, o.product), el("td", {}, usd(o.priceMinor))));
    const quotes = e.content.map((c) => el("blockquote", {},
      el("cite", {}, c.creatorId + (c.kind === "test" ? " · test" : " · other content")), c.summary));
    step("Reads", el("p", { class: "sub" }, e.offers.length + " offers from sellers synced to PayPal"), t, ...quotes);
  },
  checkout(e) { step("Checks out", el("p", {}, "checkout " + e.offerId)); },
  paid(e) {
    paid = e;
    step("Pays",
      el("p", { class: "paid" }, e.product, el("span", { class: "price num" }, usd(e.total.amountMinor))),
      el("p", { class: "sub" }, "to " + e.seller + " through ", el("span", { class: "pp" }, "PayPal"), ", from the buyer’s linked wallet"),
      el("div", { class: "ids" }, "order", el("code", {}, e.orderId), "capture", el("code", {}, e.captureId || "–")),
      el("p", { class: "sub" }, "Passport rides in custom_id (" + e.passportChars + " of 127 characters)."));
  },
  joined(e) {
    step("Engine", el("p", {}, e.unattributedReason
      ? (e.unattributedReason === "capture_not_received" ? "The capture webhook hasn’t arrived." : "Capture received, passport rejected: " + e.unattributedReason)
      : "PayPal’s capture webhook arrived; the signed passport joined the sale to the " + (e.arm || "?") + " arm."));
  },
  verdict(e) {
    const v = e.verdict, rows = [];
    if (paid) rows.push(["Paid", paid.seller + " · " + usd(paid.total.amountMinor)], ["Order", paid.orderId]);
    if (v.holdUntil) rows.push(["Held until", v.holdUntil.slice(0, 10)]);
    if (e.reason) rows.push(["Agent’s reason", "“" + e.reason + "”", "why"]);
    if (v.credited) {
      const names = v.credits.map((c) => (e.creatorNames[c.creatorId] || c.creatorId) + " " + usd(c.amount.amountMinor));
      setVerdict("Credited, pending", names.join(", "), v.why + " 8% commission, held 30 days so a refund can void it.", rows);
    } else {
      setVerdict("Not credited", "No credit", v.why, rows);
    }
  },
  error(e) { status.textContent = e.message; status.className = "status bad"; },
  done() {
    if (!status.classList.contains("bad")) status.textContent = "Done. Run it again: the arm is drawn fresh each time.";
    go.disabled = false; field.disabled = false; go.textContent = "Run again";
  },
};

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const request = field.value.trim();
  if (request.length < 3) { status.textContent = "Write what the buyer wants first."; status.className = "status bad"; return; }
  go.disabled = true; field.disabled = true; status.className = "status";
  status.textContent = "Starting the agent…";
  paid = null; reason = null; arm = null;
  document.body.classList.remove("arm-test", "arm-placebo", "arm-none");
  steps.replaceChildren(); run.hidden = false;
  setVerdict("Verdict", "Waiting for the sale", "The engine decides once PayPal reports the capture.");
  try {
    const res = await fetch("/try/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request }) });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      handlers.error({ message: j.message || "The run didn’t start (" + res.status + ")." });
      handlers.done(); return;
    }
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
        if (e.type === "done") ended = true;
        handlers[e.type] && handlers[e.type](e);
      }
    }
    if (!ended) { handlers.error({ message: "The connection closed before the run finished." }); handlers.done(); }
  } catch {
    handlers.error({ message: "The connection dropped. Check your network and run it again." });
    handlers.done();
  }
});
`;

export function tryPage(o: { request: string; agent: string; scripted: boolean }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Run a shopping agent · CITED</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style></head><body>
<nav class="nav" aria-label="CITED"><a class="mark" href="/">CITED</a>
<a href="/console">Console</a><a href="/console/payout">Payout</a><a href="/try" aria-current="page">Run an agent</a></nav>
<main>
<p class="eyebrow">Run a live shopping agent</p>
<form id="ask">
<label class="sr" for="request">What should the agent buy?</label>
<textarea id="request" name="request" rows="2" maxlength="280" spellcheck="false">${esc(o.request)}</textarea>
<div class="controls">
<button id="go" type="submit">Run the agent</button>
<p class="who${o.scripted ? " scripted" : ""}">Agent: <b>${esc(o.agent)}</b> · pays the seller through PayPal from the buyer’s linked wallet (simulated PayPal)</p>
</div>
<p id="status" class="status" role="status" aria-live="polite"></p>
</form>
<section id="run" class="run" hidden aria-label="The agent's run">
<ol id="steps" class="steps"></ol>
<aside><div id="verdict" class="verdict wait" aria-live="polite"></div>
<p class="foot">Live runs keep their own record. They never change the recorded demo’s numbers on the console.</p></aside>
</section>
</main>
<script>${JS}</script>
</body></html>`;
}
