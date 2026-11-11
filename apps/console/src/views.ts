import { SITE_NAV_TOUCH_CSS, SITE_THEME_CSS, siteNavLinks } from "@pact/protocol";
import type { DemoData, PayoutData, RunView, StatementData } from "./data";
import { creatorName, esc, shopName, usd } from "./format";
import { agentLabel } from "./runs";

/*
 * Fonts come from the worker's own static assets (/fonts/*), so the demo-page CSP
 * (font-src falls back to 'self') allows them. Missing files fall back to system faces.
 */
/* After the shared dark theme: the PayPal notification keeps PayPal's own light card. */
const CONSOLE_DARK = `/* the replay */
.scene{display:none;position:relative;margin:0 0 2.6rem;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:radial-gradient(ellipse 70% 60% at 50% 0%,rgba(95,217,160,.07),transparent 70%),var(--bg)}
.has-scene .scene{display:block}
#scene{position:relative;height:clamp(320px,36vw,600px)}
#scene canvas{display:block;width:100%;height:100%}
.sl-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.sl{position:absolute;left:0;top:0;will-change:transform;font:400 12px/1.3 var(--sans);color:var(--muted);white-space:nowrap}
.sl-in{transform:translate(-50%,0);text-align:center}
.sl b{display:block;color:var(--ink);font-weight:500;font-size:13px}
.sl span{display:block}
.sl-head .sl-in{font:500 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.sl-call .sl-in{transform:translate(-50%,-100%) translateY(6px);padding:.3rem .55rem;border-radius:6px;border:1px solid currentColor;background:rgba(11,11,10,.85);font:500 11px/1.3 var(--mono);opacity:0;transition:opacity .35s,transform .35s}
.sl-call.on .sl-in{opacity:1;transform:translate(-50%,-100%)}
.sl-call .sl-k{font-size:9px;letter-spacing:.1em;text-transform:uppercase;opacity:.8}
.sl-test{color:var(--test)}.sl-held{color:var(--held)}
.sl-out .sl-in{opacity:0;transition:opacity .4s}
.sl-out.on .sl-in{opacity:1}
.sl-paid b{color:var(--test);font-size:15px}
.sl-paid span{color:var(--test)}
.sl-zero b{color:var(--muted)}
.receipts{margin:0 0 .9rem;font:500 .62rem/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.scene-bar{display:flex;align-items:stretch;border-top:1px solid var(--line)}
.scene-chs{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));flex:1}
.scene-chs li{border-right:1px solid var(--line)}
.scene-ch{all:unset;box-sizing:border-box;display:flex;align-items:baseline;gap:.6rem;width:100%;height:100%;padding:.85rem 1rem;cursor:pointer;position:relative;color:var(--muted);transition:color .2s,background .2s}
.scene-ch i{position:absolute;left:0;right:0;top:-1px;height:2px;background:var(--test);transform:scaleX(var(--p,0));transform-origin:left}
.scene-ch[aria-current="step"]{color:var(--ink);background:var(--raise)}
.scene-ch:focus-visible{outline:2px solid var(--test);outline-offset:-2px}
.scene-ch .n{font:500 .55rem/1 var(--mono);color:var(--test)}
.scene-ch b{font:500 .7rem/1.25 var(--sans)}
.scene-play,.scene-replay{all:unset;box-sizing:border-box;cursor:pointer;padding:0 1.1rem;font:500 .55rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink);border-right:1px solid var(--line)}
.scene-replay{border-right:0}
.scene-play:hover,.scene-replay:hover{color:var(--test)}
.scene-play:focus-visible,.scene-replay:focus-visible{outline:2px solid var(--test);outline-offset:-2px}
.sc-title{position:absolute;inset:0;z-index:3;display:grid;place-content:center;text-align:center;gap:.5rem;background:rgba(11,11,10,.72);font:300 clamp(1.6rem,3.4vw,2.8rem)/1.1 var(--serif);letter-spacing:-.015em;color:var(--ink);opacity:0;pointer-events:none;transition:opacity .45s}
.sc-title span{font:500 .55rem/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--test)}
.sc-title.on{opacity:1}
.sc-caption{position:absolute;left:50%;bottom:1.1rem;z-index:2;transform:translate(-50%,6px);max-width:min(92%,46rem);margin:0;padding:.55rem 1rem;border-radius:8px;background:rgba(11,11,10,.86);border:1px solid var(--line);font:400 .8rem/1.4 var(--sans);color:var(--ink);text-align:center;opacity:0;transition:opacity .3s,transform .3s}
.sc-caption.on{opacity:1;transform:translate(-50%,0)}
.sc-compare{position:absolute;left:50%;bottom:.9rem;z-index:2;transform:translate(-50%,8px);width:min(94%,42rem);display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden;opacity:0;pointer-events:none;transition:opacity .5s,transform .5s}
.sc-compare.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.sc-compare .cmp{background:rgba(19,19,18,.96);padding:.8rem 1rem}
.sc-compare .k{display:block;font:500 .5rem/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--held)}
.sc-compare .cmp-test .k{color:var(--test)}
.sc-compare b{display:block;font:400 1.15rem/1.2 var(--serif);margin:.3rem 0 .15rem}
.sc-compare .amt{font:500 .7rem/1.3 var(--mono);color:var(--muted)}
.sc-compare .cmp-test .amt{color:var(--test)}
.sc-compare p{grid-column:1/-1;margin:0;background:rgba(19,19,18,.96);padding:.6rem 1rem;font-size:.66rem;color:var(--ink-2)}
@media (max-width:1100px){.scene-ch b{font-size:.8rem}.scene-ch .n{font-size:.7rem}.scene-play,.scene-replay{font-size:.7rem}}
@media (max-width:760px){#scene{height:500px}.sl{font-size:11px}.sl b{font-size:12px}.scene-bar{flex-wrap:wrap}.scene-chs{grid-template-columns:1fr;flex-basis:100%}.scene-chs li{border-right:0;border-bottom:1px solid var(--line)}.scene-play,.scene-replay{flex:1;padding:.9rem 1rem;text-align:center}.sc-caption{font-size:.85rem;bottom:.6rem}.sc-compare{bottom:.6rem}.sc-compare .cmp{padding:.6rem .7rem}.sc-compare b{font-size:1rem}.sc-compare p{display:none}.sc-compare .k{font-size:.62rem}.sc-compare .amt{font-size:.78rem}}
.notice{--ink:#16181D;--muted:#5B5F68;--line:#E6E2DA;--paper:#FFFFFF;--test:#1F7A55;color:var(--ink);border-color:transparent;box-shadow:0 30px 80px -20px rgba(0,0,0,.7)}.lanes{border-top-color:var(--line-strong)}.step::before{background:var(--bg)}.verdict strong{font-weight:300}.request{font-weight:300}`;

