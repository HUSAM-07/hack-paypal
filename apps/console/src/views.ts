import {
  currencySymbol,
  SITE_HEAD_HTML,
  SITE_HEADER_CSS,
  SITE_THEME_CSS,
  siteHeader,
  TOUR_SCRIPT,
} from "@pact/protocol";
import type { DemoData, PayoutData, RunView, StatementData } from "./data";
import { creatorName, esc, money, shopName, usd } from "./format";
import { agentLabel } from "./runs";

/*
 * Page CSS only. Fonts, colour tokens and the layout primitives (.ui-frame-wide, .ui-band,
 * .ui-label, ...) come from SITE_THEME_CSS; this file reads semantic tokens and defines no colour.
 * CITED roles: the test / caused / paid = --primary; held-out (nothing) arm = --subtle;
 * voids = --destructive; warnings = --warning; PayPal's own name = --paypal.
 */
const CSS = `
*{box-sizing:border-box}
body{font-size:16px;line-height:1.6}
h1,h2,h3,p{margin:0}
a{color:inherit}
.num{font-variant-numeric:tabular-nums lining-nums}
.dim{color:var(--muted-foreground)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

/* hero: mono kicker, serif display headline, muted lede */
.hero{padding:40px var(--pad) 32px}
.clean .hero{padding-top:56px}
.kicker{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.kicker::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--primary)}
.display{max-width:22ch;font:400 clamp(34px,4.6vw,54px)/1.06 var(--font-serif);letter-spacing:-.02em;text-wrap:balance}
.display .num{color:var(--primary)}
.lede{margin-top:14px;max-width:64ch;font-size:15px;line-height:1.65;color:var(--muted-foreground)}
.lede-note{margin-top:8px;max-width:64ch;font-size:13.5px;line-height:1.6;color:var(--muted-foreground)}
.lede-note a,.empty a{color:var(--foreground);text-underline-offset:3px;text-decoration-color:var(--subtle)}
.lede-note a:hover,.empty a:hover{text-decoration-color:currentColor}
.empty{padding:24px 0;max-width:52ch;font-size:17px;color:var(--muted-foreground)}
.pay>.empty{padding:40px var(--pad)}
.empty code{font-family:var(--font-mono);font-size:.8em}
.warn{margin:16px 0 0;font-size:14px;color:var(--warning)}

/* the film: two agent transcripts in dashed cards, rows aligned like a diff */
.film-grid{display:grid;grid-template-columns:minmax(0,1fr) 48px minmax(0,1fr)}
.fa,.fb{min-width:0;padding:14px 18px;background:var(--card);border-inline:1px dashed var(--border);transition:background-color .4s,opacity .4s,box-shadow .4s}
.fh{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;padding:14px 18px 12px;background:var(--band);border-top:1px dashed var(--border);border-radius:6px 6px 0 0}
.fh h3{display:flex;align-items:center;gap:10px;font:400 24px/1.15 var(--font-serif);letter-spacing:-.01em}
.fh h3::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--subtle)}
.fb.fh h3::before{background:var(--primary)}
.model{font:400 11px/1.3 var(--font-mono);color:var(--muted-foreground)}
.fl{border-bottom:1px dashed var(--border);border-radius:0 0 6px 6px}
.row{border-top:1px dashed var(--border)}
.k{display:block;margin-bottom:6px;font:500 11px/1 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.v{font-size:15px;line-height:1.5;color:var(--foreground)}
.v b{font-weight:600}
.v small{display:block;margin-top:2px;font-size:13px;color:var(--muted-foreground)}
.chip{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:2px 9px 1px;border-radius:3px;font:italic 400 16px/1.3 var(--font-serif);background:var(--band);box-shadow:inset 0 0 0 1px var(--border)}
.chip.yes{color:var(--primary);background:var(--primary-soft);box-shadow:none}
.chip.no{color:var(--muted-foreground);text-decoration:line-through;text-decoration-thickness:1px}
.q{font:400 19px/1.3 var(--font-serif)}
.verdict-row .v{display:flex;align-items:center;gap:12px}
.amount-big{font:500 28px/1.1 var(--font-mono);letter-spacing:-.03em}
.fb .amount-big{color:var(--primary)}
.fa .amount-big{color:var(--muted-foreground)}
.tick{flex:none;width:40px;height:40px}
.tick circle,.tick path{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:var(--primary)}
.tick circle{stroke-dasharray:120;stroke-dashoffset:0}
.tick path{stroke-dasharray:30;stroke-dashoffset:0}
.fa .tick circle,.fa .tick path{stroke:var(--subtle)}
.eq{position:relative;display:grid;place-items:center;font:500 14px/1 var(--font-mono);color:var(--muted-foreground)}
.eq.ne{color:var(--primary)}
.eq span{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--background);border:1px dashed var(--border)}
.eq.ne span{border:1px solid var(--primary);box-shadow:0 0 0 4px var(--primary-soft)}
.film-sum{margin:28px auto 0;max-width:760px;text-align:center;font:400 24px/1.3 var(--font-serif);letter-spacing:-.01em;text-wrap:balance}
.film-sum em{color:var(--primary)}
.dots{display:none;gap:4px;align-items:center;height:20px}
.dots i{width:6px;height:6px;border-radius:50%;background:var(--muted-foreground);animation:blink 1s infinite}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
/* Player: rows wait, type, land. Without the script everything is simply shown. */
.film-on .fa.row,.film-on .fb.row{opacity:.18}
.film-on .fa.row > *,.film-on .fb.row > *{visibility:hidden}
.film-on .row.typing{opacity:1}
.film-on .row.typing .dots{display:flex;visibility:visible}
.film-on .row.shown{opacity:1}
.film-on .row.shown > *{visibility:visible;animation:land .35s ease-out}
.film-on .row.shown .dots{display:none}
@keyframes land{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.film-on .verdict-row.shown .tick circle{animation:draw .7s ease-out both}
.film-on .verdict-row.shown .tick path{animation:draw2 .4s .55s ease-out both}
@keyframes draw{from{stroke-dashoffset:120}}
@keyframes draw2{from{stroke-dashoffset:30}}
.film-on .eq span{opacity:0;transform:scale(.6);transition:opacity .3s,transform .3s}
.film-on .eq.shown span{opacity:1;transform:none}
.film-on .film-sum{opacity:0;transition:opacity .5s}
.film-on .film-sum.shown{opacity:1}
.film-on .fa.playing{box-shadow:inset 2px 0 0 var(--muted-foreground)}
.film-on .fb.playing{box-shadow:inset 2px 0 0 var(--primary)}
.diff .fb.row.changed{background:linear-gradient(90deg,var(--primary-soft),var(--card))}
.diff .fa.row.changed{background:linear-gradient(90deg,var(--fill),var(--card))}
.film-bar{display:none;align-items:stretch;margin-top:24px;border:1px dashed var(--border);border-radius:6px;overflow:hidden}
.film-on .film-bar{display:flex}
.film-chs{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));flex:1}
.film-chs li{border-right:1px dashed var(--border)}
.film-ch{all:unset;box-sizing:border-box;position:relative;display:flex;align-items:baseline;gap:10px;width:100%;height:100%;min-height:44px;padding:12px 16px;cursor:pointer;color:var(--muted-foreground);transition:color .2s,background-color .2s}
.film-ch:hover{background:var(--hover);color:var(--foreground)}
.film-ch i{position:absolute;left:0;right:0;top:0;height:2px;background:var(--primary);transform:scaleX(var(--p,0));transform-origin:left}
.film-ch[aria-current="step"]{color:var(--foreground);background:var(--band)}
.film-ch .n{font:500 11px/1 var(--font-mono);letter-spacing:.06em;color:var(--primary)}
.film-ch b{font:500 14px/1.3 var(--font-sans)}
.film-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;cursor:pointer;font:500 11px/1 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--foreground);border-right:1px dashed var(--border);transition:background-color .2s}
.film-btn:last-child{border-right:0}
.film-btn:hover{background:var(--hover)}
.film-ch:focus-visible,.film-btn:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}

/* one run only: the two lanes as dashed cards */
.lanes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.lane{--accent:var(--primary);--accent-ink:var(--primary);--tint:var(--primary-soft);display:flex;flex-direction:column;min-width:0;padding:20px 20px 0;overflow:hidden}
.lane.held{--accent:var(--subtle);--accent-ink:var(--muted-foreground);--tint:var(--fill)}
.lane-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;margin-bottom:20px}
.lane-head h2{font:400 28px/1.15 var(--font-serif);letter-spacing:-.01em}
.lane-head h2::before{content:"";display:inline-block;width:8px;height:8px;margin-right:10px;border-radius:50%;background:var(--accent);vertical-align:.2em}
.steps{position:relative;list-style:none;margin:0;padding:0}
.steps::before{content:"";position:absolute;left:5px;top:9px;bottom:12px;border-left:2px dashed var(--accent)}
.step{position:relative;display:grid;grid-template-columns:minmax(0,1fr);gap:4px;padding:0 0 24px 28px}
.step::before{content:"";position:absolute;left:0;top:6px;width:12px;height:12px;border-radius:50%;background:var(--card);border:2px solid var(--accent)}
.step .k{margin:0;padding-top:4px}
.step > *{min-width:0}
.note{margin-top:6px;font-size:13.5px;color:var(--muted-foreground)}
.note.good{color:var(--primary);font-weight:500}
/* the passport ticket */
.ticket{position:relative;display:inline-flex;align-items:stretch;margin-top:8px;white-space:nowrap;background:var(--card);border-radius:6px;box-shadow:inset 0 0 0 1px var(--accent-ink);font-size:12px;line-height:1.25;overflow:hidden}
.ticket .stub{display:flex;align-items:center;padding:6px 9px;background:var(--accent-ink);color:var(--background);font:500 10.5px/1 var(--font-mono);letter-spacing:.06em;text-transform:uppercase}
.ticket .body{padding:5px 11px 5px 10px;border-left:1px dashed var(--accent-ink)}
.ticket .body b{display:block;font:500 12.5px/1.3 var(--font-mono)}
.ticket .body span{color:var(--muted-foreground)}
.ticket.mini{margin:0;font-size:11px}
.ticket.mini .stub{padding:4px 7px;font-size:9.5px}
.ticket.mini .body{padding:3px 8px}
.ticket.mini .body b{font-size:11px}
/* offer -> seller */
.hop{display:flex;align-items:center;flex-wrap:nowrap}
.store{padding:2px 0;font:400 24px/1.1 var(--font-serif)}
.store small{display:block;margin-top:4px;font:500 10.5px/1.2 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.store.paid small{color:var(--accent-ink)}
.track{position:relative;flex:1 1 220px;min-width:170px;max-width:220px;height:52px;margin:0 14px}
.track::before{content:"";position:absolute;left:0;right:8px;top:50%;border-top:2px dashed var(--accent)}
.track::after{content:"";position:absolute;right:0;top:calc(50% - 6px);border-left:10px solid var(--accent);border-top:7px solid transparent;border-bottom:7px solid transparent}
.track .ticket{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
@media (prefers-reduced-motion:no-preference){
  .animate .track .ticket{animation:travel 1.6s cubic-bezier(.45,0,.2,1) .5s both}
}
@keyframes travel{from{left:0;transform:translate(0,-50%)}to{left:50%;transform:translate(-50%,-50%)}}
.product{font:400 24px/1.15 var(--font-serif)}
.product .price{margin-left:8px;font:500 14px/1 var(--font-mono);color:var(--muted-foreground)}
.capture{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;font-size:14px}
.capture .via{flex-basis:100%;font-size:13px}
.capture .pp{font-weight:700;font-style:italic;letter-spacing:-.01em;color:var(--paypal)}
/* verdict */
.verdict{margin:auto -20px 0;padding:16px 20px 18px;background:var(--tint);border-top:2px solid var(--accent)}
.verdict .k{color:var(--accent-ink)}
.verdict strong{display:block;margin:4px 0 6px;font:400 34px/1.08 var(--font-serif);letter-spacing:-.015em}
.verdict p{font-size:15px}
.verdict .amt{font-family:var(--font-mono);font-weight:500;color:var(--accent-ink)}
.lane.held .verdict strong{color:var(--foreground)}

/* ledger rows: mono index, label, right-aligned mono figure */
.ledger{list-style:none;margin:0;padding:0}
.ledger>li{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:baseline;gap:12px;padding:11px 0;border-bottom:1px dashed var(--border);font-size:14px}
.ledger>li:first-child{border-top:1px dashed var(--border)}
.l-no{font:400 11.5px/1 var(--font-mono);letter-spacing:.06em;color:var(--subtle)}
.l-label{min-width:0;color:var(--foreground)}
.l-label b{font-weight:600}
.l-value{font:500 13.5px/1.4 var(--font-mono);font-variant-numeric:tabular-nums;text-align:right}
.l-muted .l-value{color:var(--muted-foreground)}
.l-void .l-label{color:var(--muted-foreground)}
.l-void .l-value{color:var(--destructive)}
.l-total{background:var(--primary-soft)}
.l-total>.l-no{padding-left:6px}
.l-total .l-label,.l-total .l-value{color:var(--primary);font-weight:600}
.l-total .l-value{padding-right:6px;font-size:15px}
.l-link{display:inline-flex;align-items:center;gap:4px;margin-top:4px;font-weight:500;color:var(--foreground);text-decoration:none}
.l-link:hover{text-decoration:underline;text-underline-offset:3px}
.arrow{font-size:12px;color:var(--muted-foreground)}

/* payout: the ledger beside PayPal's notice, on a dotted figure */
.pay-band{padding-bottom:0}
.pay-band .ui-band-h{margin-bottom:0}
.pay-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.pay-cell{min-width:0;padding:24px var(--pad) 32px}
.pay-fig{display:flex;align-items:center;justify-content:center;padding:40px var(--pad);border-left:1px dashed var(--border)}
.pay-cell .caption{margin-top:12px;font-size:12.5px;line-height:1.55;color:var(--muted-foreground)}
.mail{width:100%;max-width:540px;margin:0}
.notice{overflow:hidden;background:var(--card);color:var(--card-foreground);border-radius:12px;box-shadow:var(--shadow-pop)}
.notice header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 24px;border-bottom:1px solid var(--border)}
.notice header .pp{font:italic 800 21px/1 var(--font-sans);letter-spacing:-.02em;color:var(--paypal)}
.notice header .pp span{color:color-mix(in oklab,var(--paypal) 35%,var(--primary))}
.notice header small{font-size:12px;line-height:1.3;text-align:right;color:var(--muted-foreground)}
.notice .top{padding:24px 24px 20px;border-bottom:1px solid var(--border)}
.notice .top p{font-size:13.5px;color:var(--muted-foreground)}
.notice .hello{font:400 15px/1.4 var(--font-sans);color:var(--foreground)}
.notice .top p.hello{color:var(--foreground)}
.amount{margin:12px 0 10px;font:600 52px/1 var(--font-sans);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.amount small{margin-left:8px;font:500 14px/1 var(--font-mono);letter-spacing:.04em;color:var(--muted-foreground)}
.status{display:inline-flex;align-items:center;gap:7px;padding:2px 10px;border-radius:999px;background:var(--primary-soft);color:var(--primary);font-size:13px;font-weight:600}
.status::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--primary)}
.notice dl{margin:0;padding:4px 24px 14px}
.notice dl div{display:grid;grid-template-columns:136px minmax(0,1fr);gap:12px;padding:10px 0;border-top:1px dashed var(--border)}
.notice dl div:first-child{border-top:0}
.notice dt{padding-top:3px;font:500 11px/1.5 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.notice dd{margin:0;font-size:14px;font-weight:500;overflow-wrap:anywhere}
.notice dd.mono{padding-top:1px;font:400 13px/1.5 var(--font-mono)}
.notice dd .dim{font-weight:400}
.notice .ledger{padding:6px 24px 14px;border-bottom:1px solid var(--border)}
.notice .ledger>li:first-child{border-top:0}
.notice .ledger>li:last-child{border-bottom:0}
.notice footer{padding:12px 24px;background:var(--band);border-top:1px solid var(--border);font-size:12px;line-height:1.5;color:var(--muted-foreground)}
.pay-cap{margin:14px 0 0;text-align:center;font-size:12.5px;line-height:1.55;color:var(--muted-foreground)}
.pay-cap a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.pay-cap .mono{font-family:var(--font-mono)}
/* statement: the notice alone, centred on the dotted figure */
.stmt{display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px var(--pad) 56px;border-top:1px dashed var(--border)}
.stmt .mail{max-width:640px}

@media (max-width:960px){
  .pay-grid,.lanes{grid-template-columns:minmax(0,1fr)}
  .pay-fig{border-left:0;border-top:1px dashed var(--border)}
}
@media (max-width:760px){
  .film-grid{grid-template-columns:minmax(0,1fr)}
  .film-grid > *{order:var(--o)}
  .eq{display:none}
  .fb.fh{margin-top:24px}
  .film-bar{flex-wrap:wrap}
  .film-chs{grid-template-columns:minmax(0,1fr);flex-basis:100%}
  .film-chs li{border-right:0;border-bottom:1px dashed var(--border)}
  .film-btn{flex:1;padding:12px 16px}
  .film-sum{font-size:20px}
}
@media (max-width:640px){
  .hero{padding:28px var(--pad) 24px}
  .display{font-size:34px}
  .hop{flex-direction:column;align-items:flex-start}
  .track{flex:none;width:2px;min-width:0;height:70px;margin:6px 0 6px 20px}
  .track::before{left:0;right:auto;top:0;bottom:8px;border-top:0;border-left:2px dashed var(--accent)}
  .track::after{right:auto;left:-6px;top:auto;bottom:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid var(--accent);border-bottom:0}
  .track .ticket{left:20px;transform:translate(0,-50%)}
  .animate .track .ticket{animation:none}
  .verdict strong{font-size:28px}
  .lane-head h2{font-size:24px}
  .amount{font-size:40px}
  .pay-fig,.stmt{padding:24px 12px}
  .notice header,.notice .top,.notice dl,.notice footer,.notice .ledger{padding-left:16px;padding-right:16px}
  .notice dl div{grid-template-columns:minmax(0,1fr);gap:2px}
  .ledger>li{grid-template-columns:24px minmax(0,1fr) auto;gap:10px}
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
  return siteHeader(here, consoleHref);
}

function page(title: string, here: Here, body: string, opts: Opts): string {
  const cls = [opts.clean ? "clean" : "", opts.live ? "" : "animate"].filter(Boolean).join(" ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.live ? '<meta http-equiv="refresh" content="2">' : ""}
${SITE_HEAD_HTML}
<style>${SITE_THEME_CSS}${CSS}${SITE_HEADER_CSS}</style></head><body class="${cls}">${nav(here)}${body}${TOUR_SCRIPT}</body></html>`;
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
  return creator ? `Shown ${esc(creator)}'s test` : "Shown the test";
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
  const cls = kind === "exposed" ? "lane ui-card" : "lane ui-card held";
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
      ? `<p>Reads ${creator ? `${esc(creator)}'s` : "the creator's"} test of both purifiers.</p>`
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
    ? `<p class="capture"><span class="pp">PayPal</span> captured <code>Order ${esc(journey.orderId)}</code><span class="dim via">The agent paid with the buyer's saved PayPal${paidAt ? `, straight to ${esc(shopName(paidAt))}'s PayPal account` : ""}. No website, no redirect.</span>${
        run.passportAttached
          ? `<span class="dim via">Passport read from <code>custom_id</code> · sale joined to the ${kind === "exposed" ? "test" : "held-out"} group</span>`
          : ""
      }</p>`
    : `<p class="note">Order ${esc(run.orderId ?? "")} is waiting for the engine to record it.</p>`;

  return `<section class="${cls}">
  <div class="lane-head"><h2>${laneTitle(kind, creator)}</h2><span class="model">${esc(agentLabel(run.model))}</span></div>
  <ol class="steps">
    <li class="step"><span class="k">Catalogue</span><div>${catalogue}${passport}</div></li>
    <li class="step"><span class="k">${path.length > 1 ? "Offer → seller" : "Seller"}</span><div><div class="hop">${stores}</div>${
      saved && saved > 0 && other
        ? `<p class="note good num">${esc(shopName(paidAt ?? ""))}'s offer was ${usd(saved)} under ${esc(shopName(other))}'s</p>`
        : ""
    }</div></li>
    <li class="step"><span class="k">Checkout</span><div>${bought}${capture}</div></li>
  </ol>
  ${verdict(v, kind)}
