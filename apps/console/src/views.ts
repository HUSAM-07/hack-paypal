import type { DemoData, PayoutData, RunView } from "./data";
import { armLabel, dateTime, esc, shopName, usd } from "./format";

const CSS = `
:root{--ink:#1c2128;--muted:#5b6571;--line:#dcd9d1;--bg:#f6f5f1;--paper:#fff;--test:#0a6b53;--test-bg:#e4f2ec;--held:#5b4a14;--held-bg:#f3ecd6;--navy:#003087;--sky:#0070e0}
*{box-sizing:border-box}
html{font-size:20px}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.4}
main{max-width:1760px;margin:0 auto;padding:48px 64px 40px}
h1{font-size:1.9rem;font-weight:600;margin:0 0 .25rem}
.sub{color:var(--muted);margin:0 0 2.2rem;font-size:1.05rem}
.request{font-size:1.5rem;margin:0 0 2.4rem}
.request span{color:var(--muted);font-size:1rem;display:block;margin-bottom:.2rem}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:64px}
.col{border-top:6px solid var(--accent);padding-top:1.1rem}
.col.exposed{--accent:var(--test);--tint:var(--test-bg)}
.col.held{--accent:#a58a2a;--tint:var(--held-bg)}
.who{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.2rem}
.who h2{font-size:1.5rem;margin:0}
.who .model{color:var(--muted);font-size:.95rem}
.what{color:var(--muted);margin:0 0 1.6rem}
.step{display:grid;grid-template-columns:2.2rem 1fr;gap:0 .8rem;padding:1.05rem 0;border-top:1px solid var(--line)}
.step .n{font-weight:600;color:var(--accent)}
.step h3{margin:0 0 .35rem;font-size:.85rem;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:.01em}
.big{font-size:1.45rem;font-weight:600}
.dim{color:var(--muted)}
.passport{display:inline-flex;gap:.6rem;align-items:center;background:var(--tint);padding:.25rem .7rem;border-radius:6px;font-size:.9rem}
.hop{display:flex;align-items:center;gap:1rem;flex-wrap:nowrap;margin:.2rem 0 .45rem}
.shop{border:2px solid var(--line);background:var(--paper);border-radius:8px;padding:.5rem 1rem;font-size:1.2rem;font-weight:600}
.shop.paid{border-color:var(--accent)}
.shop small{display:block;font-weight:400;font-size:.8rem;color:var(--muted)}
.arrow{font-size:1.6rem;color:var(--muted)}
.ok{color:var(--test);font-weight:600}
.warn{color:#8a4b08}
.empty{padding:4rem 0;color:var(--muted);font-size:1.2rem}
footer{margin-top:2.4rem;color:var(--muted);font-size:.8rem;display:flex;justify-content:space-between}
.clean footer{display:none}
.nav a{color:var(--muted);margin-left:1rem}

/* payout notification */
.pay{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 0}
.notice{width:820px;background:var(--paper);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.notice header{background:var(--navy);color:#fff;padding:1.1rem 2rem;font-size:1.3rem;font-weight:700;font-style:italic;letter-spacing:.01em}
.notice .top{padding:2rem 2rem 1.4rem}
.notice .top p{margin:0;color:var(--muted)}
.amount{font-size:4.2rem;font-weight:600;line-height:1.1;margin:.3rem 0 .4rem;letter-spacing:-.01em}
.amount small{font-size:1.4rem;color:var(--muted);font-weight:400;margin-left:.4rem}
.status{display:inline-block;color:var(--test);font-weight:600}
dl{margin:0;padding:0 2rem 1.2rem}
dl div{display:grid;grid-template-columns:200px 1fr;padding:.8rem 0;border-top:1px solid var(--line)}
dt{color:var(--muted)}
dd{margin:0;font-weight:500;word-break:break-all}
dd.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
.rival{width:820px;margin-top:1.6rem;display:flex;justify-content:space-between;color:var(--muted);font-size:1.15rem;padding:0 .4rem}
.rival b{color:var(--ink);font-weight:600}
`;

