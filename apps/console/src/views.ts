import { SITE_HEADER_CSS, SITE_NAV_TOUCH_CSS, SITE_THEME_CSS, siteHeader } from "@pact/protocol";
import type { DemoData, PayoutData, RunView, StatementData } from "./data";
import { creatorName, esc, shopName, usd } from "./format";
import { agentLabel } from "./runs";

/*
 * Fonts come from the worker's own static assets (/fonts/*), so the demo-page CSP
 * (font-src falls back to 'self') allows them. Missing files fall back to system faces.
 */
/* After the shared dark theme: the PayPal notification keeps PayPal's own light card. */
const CONSOLE_DARK = `/* the film: two agent transcripts, rows aligned like a diff */
/* payout: the CITED frame on the left, PayPal's notice on the right */
.pay{min-height:calc(100vh - 65px);display:flex;align-items:center;justify-content:center;padding:48px 56px 64px}
.clean .pay{min-height:100vh}
.pay-grid{width:100%;max-width:1168px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4rem;align-items:center}
.pay-k{display:flex;align-items:center;gap:.5rem;margin:0 0 1rem;font:500 .55rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--test)}
.pay-k::before{content:"";width:.4rem;height:.4rem;border-radius:50%;background:var(--test)}
.pay-h{margin:0;font:300 2.5rem/1.08 var(--serif);letter-spacing:-.02em;text-wrap:balance}
.pay-h .num{color:var(--test);font-weight:400}
.pay-sub{margin:1.1rem 0 1.6rem;max-width:26rem;color:var(--muted);font-size:.82rem;line-height:1.5}
.pay-cards{display:grid;gap:.55rem;max-width:28rem}
.pay-card{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:.7rem .95rem;border:1px solid var(--line);border-radius:10px;background:var(--paper);font-size:.68rem;color:var(--ink-2)}
.pay-card b{color:var(--ink);font-weight:600}
.pay-card .zero{font-family:var(--mono);color:var(--muted);white-space:nowrap}
.pay-card a{color:var(--ink);font-weight:500;text-underline-offset:2px}
.pay-stmt{display:grid;gap:.3rem}
.mail{margin:0;max-width:none}
.notice{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(22,24,29,.05),0 28px 56px -28px rgba(22,24,29,.28)}
.notice header{background:#fff;color:var(--ink);padding:1.1rem 1.6rem;border-bottom:1px solid var(--line)}
.notice header .pp{font-size:1.15rem;color:#003087}
.notice header .pp span{color:#0070E0}
.notice header small{opacity:1;color:var(--muted);font-size:.6rem;letter-spacing:.02em}
.notice .top{padding:1.5rem 1.6rem 1.25rem;border-bottom:1px solid var(--line)}
.notice .hello{font-size:.85rem}
.notice .amount{font-size:3.1rem;margin:.55rem 0 .45rem}
.notice .amount small{font-size:.9rem}
.notice .top p{font-size:.72rem}
.notice dl{padding:.25rem 1.6rem .9rem}
.notice dl div{grid-template-columns:8rem 1fr;padding:.6rem 0}
.notice dt{font-size:.66rem}
.notice dd{font-size:.72rem}
.notice dd.mono{font-size:.64rem}
.notice .status{padding:.18rem .6rem;border-radius:999px;background:#E7F1EC;font-size:.66rem}
.notice footer{background:#F7F8FA;padding:.8rem 1.6rem;font-size:.58rem;border-radius:0 0 16px 16px}
.pay-cap{margin:.8rem 0 0;text-align:center;font-size:.58rem;color:var(--muted)}
.pay-cap a{color:inherit;text-decoration:underline;text-underline-offset:2px}
@media (max-width:1100px){.pay{padding:32px 24px 48px}.pay-grid{grid-template-columns:1fr;gap:2.4rem}.pay-h{font-size:2rem}}
@media (max-width:640px){.pay-h{font-size:1.6rem}.notice .amount{font-size:2.4rem}.notice dl div{grid-template-columns:1fr;gap:.1rem}.pay-sub,.pay-card{font-size:.85rem}.notice dt,.notice dd,.notice .top p{font-size:.8rem}}
/* Content sits in the same 1280px frame as the site header. */
.stage{max-width:1280px;padding-left:clamp(16px,4vw,56px);padding-right:clamp(16px,4vw,56px)}
.film{margin:0 0 2.6rem}
.film-grid{display:grid;grid-template-columns:minmax(0,1fr) 3.2rem minmax(0,1fr);row-gap:0}
.fa,.fb{background:var(--paper);border-left:1px solid var(--line);border-right:1px solid var(--line);padding:.85rem 1.2rem;min-width:0;transition:background .4s,opacity .4s,box-shadow .4s}
.fh{border-top:1px solid var(--line);border-radius:10px 10px 0 0;padding:1rem 1.2rem .9rem;display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
.fh h3{margin:0;font:400 1.05rem/1.2 var(--serif);display:flex;align-items:center;gap:.5rem}
.fh h3::before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:var(--held)}
.fb.fh h3::before{background:var(--test)}
.fh .model{font:400 .55rem/1 var(--mono);color:var(--muted)}
.fl{border-bottom:1px solid var(--line);border-radius:0 0 10px 10px}
.row{border-top:1px solid var(--line)}
.k{display:block;font:500 .5rem/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem}
.v{font-size:.78rem;color:var(--ink)}
.v small{display:block;color:var(--muted);font-size:.66rem;margin-top:.15rem}
.v .dim{color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:.35rem;margin-top:.4rem;padding:.2rem .5rem;border-radius:999px;font:500 .55rem/1.4 var(--mono);border:1px solid currentColor}
.chip.no{color:var(--held-ink);text-decoration:line-through;text-decoration-thickness:1px}
.chip.yes{color:var(--test)}
.q{font:400 .9rem/1.3 var(--serif);color:var(--ink)}
.verdict-row .v{display:flex;align-items:center;gap:.8rem}
.amount-big{font:300 1.7rem/1 var(--serif);letter-spacing:-.01em}
.fb .amount-big{color:var(--test)}
.fa .amount-big{color:var(--muted)}
.tick{flex:none;width:2.2rem;height:2.2rem}
.tick circle,.tick path{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.tick circle{stroke:var(--test);stroke-dasharray:120;stroke-dashoffset:0}
.tick path{stroke:var(--test);stroke-dasharray:30;stroke-dashoffset:0}
.fa .tick circle,.fa .tick path{stroke:var(--muted)}
.eq{display:grid;place-items:center;font:500 .8rem/1 var(--mono);color:var(--muted);position:relative}
.eq.ne{color:var(--test)}
.eq span{display:grid;place-items:center;width:1.8rem;height:1.8rem;border-radius:50%;border:1px solid var(--line);background:var(--bg)}
.eq.ne span{border-color:var(--test);box-shadow:0 0 0 4px var(--test-tint)}
.film-sum{margin:1.1rem 0 0;text-align:center;font:300 1.25rem/1.35 var(--serif);color:var(--ink);text-wrap:balance}
.film-sum em{color:var(--test);font-style:normal}
.dots{display:none;gap:.25rem;align-items:center;height:1.2rem}
.dots i{width:.32rem;height:.32rem;border-radius:50%;background:var(--muted);animation:blink 1s infinite}
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
.film-on .playing{box-shadow:inset 2px 0 0 var(--accent-on,transparent)}
.fa.playing{--accent-on:var(--held)}.fb.playing{--accent-on:var(--test)}
.diff .fa.row.changed,.diff .fb.row.changed{background:linear-gradient(90deg,rgba(31,122,85,.07),rgba(31,122,85,.02))}
.diff .fa.row.changed{background:linear-gradient(90deg,rgba(183,121,31,.08),rgba(183,121,31,.02))}
.film-bar{display:flex;align-items:stretch;margin-top:1.2rem;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.film-chs{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));flex:1}
.film-chs li{border-right:1px solid var(--line)}
.film-ch{all:unset;box-sizing:border-box;display:flex;align-items:baseline;gap:.6rem;width:100%;height:100%;padding:.8rem 1rem;cursor:pointer;position:relative;color:var(--muted);transition:color .2s,background .2s}
.film-ch i{position:absolute;left:0;right:0;top:0;height:2px;background:var(--test);transform:scaleX(var(--p,0));transform-origin:left}
.film-ch[aria-current="step"]{color:var(--ink);background:var(--raise)}
.film-ch:focus-visible,.film-btn:focus-visible{outline:2px solid var(--test);outline-offset:-2px}
.film-ch .n{font:500 .55rem/1 var(--mono);color:var(--test)}
.film-ch b{font:500 .7rem/1.25 var(--sans)}
.film-btn{all:unset;box-sizing:border-box;cursor:pointer;padding:0 1.1rem;font:500 .55rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink);border-right:1px solid var(--line)}
.film-btn:last-child{border-right:0}
.film-btn:hover{color:var(--test)}
.film-bar{display:none}.film-on .film-bar{display:flex}
@media (max-width:1100px){.film-ch b{font-size:.8rem}.film-ch .n,.film-btn{font-size:.7rem}.v{font-size:.85rem}.k{font-size:.6rem}}
@media (max-width:760px){
  .film-grid{grid-template-columns:minmax(0,1fr)}
  .film-grid > *{order:var(--o)}
  .eq{display:none}
  .fb.fh{margin-top:1.4rem}
  .film-bar{flex-wrap:wrap}
  .film-chs{grid-template-columns:1fr;flex-basis:100%}
  .film-chs li{border-right:0;border-bottom:1px solid var(--line)}
  .film-btn{flex:1;padding:.9rem 1rem;text-align:center}
}
.notice{--ink:#16181D;--muted:#5B5F68;--line:#E6E2DA;--paper:#FFFFFF;--test:#1F7A55;color:var(--ink)}.lanes{border-top-color:var(--line-strong)}.step::before{background:var(--bg)}.verdict strong{font-weight:300}.request{font-weight:300}`;

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
  return siteHeader(here, consoleHref);
}