</section>`;
}

// ───────────────────────── the film (apps/web/src/console-scene plays it) ─────────────────────────

type Cell = { k: string; v: string };

function filmCells(v: RunView, kind: "exposed" | "held", creator: string): Cell[] {
  const { run, journey } = v;
  const paidAt = journey?.storeChosen ?? run.shop;
  const hops = run.storesViewed.length ? run.storesViewed : run.shop ? [run.shop] : [];
  const read = kind === "exposed" ? hops.find((s) => s !== paidAt) : undefined;
  const saved = journey?.priceSavedMinor;
  const c = journey?.commission;
  const earned = c ? c.pending + c.paid : 0;
  const product = run.product?.name ?? "Nothing";
  const price = run.totalMinor !== null ? usd(run.totalMinor) : "";
  const tick = `<svg class="tick" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18"/><path d="${earned > 0 ? "M14 22.5l5.5 5.5L30.5 17" : "M15 22h14"}"/></svg>`;
  return [
    { k: "Request", v: `<span class="q">"${esc(run.request)}"</span>` },
    {
      k: "Catalogue",
      v: `Same offers, same ranking<br>${
        kind === "exposed"
          ? `<span class="chip yes">+ ${esc(creator)}'s review shown</span>`
          : `<span class="chip no">${esc(creator)}'s review</span> <span class="dim">withheld</span>`
      }`,
    },
    {
      k: "Reads",
      v: read
        ? `${esc(creator)}'s review, on ${esc(shopName(read))}'s offer<small>Winix A230 vs Levoit Core 300</small>`
        : `<span class="dim">No review to read</span>`,
    },
    {
      k: "Buys",
      v: `<b>${esc(product)}</b> at ${esc(paidAt ? shopName(paidAt) : "?")}${price ? ` · ${price}` : ""}${
        read && saved && saved > 0
          ? `<small>${usd(saved)} under ${esc(shopName(read))}'s offer</small>`
          : ""
      }`,
    },
    {
      k: "PayPal",
      v: `Paid ${esc(paidAt ? shopName(paidAt) : "the seller")} from the buyer's saved PayPal<small>passport in <code>custom_id</code>: ${kind === "exposed" ? "shown the review" : "held out"}${journey ? ` · order ${esc(journey.orderId)}` : ""}</small>`,
    },
    {
      k: "CITED engine",
      v: `${tick}<span><span class="amount-big num">${earned > 0 ? `+${usd(earned)}` : "$0.00"}</span><small>${
        earned > 0
          ? `to ${esc(creator)} · caused by the review · held 30 days`
          : journey
            ? "to creators · nothing the review caused"
            : "not captured yet"
      }</small></span>`,
    },
  ];
}