function page(title: string, body: string, opts: { live: boolean; clean: boolean }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.live ? '<meta http-equiv="refresh" content="2">' : ""}
<style>${CSS}</style></head><body class="${opts.clean ? "clean" : ""}">${body}</body></html>`;
}

function waiting(msg: string): string {
  return `<div class="empty">${msg}</div>`;
}

// ───────────────────────── #28 ─────────────────────────

function runColumn(v: RunView | null, kind: "exposed" | "held"): string {
  const cls = kind;
  if (!v) {
    return `<section class="col ${cls}"><div class="who"><h2>${kind === "exposed" ? "Agent shown the test" : "Held-out agent"}</h2></div>${waiting("Waiting for this agent to buy.")}</section>`;
  }
  const { run, journey } = v;
  const arm = armLabel(run.arm);
  const hops = run.storesViewed.length ? run.storesViewed : run.shop ? [run.shop] : [];
  const paidAt = journey?.storeChosen ?? run.shop;
  const sawTest = run.creatorsSeen.length > 0;
  const shops = hops
    .map((s) => {
      const note =
        s === paidAt ? "Paid here" : sawTest && s === hops[0] ? "Saw the test here" : "Browsed";
      return `<div class="shop ${s === paidAt ? "paid" : ""}">${esc(shopName(s))}<small>${esc(note)}</small></div>`;
    })
    .join('<span class="arrow" aria-label="then">→</span>');
  const saved = journey?.priceSavedMinor;
  const passport = run.sessionId
    ? `<span class="passport">Passport <b>${esc(run.sessionId.slice(0, 12))}</b> · ${esc(arm.title.toLowerCase())}</span>`
    : `<span class="dim">No passport recorded</span>`;
  const commission = journey
    ? journey.commission.pending + journey.commission.paid + journey.commission.voided
    : null;
  const bought = run.product
    ? `${esc(run.product.name)}${run.totalMinor !== null ? ` · ${usd(run.totalMinor)}` : ""}`
    : "No purchase";

  const order = journey
    ? `<div class="big">Order ${esc(journey.orderId)}</div>
       <div class="${commission ? "ok" : "dim"}">${
         commission
           ? `Commission ${usd(commission)} held 30 days`
           : "No commission: the test did not cause this sale"
       }</div>`
    : `<div class="dim">${esc(run.orderId ?? "")} — waiting for the engine to record it</div>`;

  return `<section class="col ${cls}">
  <div class="who"><h2>${kind === "exposed" ? "Agent shown the test" : "Held-out agent"}</h2><span class="model">${esc(run.model)}</span></div>
  <p class="what">${esc(arm.detail)}</p>
  <div class="step"><span class="n">1</span><div><h3>Passport travels with the agent</h3>${passport}</div></div>
  <div class="step"><span class="n">2</span><div><h3>Stores visited</h3><div class="hop">${shops}</div>${
    saved && saved > 0 ? `<div class="ok">${usd(saved)} cheaper than the other store</div>` : ""
  }${run.passportAttached ? `<div class="dim">Passport attached at checkout</div>` : ""}</div></div>
  <div class="step"><span class="n">3</span><div><h3>Bought</h3><div class="big">${bought}</div>${
    run.shop ? `<div class="dim">at ${esc(shopName(run.shop))}</div>` : ""
  }</div></div>
  <div class="step"><span class="n">4</span><div><h3>Order lands in the engine</h3>${order}</div></div>
</section>`;
}

export function demoPage(d: DemoData, opts: { live: boolean; clean: boolean }): string {
  const request = (d.exposed ?? d.heldOut)?.run.request;
  const body = `<main>
<h1>Same request, two agents</h1>
<p class="sub">The shops and prices are identical. Only the creator's test differs.</p>
${request ? `<p class="request"><span>Buyer request</span>“${esc(request)}”</p>` : ""}
${
  d.exposed || d.heldOut
    ? `<div class="cols">${runColumn(d.exposed, "exposed")}${runColumn(d.heldOut, "held")}</div>`
    : waiting(
        "No agent runs yet. Write run records with the agents CLI (<code>--out .cited/runs.jsonl</code>) or start the demo runner.",
      )
}
${d.engineError ? `<p class="warn">${esc(d.engineError)}</p>` : ""}
<footer><span>CITED demo console</span><span class="nav"><a href="/">Runs</a><a href="/payout">Payout</a></span></footer>
</main>`;
  return page("CITED · two agents", body, opts);
}

// ───────────────────────── #29 ─────────────────────────

function statusWord(s: string): string {
  return s === "SUCCESS" ? "Completed" : s === "PENDING" || s === "PROCESSING" ? "Pending" : s;
}

export function payoutPage(p: PayoutData | null, opts: { live: boolean; clean: boolean }): string {
  if (!p) {
    return page(
      "CITED · payout",
      `<main>${waiting("No payout yet. Payouts are sent when a 30-day hold ends.")}</main>`,
      opts,
    );
  }
  const mismatch = p.ledgerPaidMinor !== null && p.ledgerPaidMinor !== p.amountMinor;
  const name = p.creatorName;
  const body = `<div class="pay"><article class="notice">
<header>PayPal</header>
<div class="top">
  <p>${esc(name)}, you received a payment</p>
  <div class="amount">${usd(p.amountMinor)}<small>${esc(p.currency)}</small></div>
  <p>From CITED · commission on sales your test caused</p>
</div>
<dl>
  <div><dt>Status</dt><dd><span class="status">${esc(statusWord(p.status))}</span></dd></div>
  <div><dt>Sent to</dt><dd>${esc(name)} · ${esc(p.receiver)}</dd></div>
  <div><dt>Date</dt><dd>${esc(dateTime(p.paidAt))}</dd></div>
  <div><dt>Payout batch ID</dt><dd class="mono">${esc(p.paypalBatchId ?? p.senderBatchId)}</dd></div>
  <div><dt>${p.itemIdKind === "payout_item_id" ? "Payout item ID" : "Item reference"}</dt><dd class="mono">${esc(p.itemId)}</dd></div>
</dl></article>
${
  p.rival
    ? `<div class="rival"><span><b>${esc(p.rival.name)}</b> · ${p.rival.causedUnits} extra units caused</span><span>${usd(p.rival.paidMinor)} paid · no lift</span></div>`
    : ""
}
${mismatch ? `<p class="warn">Ledger shows ${usd(p.ledgerPaidMinor ?? 0)} paid, which differs from this payout.</p>` : ""}
</div>`;
  return page("CITED · payout", body, opts);
}