const CSS = `
@font-face{font-family:"Newsreader";font-style:normal;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Newsreader";font-style:italic;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-italic-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-latin-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-mono-latin-v1.woff2") format("woff2-variations")}
:root{
  --bg:#FAF8F4;--paper:#FFFFFF;--ink:#16181D;--muted:#5B5F68;--line:#E6E2DA;
  --test:#1F7A55;--test-tint:#E7F1EC;--held:#B7791F;--held-ink:#8A5A12;--held-tint:#F7EEDD;
  --pp-navy:#003087;--pp-blue:#0070E0;
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

/* nav (hidden with ?clean=1) */
.nav{display:flex;align-items:baseline;gap:2rem;max-width:1760px;margin:0 auto;padding:22px 64px 0;font-size:.8rem}
.nav .mark{font-family:var(--serif);font-size:1.15rem;font-weight:600;letter-spacing:.06em;text-decoration:none;margin-right:auto}
.nav a{color:var(--muted);text-decoration:none;padding:.3rem 0}
.nav a:hover{color:var(--ink)}
.nav a[aria-current]{color:var(--ink);box-shadow:inset 0 -1.5px 0 var(--ink)}
.clean .nav{display:none}

/* ───── two agents ───── */
.stage{max-width:1760px;margin:0 auto;padding:36px 64px 48px}
.clean .stage{padding-top:52px}
.lede{display:flex;justify-content:space-between;align-items:baseline;gap:2rem;margin:0 0 .6rem}
.lede h1{margin:0;font-family:var(--sans);font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.lede p{margin:0;color:var(--muted);font-size:.8rem}
.request{margin:0 0 2.2rem;font-family:var(--serif);font-weight:400;font-size:2.6rem;line-height:1.12;letter-spacing:-.012em;max-width:30ch;text-wrap:balance}
.request q{quotes:"\\201C" "\\201D"}
.lanes{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--ink)}
.lane{--accent:var(--test);--accent-ink:var(--test);--tint:var(--test-tint);padding:1.6rem 3rem 0 0;display:flex;flex-direction:column}
.lane + .lane{padding:1.6rem 0 0 3rem;border-left:1px solid var(--line)}
.lane.held{--accent:var(--held);--accent-ink:var(--held-ink);--tint:var(--held-tint)}
.lane-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-bottom:1.4rem}
.lane-head h2{margin:0;font-family:var(--serif);font-size:1.7rem;font-weight:500;letter-spacing:-.005em}
.lane-head h2::before{content:"";display:inline-block;width:.55rem;height:.55rem;border-radius:50%;background:var(--accent);margin-right:.55rem;vertical-align:.12em}
.lede-note{font-size:.85rem;color:var(--muted);margin-top:.35rem}.lede-note a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.lane-head .model{font-family:var(--mono);font-size:.7rem;color:var(--muted)}

.steps{list-style:none;margin:0;padding:0;position:relative}
.steps::before{content:"";position:absolute;left:5px;top:.55rem;bottom:.6rem;width:2px;background:var(--accent);opacity:.35}
.step{position:relative;display:grid;grid-template-columns:5.6rem 1fr;gap:.9rem;padding:0 0 1.7rem 1.6rem}
.step::before{content:"";position:absolute;left:0;top:.42rem;width:12px;height:12px;border-radius:50%;background:var(--bg);border:2px solid var(--accent)}
.step .k{font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);padding-top:.32rem}
.step p{margin:0}
.lane,.step > *{min-width:0}
.dim{color:var(--muted)}
.note{color:var(--muted);font-size:.8rem;margin-top:.35rem}
.note.good{color:var(--test);font-weight:500}

/* the passport ticket */
.ticket{display:inline-flex;white-space:nowrap;align-items:stretch;margin-top:.55rem;background:var(--paper);border:1.5px solid var(--accent);border-radius:7px;position:relative;font-size:.7rem;line-height:1.25}
.ticket .stub{background:var(--accent);color:var(--bg);padding:.42rem .6rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;display:flex;align-items:center;border-radius:4px 0 0 4px}
.lane.held .ticket .stub{background:var(--held-ink)}
.ticket .body{padding:.36rem .8rem .36rem .75rem;border-left:1.5px dashed var(--accent)}
.ticket .body b{display:block;font-family:var(--mono);font-weight:500;font-size:.75rem;letter-spacing:.01em}
.ticket .body span{color:var(--muted)}
.ticket.mini{margin:0;font-size:.62rem}
.ticket.mini .stub{padding:.25rem .45rem}
.ticket.mini .body{padding:.22rem .55rem}
.ticket.mini .body b{font-size:.66rem}

/* offer → seller */
.hop{display:flex;align-items:center;gap:0;flex-wrap:nowrap}
.store{font-family:var(--serif);font-size:1.55rem;font-weight:500;line-height:1.1;padding:.15rem 0}
.store small{display:block;font-family:var(--sans);font-size:.68rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-top:.25rem}
.store.paid small{color:var(--accent-ink)}
.track{position:relative;flex:1 1 13.5rem;min-width:10.5rem;max-width:13.5rem;height:3.2rem;margin:0 .9rem}
.track::before{content:"";position:absolute;left:0;right:8px;top:50%;border-top:2px dashed var(--accent)}
.track::after{content:"";position:absolute;right:0;top:calc(50% - 6px);border-left:10px solid var(--accent);border-top:7px solid transparent;border-bottom:7px solid transparent}
.track .ticket{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
@media (prefers-reduced-motion:no-preference){
  .animate .track .ticket{animation:travel 1.6s cubic-bezier(.45,0,.2,1) .5s both}
}
@keyframes travel{from{left:0;transform:translate(0,-50%)}to{left:50%;transform:translate(-50%,-50%)}}

.product{font-family:var(--serif);font-size:1.55rem;font-weight:500;line-height:1.15}
.product .price{font-family:var(--sans);font-size:1.05rem;font-weight:500;color:var(--muted);margin-left:.35rem}
.capture{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;font-size:.85rem;margin-top:.3rem!important}
.capture .via{flex-basis:100%;font-size:.8rem}
.capture .pp{font-weight:700;font-style:italic;color:var(--pp-text);letter-spacing:-.01em}
.capture code{font-family:var(--mono);font-size:.75rem;background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:.08rem .35rem}

/* verdict */
.verdict{margin-top:auto;border-top:3px solid var(--accent);background:var(--tint);padding:1.1rem 1.4rem 1.2rem}
.verdict .k{font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--accent-ink)}
.verdict strong{display:block;font-family:var(--serif);font-weight:500;font-size:2.5rem;line-height:1.08;letter-spacing:-.015em;margin:.2rem 0 .3rem}
.verdict p{margin:0;font-size:.95rem}
.verdict .amt{font-weight:600;color:var(--accent-ink)}
.lane.held .verdict strong{color:var(--ink)}

.empty{padding:3rem 0;color:var(--muted);font-size:1.05rem;max-width:42ch}
.empty code{font-family:var(--mono);font-size:.8em}
.warn{color:var(--held-ink);font-size:.85rem;margin:1.2rem 0 0}

/* ───── payout notification ───── */
.pay{min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px 56px}
.clean .pay{min-height:100vh}
.mail{width:100%;max-width:760px}
.notice{background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(22,24,29,.06),0 12px 32px -12px rgba(22,24,29,.14)}
.notice header{background:var(--pp-navy);color:#fff;padding:1.05rem 2.2rem;display:flex;justify-content:space-between;align-items:center}
.notice header .pp{font-size:1.4rem;font-weight:800;font-style:italic;letter-spacing:-.02em}
.notice header .pp span{color:#7FB8FF}
.notice header small{font-size:.75rem;opacity:.85}
.notice .top{padding:2.2rem 2.2rem 1.8rem;border-bottom:1px solid var(--line)}
.notice .top p{margin:0;color:var(--muted)}
.notice .hello{margin:0;font-size:1.05rem;font-weight:400;color:var(--ink)!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.amount{font-size:4.4rem;font-weight:600;line-height:1;margin:.9rem 0 .7rem;letter-spacing:-.03em}
.amount small{font-size:1.2rem;color:var(--muted);font-weight:500;margin-left:.5rem;letter-spacing:0}
.status{display:inline-flex;align-items:center;gap:.45rem;color:var(--test);font-weight:600}
.status::before{content:"";width:.55rem;height:.55rem;border-radius:50%;background:var(--test)}
.notice dl{margin:0;padding:.4rem 2.2rem 1.4rem}
.notice dl div{display:grid;grid-template-columns:11rem 1fr;gap:1rem;padding:.75rem 0;border-top:1px solid var(--line)}
.notice dl div:first-child{border-top:0}
.notice dt{color:var(--muted);font-size:.85rem;padding-top:.08rem}
.notice dd{margin:0;font-weight:500;overflow-wrap:anywhere}
.notice dd.mono{font-family:var(--mono);font-size:.8rem;font-weight:400;padding-top:.12rem}
.notice dd .dim{font-weight:400}
.notice footer{background:#F5F7FA;color:var(--muted);font-size:.72rem;padding:.9rem 2.2rem}
.rival{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-top:1.4rem;padding:1rem .2rem 0;border-top:1px solid var(--line);color:var(--muted)}
.rival b{color:var(--ink);font-weight:600}
.stmt-link{margin:1rem .2rem 0;font-size:.85rem;color:var(--muted)}
.stmt-link a{color:var(--ink);font-weight:500}
.notice .lines{margin:0;padding:.4rem 2.2rem 1rem;border-bottom:1px solid var(--line)}
.notice .lines div{display:flex;justify-content:space-between;gap:1rem;padding:.55rem 0;border-top:1px solid var(--line)}
.notice .lines div:first-child{border-top:0}
.notice .lines .total{font-weight:600}
.notice .lines .minus{color:var(--held-ink)}
.rival .amt{color:var(--ink);font-weight:600}

@media (min-width:1600px){html{font-size:21px}}
/* Laptop widths: each lane is too narrow for a label column beside the offer → seller row. */
@media (max-width:1500px){
  .step{grid-template-columns:1fr;gap:.25rem}
}
@media (max-width:1100px){
  html{font-size:17px}
  .nav,.stage{padding-left:24px;padding-right:24px}
  .lanes{grid-template-columns:1fr}
  .lane,.lane + .lane{padding:1.3rem 0 1.6rem;border-left:0}
  .lane + .lane{border-top:1px solid var(--line)}
  .request{font-size:2rem}
}
@media (max-width:640px){
  html{font-size:16px}
  .nav{gap:.2rem 1.1rem;flex-wrap:wrap}
  .nav .mark{flex-basis:100%}
  .lede{flex-direction:column;gap:.2rem}
  .request{font-size:1.65rem}
  .step{grid-template-columns:1fr;gap:.2rem}
  .hop{flex-direction:column;align-items:flex-start}
  .track{flex:none;width:2px;min-width:0;height:4.4rem;margin:.4rem 0 .4rem 1.2rem}
  .track::before{left:0;right:auto;top:0;bottom:8px;border-top:0;border-left:2px dashed var(--accent)}
  .track::after{right:auto;left:-6px;top:auto;bottom:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid var(--accent);border-bottom:0}
  .track .ticket{left:1.2rem;transform:translate(0,-50%)}
  .animate .track .ticket{animation:none}
  .verdict strong{font-size:2rem}
  .lane-head h2{font-size:1.45rem}
  .amount{font-size:3.2rem}
  .notice header,.notice .top,.notice dl,.notice footer{padding-left:1.3rem;padding-right:1.3rem}
  .notice dl div{grid-template-columns:1fr;gap:.15rem}
  .rival{flex-direction:column;gap:.2rem}
}
`;