/* Which rows differ between the two agents; the catalogue row is the one thing we changed. */
const SAME = [true, false, false, false, true, false];

function film(d: DemoData): string {
  if (!d.exposed || !d.heldOut) return "";
  const creator = d.exposed.run.creatorsSeen[0]
    ? creatorName(d.exposed.run.creatorsSeen[0])
    : "the creator";
  const a = filmCells(d.heldOut, "held", creator);
  const b = filmCells(d.exposed, "exposed", creator);
  const n = a.length;
  const head = (side: "fa" | "fb", title: string, model: string, o: number) =>
    `<div class="${side} fh" style="--o:${o}"><h3>${title}</h3><span class="model">${esc(model)}</span></div>`;
  const cell = (side: "fa" | "fb", c: Cell, i: number, o: number) =>
    `<div class="${side} row${i === n - 1 ? " fl verdict-row" : ""}${SAME[i] ? "" : " changed"}" data-row="${i}" style="--o:${o}"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="k">${c.k}</span><div class="v">${c.v}</div></div>`;
  let rows = `${head("fa", "Without the review", agentLabel(d.heldOut.run.model), 0)}<div class="eq" aria-hidden="true"></div>${head("fb", `With ${esc(creator)}'s review`, agentLabel(d.exposed.run.model), 100)}`;
  for (let i = 0; i < n; i++) {
    rows += `${cell("fa", a[i] as Cell, i, i + 1)}<div class="eq${SAME[i] ? "" : " ne"}" data-row="${i}" aria-label="${SAME[i] ? "same" : "different"}"><span>${SAME[i] ? "=" : "≠"}</span></div>${cell("fb", b[i] as Cell, i, 101 + i)}`;
  }
  const chapters = ["Without the review", `With ${esc(creator)}'s review`, "Spot the difference"];
  return `<section class="film" aria-label="Two agents, one request: without and with the creator's review">
<div class="film-grid">${rows}</div>
<p class="film-sum">Same request, same offers, same checkout. Only the review changed, and the purchase changed with it. <em>That difference is what ${esc(creator)} is paid for.</em></p>
<div class="film-bar"><ol class="film-chs">${chapters
    .map(
      (h, i) =>
        `<li><button type="button" class="film-ch"><span class="n num">${String(i + 1).padStart(2, "0")}</span><b>${h}</b><i aria-hidden="true"></i></button></li>`,
    )
    .join(
      "",
    )}</ol><button type="button" class="film-btn film-play">Pause</button><button type="button" class="film-btn film-replay">Replay</button></div>
</section>
<script type="module" src="/fx/console-scene.js"></script>`;
}