function page(title: string, here: Here, body: string, opts: Opts): string {
  const cls = [opts.clean ? "clean" : "", opts.live ? "" : "animate"].filter(Boolean).join(" ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.live ? '<meta http-equiv="refresh" content="2">' : ""}
<style>${CSS}${SITE_NAV_TOUCH_CSS}${SITE_THEME_CSS}${SITE_HEADER_CSS}${CONSOLE_DARK}</style></head><body class="${cls}">${nav(here)}${body}</body></html>`;
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
  const body = `<main class="stage">
<div class="lede"><h1>One A/B test, two agents</h1><p>Same request, same offers, same ranking. Watch an agent shop without the creator's review, then the same request with it, then compare.</p><p class="lede-note">These two are seeded replays. The effect was measured with live GPT, Gemini and Claude agents in a pre-registered eval: <a href="../proof">see the proof</a>.</p></div>
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
  const body = `<main class="pay"><div class="pay-grid">
<div class="pay-copy">
  <p class="pay-k">Day 30 · creator payout</p>
  <h1 class="pay-h">${esc(name)} got paid <span class="num">${usd(p.amountMinor)}</span> through PayPal Payouts.</h1>
  <p class="pay-sub">Commission on the sales its test caused, paid once the 30-day hold ended. AI shopping agents read the test and bought; nobody clicked a link.</p>
  <div class="pay-cards">
${
  p.rival
    ? `  <div class="pay-card"><span><b>${esc(p.rival.name)}</b> · <span class="num">${p.rival.causedUnits}</span> extra units caused</span><span class="num zero">${usd(p.rival.paidMinor)} paid · no lift</span></div>`
    : ""
}
${
  p.statement && !opts.clean
    ? `  <div class="pay-card pay-stmt"><span>${esc(p.statement.brandName)} paid for it from its deposit: ${esc(invoiceStatusWord(p.statement.status))}${p.statement.dueMinor === 0 ? ", $0 due" : ""}</span><a href="/statement?brand=${encodeURIComponent(p.statement.brandId)}">Statement ${esc(p.statement.invoiceNumber)} →</a></div>`
    : ""
}
  </div>
${mismatch ? `<p class="warn">Ledger shows ${usd(p.ledgerPaidMinor ?? 0)} paid, which differs from this payout.</p>` : ""}
</div>
<figure class="mail">
<article class="notice" aria-label="PayPal payment notice">
<header><span class="pp">Pay<span>Pal</span></span><small>Payment received</small></header>
<div class="top">
  <p class="hello">${esc(name)}, you received a payment</p>
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
<figcaption class="pay-cap">The notice ${esc(name)} receives from PayPal. Simulated PayPal on this demo.${p.amountMinor === 38396 ? ` The same $383.96 payout also ran on the real PayPal sandbox: <a href="https://github.com/HUSAM-07/hack-paypal/blob/main/cited/SANDBOX-EVIDENCE.md">batch <span class="mono">ME2KV57B7KYNS</span>, SUCCESS</a>.` : ""}</figcaption>
</figure>
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