type Opts = { live: boolean; clean: boolean };
type Here = "console" | "payout";

/*
 * Links are root-relative where they stay inside the console (the worker prefixes them with
 * /console) and "../" where they leave it, which resolves to the site root from both pages.
 */
function consoleHref(path: string): string {
  if (path === "/console") return "/";
  if (path.startsWith("/console/")) return path.slice("/console".length);
  return `..${path}`;
}

function nav(here: Here): string {
  return `<nav class="nav" aria-label="CITED"><a class="mark" href="../">CITED</a>${siteNavLinks(here, consoleHref)}</nav>`;
}

function page(title: string, here: Here, body: string, opts: Opts): string {
  const cls = [opts.clean ? "clean" : "", opts.live ? "" : "animate"].filter(Boolean).join(" ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.live ? '<meta http-equiv="refresh" content="2">' : ""}
<style>${CSS}${SITE_NAV_TOUCH_CSS}${SITE_THEME_CSS}${CONSOLE_DARK}</style></head><body class="${cls}">${nav(here)}${body}</body></html>`;
}

function waiting(msg: string): string {
  return `<div class="empty">${msg}</div>`;
}

// ───────────────────────── #28 ─────────────────────────

function ticket(sessionId: string, arm: string, mini = false): string {
  return `<span class="ticket${mini ? " mini" : ""}" aria-label="Agent Affiliate Passport ${esc(sessionId)}"><span class="stub">Passport</span><span class="body"><b>${esc(sessionId.slice(0, 12))}</b>${mini ? "" : `<span>arm: ${esc(arm)}</span>`}</span></span>`;
}

function laneTitle(kind: "exposed" | "held", creator: string | null): string {
  if (kind === "held") return "Held out";
  return creator ? `Shown ${esc(creator)}’s test` : "Shown the test";
}

function verdict(v: RunView, kind: "exposed" | "held"): string {
  const { journey } = v;
  if (!journey) {
    return `<div class="verdict"><span class="k">Verdict</span><strong>Not captured yet</strong><p class="dim">Waiting for PayPal to capture this order.</p></div>`;
  }
  const c = journey.commission;
  if (c.pending + c.paid > 0) {
    const how = c.paid > 0 ? "paid after the 30-day hold" : "held 30 days";
    return `<div class="verdict"><span class="k">Verdict</span><strong>Caused by the test</strong>
<p><span class="amt num">${usd(c.pending + c.paid)} commission</span> · ${how}</p></div>`;
  }
  if (c.voided > 0) {
    return `<div class="verdict"><span class="k">Verdict</span><strong>Voided</strong>
<p><span class="amt num">${usd(c.voided)}</span> commission voided by a refund or dispute</p></div>`;
  }
  return `<div class="verdict"><span class="k">Verdict</span><strong>Earns nothing</strong>
<p><span class="amt num">$0.00</span> · No commission: ${
    kind === "held" ? "this agent never saw the test" : "the test did not cause this sale"
  }</p></div>`;
}

function runColumn(v: RunView | null, kind: "exposed" | "held"): string {
  const cls = kind === "exposed" ? "lane" : "lane held";
  if (!v) {
    return `<section class="${cls}"><div class="lane-head"><h2>${laneTitle(kind, null)}</h2></div>${waiting("Waiting for this agent to buy.")}</section>`;
  }
  const { run, journey } = v;
  const creator = run.creatorsSeen[0] ? creatorName(run.creatorsSeen[0]) : null;
  const hops = run.storesViewed.length ? run.storesViewed : run.shop ? [run.shop] : [];
  const paidAt = journey?.storeChosen ?? run.shop;
  // The hop worth drawing: the seller whose offer carried the test, then the one the agent paid.
  const path = paidAt && !hops.includes(paidAt) ? [...hops, paidAt] : hops;
  const sawTest = run.creatorsSeen.length > 0;
  const armWord = run.arm === "test" ? "test" : run.arm === "none" ? "held out" : (run.arm ?? "?");

  const stores = path
    .map((s, i) => {
      const note =
        s === paidAt
          ? "Paid through PayPal"
          : sawTest && i === 0
            ? "Read the test on this offer"
            : "Offer read";
      return `<div class="store${s === paidAt ? " paid" : ""}">${esc(shopName(s))}<small>${esc(note)}</small></div>`;
    })
    .join(
      `<span class="track" role="img" aria-label="then">${run.sessionId ? ticket(run.sessionId, armWord, true) : ""}<span hidden>→</span></span>`,
    );

  const saved = journey?.priceSavedMinor;
  const other = path.find((s) => s !== paidAt);
  const catalogue =
    kind === "exposed"
      ? `<p>Reads ${creator ? `${esc(creator)}’s` : "the creator’s"} test of both purifiers.</p>`
      : `<p>Sees everything except the test.</p>`;
  const passport = run.sessionId
    ? ticket(run.sessionId, armWord)
    : `<p class="note">No passport recorded</p>`;

  const bought = run.product
    ? `<p class="product">${esc(run.product.name)}${
        run.totalMinor !== null ? `<span class="price num">${usd(run.totalMinor)}</span>` : ""
      }</p>`
    : `<p class="product dim">No purchase</p>`;
  const capture = journey
    ? `<p class="capture"><span class="pp">PayPal</span> captured <code>Order ${esc(journey.orderId)}</code><span class="dim via">The agent paid with the buyer’s saved PayPal${paidAt ? `, straight to ${esc(shopName(paidAt))}’s PayPal account` : ""}. No website, no redirect.</span>${
        run.passportAttached
          ? `<span class="dim via">Passport read from <code>custom_id</code> · sale joined to the ${kind === "exposed" ? "test" : "held-out"} arm</span>`
          : ""
      }</p>`
    : `<p class="note">${esc(run.orderId ?? "")} — waiting for the engine to record it</p>`;

  return `<section class="${cls}">
  <div class="lane-head"><h2>${laneTitle(kind, creator)}</h2><span class="model">${esc(agentLabel(run.model))}</span></div>
  <ol class="steps">
    <li class="step"><span class="k">Catalogue</span><div>${catalogue}${passport}</div></li>
    <li class="step"><span class="k">${path.length > 1 ? "Offer → seller" : "Seller"}</span><div><div class="hop">${stores}</div>${
      saved && saved > 0 && other
        ? `<p class="note good num">${esc(shopName(paidAt ?? ""))}’s offer was ${usd(saved)} under ${esc(shopName(other))}’s</p>`
        : ""
    }</div></li>
    <li class="step"><span class="k">Checkout</span><div>${bought}${capture}</div></li>
  </ol>
  ${verdict(v, kind)}
</section>`;
}

// ───────────────────────── the replay (apps/web/src/console-scene) ─────────────────────────

type SceneLane = {
  kind: "test" | "held";
  title: string;
  stores: { name: string; note: string; paid: boolean }[];
  catalogue: string;
  paypal: string;
  outcome: string;
  outcomeSub: string;
  credited: boolean;
  /** Narration, one line per stop: agent, catalogue, each store, PayPal, the verdict. */
  captions: string[];
};

function sceneLane(v: RunView, kind: "exposed" | "held"): SceneLane {
  const { run, journey } = v;
  const paidAt = journey?.storeChosen ?? run.shop;
  const hops = run.storesViewed.length ? run.storesViewed : run.shop ? [run.shop] : [];
  const sawTest = run.creatorsSeen.length > 0;
  // The test lane's story is the hop: the offer that carried the review, then the seller paid.
  const read = sawTest ? hops.find((s) => s !== paidAt) : undefined;
  const price = run.totalMinor !== null ? usd(run.totalMinor) : null;
  const product = run.product?.name ?? null;
  const bought = product ? `${product}${price ? ` · ${price}` : ""}` : "No purchase";
  const stores = [
    ...(read ? [{ name: shopName(read), note: "reads the review", paid: false }] : []),
    ...(paidAt ? [{ name: shopName(paidAt), note: bought, paid: true }] : []),
  ];
  const c = journey?.commission;
  const earned = c ? c.pending + c.paid : 0;
  const creator = run.creatorsSeen[0] ? creatorName(run.creatorsSeen[0]) : "the creator";
  const saved = journey?.priceSavedMinor;
  const paidName = paidAt ? shopName(paidAt) : "the seller";
  const buys = product ? `buys the ${product} at ${paidName}` : "buys nothing";

  const captions =
    kind === "held"
      ? [
          "An agent gets the request. This one is held out.",
          "The catalogue holds the creator’s review back. The agent sees only the offers.",
          `It ${buys}${price ? `, ${price}` : ""}.`,
          "It pays through PayPal. The passport in custom_id says: held out.",
          earned > 0
            ? `The engine credits it anyway: ${usd(earned)}.`
            : "The engine reads the passport. No review, nothing caused: $0.00.",
        ]
      : [
          "Same request, a second agent.",
          `This time the catalogue shows ${creator}’s review${product ? `, which picks the ${product}` : ""}.`,
          ...(read
            ? [
                `The agent reads the review on ${shopName(read)}’s offer…`,
                `…then ${buys}${saved && saved > 0 ? `, ${usd(saved)} cheaper` : ""}.`,
              ]
            : [`It ${buys}${price ? `, ${price}` : ""}.`]),
          "It pays through PayPal. The passport says: shown the review, even at another seller.",
          earned > 0
            ? `The review caused this sale, so ${creator} earns ${usd(earned)}, held 30 days.`
            : journey
              ? "The engine found no lift from the review: $0.00."
              : "PayPal hasn’t captured this order yet.",
        ];

  return {
    kind: kind === "exposed" ? "test" : "held",
    title: kind === "exposed" ? "Shown the review" : "Held out",
    stores,
    catalogue: "same offers, same ranking",
    paypal: "saved PayPal",
    outcome: earned > 0 ? creator : "No one paid",
    outcomeSub: !journey
      ? "not captured yet"
      : earned > 0
        ? `+${usd(earned)} · held 30 days`
        : kind === "held"
          ? "$0.00 · never saw the review"
          : "$0.00 · the test did not cause it",
    credited: earned > 0,
    captions,
  };
}

function scene(d: DemoData, live: boolean): string {
  if (!d.exposed || !d.heldOut) return "";
  const a = sceneLane(d.exposed, "exposed");
  const b = sceneLane(d.heldOut, "held");
  const creator = d.exposed.run.creatorsSeen[0]
    ? creatorName(d.exposed.run.creatorsSeen[0])
    : "the creator";
  const product = (r: RunView) => r.run.product?.name ?? "Nothing";
  const earned = (r: RunView) => {
    const c = r.journey?.commission;
    return c ? c.pending + c.paid : 0;
  };
  const chapters = ["Without the review", `Now, with ${creator}’s review`, "The difference"];
  const json = JSON.stringify({ lanes: [a, b], live, chapters }).replace(/</g, "\\u003c");
  const compare = `<div class="sc-compare" role="note">
<div class="cmp"><span class="k">Without the review</span><b>${esc(product(d.heldOut))}</b><span class="amt">${usd(earned(d.heldOut))} to creators</span></div>
<div class="cmp cmp-test"><span class="k">With ${esc(creator)}’s review</span><b>${esc(product(d.exposed))}</b><span class="amt">${earned(d.exposed) > 0 ? `+${usd(earned(d.exposed))} to ${esc(creator)}` : "$0.00"}</span></div>
<p>Same request, same offers, same ranking. The review is the only difference, so the review is what gets paid.</p>
</div>`;
  return `<section class="scene" aria-label="Replay of the A/B test in three chapters">
<div id="scene"><div class="sc-title" aria-hidden="true"></div><p class="sc-caption" aria-live="polite"></p>${compare}</div>
<div class="scene-bar"><ol class="scene-chs">${chapters
    .map(
      (h, i) =>
        `<li><button type="button" class="scene-ch"><span class="n num">${String(i + 1).padStart(2, "0")}</span><b>${esc(h)}</b><i aria-hidden="true"></i></button></li>`,
    )
    .join(
      "",
    )}</ol><button type="button" class="scene-play">Pause</button><button type="button" class="scene-replay">Replay</button></div>
</section>
<script type="application/json" id="scene-data">${json}</script>
<script type="module" src="/fx/console-scene.js"></script>`;
}

export function demoPage(d: DemoData, opts: Opts): string {
  const request = (d.exposed ?? d.heldOut)?.run.request;
  const body = `<main class="stage">
<div class="lede"><h1>One A/B test, two agents</h1><p>Same request, same offers, same ranking. First watch an agent shop without the creator’s review, then the same request with it.</p><p class="lede-note">These two are seeded replays. The effect was measured with live GPT, Gemini and Claude agents in a pre-registered eval: <a href="/proof">see the proof</a>.</p></div>
${request ? `<p class="request"><q>${esc(request)}</q></p>` : ""}
${scene(d, opts.live)}
${
  d.exposed || d.heldOut
    ? `<h2 class="receipts">The receipts</h2><div class="lanes">${runColumn(d.exposed, "exposed")}${runColumn(d.heldOut, "held")}</div>`
    : waiting(
        'No agent runs to show yet. <a href="../try">Run an agent yourself</a> and watch it shop.',
      )
}
${d.engineError ? `<p class="warn">${esc(d.engineError)}</p>` : ""}
</main>`;
  return page("CITED · two agents", "console", body, opts);
}

// ───────────────────────── #29 ─────────────────────────

function statusWord(s: string): string {
  return s === "SUCCESS" ? "Completed" : s === "PENDING" || s === "PROCESSING" ? "Pending" : s;
}

export function payoutPage(p: PayoutData | null, opts: Opts): string {
  if (!p) {
    return page(
      "CITED · payout",
      "payout",
      `<main class="pay"><h1 class="sr">Creator payout</h1>${waiting("No payout yet. Payouts are sent when a 30-day hold ends.")}</main>`,
      opts,
    );
  }
  const mismatch = p.ledgerPaidMinor !== null && p.ledgerPaidMinor !== p.amountMinor;
  const name = p.creatorName;
  // The demo clock jumps past the hold, so a calendar date would sit in the future: say when
  // the payout happened relative to the demo instead.
  const date = "After the 30-day hold";
  const body = `<main class="pay"><div class="mail">
<article class="notice">
<header><span class="pp">Pay<span>Pal</span></span><small>Payment received</small></header>
<div class="top">
  <h1 class="hello">${esc(name)}, you received a payment</h1>
  <div class="amount num">${usd(p.amountMinor)}<small>${esc(p.currency)}</small></div>
  <p>From CITED · commission on sales your test caused</p>
</div>
<dl>
  <div><dt>Status</dt><dd><span class="status">${esc(statusWord(p.status))}</span></dd></div>
  <div><dt>Sent to</dt><dd>${esc(name)} <span class="dim">· ${esc(p.receiver)}</span></dd></div>
  <div><dt>Date</dt><dd>${date}</dd></div>
  <div><dt>Payout batch ID</dt><dd class="mono">${esc(p.paypalBatchId ?? p.senderBatchId)}</dd></div>
  <div><dt>${p.itemIdKind === "payout_item_id" ? "Payout item ID" : "Item reference"}</dt><dd class="mono">${esc(p.itemId)}</dd></div>
</dl>
<footer>Sent with PayPal Payouts. A refund during the hold voids the credit; a dispute holds it until PayPal decides.</footer>
</article>
${
  p.rival
    ? `<div class="rival"><span><b>${esc(p.rival.name)}</b> · <span class="num">${p.rival.causedUnits}</span> extra units caused</span><span class="num amt">${usd(p.rival.paidMinor)} paid · no lift</span></div>`
    : ""
}
${
  p.statement && !opts.clean
    ? `<p class="stmt-link">${esc(p.statement.brandName)} paid for this from its deposit: <a href="/statement?brand=${encodeURIComponent(p.statement.brandId)}">Statement ${esc(p.statement.invoiceNumber)}</a> · PayPal Invoicing, ${esc(invoiceStatusWord(p.statement.status))}${p.statement.dueMinor === 0 ? ", $0 due" : ""}</p>`
    : ""
}
${mismatch ? `<p class="warn">Ledger shows ${usd(p.ledgerPaidMinor ?? 0)} paid, which differs from this payout.</p>` : ""}
</div></main>`;
  return page("CITED · payout", "payout", body, opts);
}

// ───────────────────────── brand statement ─────────────────────────

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function invoiceStatusWord(s: string): string {
  return s === "MARKED_AS_PAID"
    ? "marked paid"
    : s === "NO_CHARGE"
      ? "no charge"
      : s.toLowerCase().replace(/_/g, " ");
}

export function statementPage(d: StatementData | null, opts: Opts): string {
  if (!d) {
    return page(
      "CITED · statement",
      "payout",
      `<main class="pay"><h1 class="sr">Brand statement</h1>${waiting("No statement yet. Brands get one when a programme cycle closes.")}</main>`,
      opts,
    );
  }
  const s = d.statement;
  const mismatch =
    s.invoiceId !== null &&
    (s.invoiceTotalMinor !== s.paidMinor || s.creditedMinor - s.voidedMinor !== s.paidMinor);
  const row = (label: string, amount: string, cls = "") =>
    `<div${cls ? ` class="${cls}"` : ""}><span>${label}</span><span class="num">${amount}</span></div>`;
  const lines = [
    ...s.lines.map((l) =>
      row(
        `Commission credited: ${esc(l.name)} <span class="dim">· ${l.credits} credit${l.credits === 1 ? "" : "s"}</span>`,
        usd(l.creditedMinor),
      ),
    ),
    ...(s.voidedMinor
      ? [row("Voided by refunds or lost disputes", `−${usd(s.voidedMinor)}`, "minus")]
      : []),
    row("Paid to creators through PayPal Payouts", usd(s.paidMinor), "total"),
  ].join("");
  const body = `<main class="pay"><div class="mail">
<article class="notice">
<header><span class="pp">Pay<span>Pal</span></span><small>${s.invoiceId ? "Invoice · statement" : "Statement"}</small></header>
<div class="top">
  <h1 class="hello">${esc(d.brandName)} · CITED programme statement</h1>
  <div class="amount num">${usd(s.paidMinor)}<small>${esc(s.currency)}</small></div>
  <p>${s.invoiceId ? "Settled from your prepaid deposit · nothing due" : "Nothing paid this cycle, so no PayPal invoice"}</p>
</div>
<div class="lines">${lines}</div>
<dl>
  <div><dt>Status</dt><dd><span class="status">${esc(capitalize(invoiceStatusWord(s.status)))}</span>${s.invoiceDueMinor !== null ? ` <span class="dim">· ${usd(s.invoiceDueMinor)} due</span>` : ""}</dd></div>
  <div><dt>Invoice number</dt><dd class="mono">${esc(s.invoiceNumber)}</dd></div>
  ${s.invoiceId ? `<div><dt>PayPal invoice ID</dt><dd class="mono">${esc(s.invoiceId)}</dd></div>` : ""}
  <div><dt>Programme deposit</dt><dd class="num">${usd(s.depositedMinor)}</dd></div>
  <div><dt>Returned this cycle</dt><dd><span class="num">${usd(s.returnedMinor)}</span>${s.refundIds.length ? ` <span class="dim">· refund ${esc(s.refundIds.join(", "))}</span>` : ""}</dd></div>
  ${s.reservedMinor ? `<div><dt>Still in the hold</dt><dd class="num">${usd(s.reservedMinor)}</dd></div>` : ""}
  ${s.payoutBatchIds.length ? `<div><dt>Payout batch ID</dt><dd class="mono">${esc(s.payoutBatchIds.join(", "))}</dd></div>` : ""}
</dl>
<footer>Issued with PayPal Invoicing and marked paid against the deposit capture, so no money moves twice. You pay only for units your creators' tests caused.</footer>
</article>
${mismatch ? `<p class="warn">The PayPal invoice shows ${usd(s.invoiceTotalMinor ?? 0)}, which differs from the ${usd(s.paidMinor)} the ledger paid.</p>` : ""}
</div></main>`;
  return page("CITED · statement", "payout", body, opts);
}