export function demoPage(d: DemoData, opts: Opts): string {
  const body = `<main id="main" class="ui-frame-wide stage">
<div class="hero"><p class="ui-label kicker">Console · seeded replay</p><h1 class="display">One A/B test, two agents</h1><p class="lede">Same request, same offers, same ranking. Watch an agent shop without the creator's review, then the same request with it, then compare.</p><p class="lede-note">These two are seeded replays. The effect was measured with live GPT, Gemini and Claude agents in a pre-registered eval: <a href="../proof">see the proof</a>.</p></div>
<section class="ui-band" aria-labelledby="film-h"><h2 id="film-h" class="ui-band-h">Same request, two agents</h2><div class="ui-band-body">
${
  d.exposed && d.heldOut
    ? film(d)
    : d.exposed || d.heldOut
      ? `<div class="lanes">${runColumn(d.exposed, "exposed")}${runColumn(d.heldOut, "held")}</div>`
      : waiting(
          'No agent runs to show yet. <a href="../try">Run an agent yourself</a> and watch it shop.',
        )
}
${d.engineError ? `<p class="warn">${esc(d.engineError)}</p>` : ""}
</div></section>
</main>`;
  return page("CITED · two agents", "console", body, opts);
}

// ───────────────────────── #29 ─────────────────────────

function statusWord(s: string): string {
  return s === "SUCCESS" ? "Completed" : s === "PENDING" || s === "PROCESSING" ? "Pending" : s;
}

/** One ledger row: mono index, label, right-aligned mono figure. */
function ledgerRow(i: number, label: string, value: string, cls = ""): string {
  return `<li${cls ? ` class="${cls}"` : ""}><span class="l-no">${String(i).padStart(2, "0")}</span><span class="l-label">${label}</span><span class="l-value num">${value}</span></li>`;
}

export function payoutPage(p: PayoutData | null, opts: Opts): string {
  if (!p) {
    return page(
      "CITED · payout",
      "payout",
      `<main id="main" class="ui-frame-wide pay"><h1 class="sr">Creator payout</h1>${waiting("No payout yet. Payouts are sent when a 30-day hold ends.")}</main>`,
      opts,
    );
  }
  const mismatch = p.ledgerPaidMinor !== null && p.ledgerPaidMinor !== p.amountMinor;
  const name = p.creatorName;
  const cur = p.currency;
  const venmo = p.wallet === "VENMO";
  // The demo clock jumps past the hold, so a calendar date would sit in the future: say when
  // the payout happened relative to the demo instead.
  const date = "After the 30-day hold";
  const rows: string[] = [
    ledgerRow(
      1,
      `${esc(name)} · paid through PayPal Payouts${venmo ? ", to Venmo" : ""}`,
      money(p.amountMinor, cur),
      "l-total",
    ),
  ];
  if (p.rival) {
    rows.push(
      ledgerRow(
        rows.length + 1,
        `<b>${esc(p.rival.name)}</b> · <span class="num">${p.rival.causedUnits}</span> extra units caused`,
        `${money(p.rival.paidMinor, cur)} paid · no lift`,
        "l-muted",
      ),
    );
  }
  if (p.statement && !opts.clean) {
    rows.push(
      ledgerRow(
        rows.length + 1,
        `${esc(p.statement.brandName)} paid for it from its deposit: ${esc(invoiceStatusWord(p.statement.status))}${p.statement.dueMinor === 0 ? `, ${currencySymbol(cur)}0 due` : ""}<br><a class="l-link" href="/statement?brand=${encodeURIComponent(p.statement.brandId)}">Statement ${esc(p.statement.invoiceNumber)} <span class="arrow" aria-hidden="true">↗</span></a>`,
        "",
      ),
    );
  }
  const body = `<main id="main" class="ui-frame-wide pay">
<div class="hero">
  <p class="ui-label kicker">Day 30 · creator payout</p>
  <h1 class="display">${esc(name)} got paid <span class="num">${money(p.amountMinor, cur)}</span> through PayPal Payouts${venmo ? ", to Venmo" : ""}.</h1>
  <p class="lede">Commission on the sales its test caused, paid once the 30-day hold ended. AI shopping agents read the test and bought; nobody clicked a link.</p>
</div>
<section class="ui-band pay-band" aria-labelledby="pay-h"><h2 id="pay-h" class="ui-band-h">The payout</h2>
<div class="pay-grid">
<div class="pay-cell">
  <ol class="ledger">${rows.join("")}</ol>
${mismatch ? `  <p class="warn">Ledger shows ${money(p.ledgerPaidMinor ?? 0, cur)} paid, which differs from this payout.</p>` : ""}
</div>
<div class="pay-fig ui-dots">
<figure class="mail">
<article class="notice" aria-label="PayPal payment notice">
<header><span class="pp">Pay<span>Pal</span></span><small>Payment received${venmo ? " · paid to Venmo" : ""}</small></header>
<div class="top">
  <p class="hello">${esc(name)}, you received a payment</p>
  <div class="amount num">${money(p.amountMinor, cur)}<small>${esc(p.currency)}</small></div>
  <p>From CITED · commission on sales your test caused</p>
</div>
<dl>
  <div><dt>Status</dt><dd><span class="status">${esc(statusWord(p.status))}</span></dd></div>
  <div><dt>Sent to</dt><dd>${esc(name)} <span class="dim">· ${esc(p.receiver)}</span></dd></div>
  <div><dt>Date</dt><dd>${date}</dd></div>
  <div><dt>Payout batch ID</dt><dd class="mono">${esc(p.paypalBatchId ?? p.senderBatchId)}</dd></div>
  <div><dt>${p.itemIdKind === "payout_item_id" ? "Payout item ID" : "Item reference"}</dt><dd class="mono">${esc(p.itemId)}</dd></div>
</dl>
<footer>Sent with PayPal Payouts${venmo ? " to Venmo" : ""}. A refund during the hold voids the credit; a dispute holds it until PayPal decides.</footer>
</article>
<figcaption class="pay-cap">The notice ${esc(name)} receives from PayPal. Simulated PayPal on this demo.${p.amountMinor === 38396 && cur === "USD" ? ` The same $383.96 payout also ran on the real PayPal sandbox: <a href="https://github.com/HUSAM-07/hack-paypal/blob/main/cited/SANDBOX-EVIDENCE.md">batch <span class="mono">ME2KV57B7KYNS</span>, SUCCESS</a>.` : ""}</figcaption>
</figure>
</div>
</div>
</section>
</main>`;
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
      `<main id="main" class="ui-frame-wide pay"><h1 class="sr">Brand statement</h1>${waiting("No statement yet. Brands get one when a programme cycle closes.")}</main>`,
      opts,
    );
  }
  const s = d.statement;
  const usd = (minor: number) => money(minor, s.currency);
  const mismatch =
    s.invoiceId !== null &&
    (s.invoiceTotalMinor !== s.paidMinor || s.creditedMinor - s.voidedMinor !== s.paidMinor);
  const entries: [label: string, amount: string, cls?: string][] = [
    ...s.lines.map((l): [string, string] => [
      `Commission credited: ${esc(l.name)} <span class="dim">· ${l.credits} credit${l.credits === 1 ? "" : "s"}</span>`,
      usd(l.creditedMinor),
    ]),
    ...(s.voidedMinor
      ? [
          ["Voided by refunds or lost disputes", `−${usd(s.voidedMinor)}`, "l-void"] as [
            string,
            string,
            string,
          ],
        ]
      : []),
    ["Paid to creators through PayPal Payouts", usd(s.paidMinor), "l-total"],
  ];
  const lines = entries
    .map(([label, amount, cls], i) => ledgerRow(i + 1, label, amount, cls))
    .join("");
  const body = `<main id="main" class="ui-frame-wide pay">
<div class="hero"><p class="ui-label kicker">Brand statement · PayPal Invoicing</p></div>
<div class="stmt ui-dots"><div class="mail">
<article class="notice">
<header><span class="pp">Pay<span>Pal</span></span><small>${s.invoiceId ? "Invoice · statement" : "Statement"}</small></header>
<div class="top">
  <h1 class="hello">${esc(d.brandName)} · CITED programme statement</h1>
  <div class="amount num">${usd(s.paidMinor)}<small>${esc(s.currency)}</small></div>
  <p>${s.invoiceId ? "Settled from your prepaid deposit · nothing due" : "Nothing paid this cycle, so no PayPal invoice"}</p>
</div>
<ol class="ledger">${lines}</ol>
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
</div></div></main>`;
  return page("CITED · statement", "payout", body, opts);
}
