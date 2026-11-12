/**
 * /creators: a reviewer connects PayPal (where CITED pays them) and publishes a test. The form
 * sits beside a live specimen of what an agent will be handed; after publishing, the holdout
 * schedule is drawn to scale. Every value a creator typed is escaped; the specimen script only
 * ever writes textContent.
 */
import {
  DEFAULT_SCHEDULE,
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
} from "@pact/protocol";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface Product {
  upc: string;
  brand: string;
  name: string;
  specs: string;
}

/* After the shared dark theme: PayPal's button and the simulated PayPal consent stay PayPal-coloured. */
const CREATORS_DARK = `.btn.pp{background:#FFC439;color:#111;font-family:var(--sans);text-transform:none;letter-spacing:0;font-size:.9rem;font-weight:600}.btn.pp:hover{background:#F2B52B}.btn.pp .ppword .p1,.btn.pp .ppword .p2{color:#003087}.consent .card{--ink:#16181D;--muted:#5B5F68;--line:#DADCE0;--paper:#FFFFFF;color:var(--ink)}.consent .card .ppword .p1{color:#003087}.consent .btn.blue{background:var(--pp-blue);color:#fff;font-family:var(--sans);text-transform:none;letter-spacing:0;font-size:.9rem}main{max-width:1280px;padding-left:clamp(16px,4vw,56px);padding-right:clamp(16px,4vw,56px)}.sim-bar{border-bottom-color:var(--line)}.how{border-top-color:var(--line-strong)}.opt:has(input:checked){border-color:var(--ink-2)}input:focus,textarea:focus{border-color:var(--test);box-shadow:0 0 0 1px var(--test)}.opt input{accent-color:var(--test)}`;

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
a{color:inherit}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:2px}
.num{font-variant-numeric:tabular-nums lining-nums}
code{font-family:var(--mono);font-size:.75rem;background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:.08rem .35rem;overflow-wrap:anywhere}

.nav{display:flex;align-items:baseline;gap:2rem;max-width:1180px;margin:0 auto;padding:22px 48px 0;font-size:.8rem}
.nav .mark{font-family:var(--serif);font-size:1.15rem;font-weight:600;letter-spacing:.06em;text-decoration:none;margin-right:auto}
.nav a{color:var(--muted);text-decoration:none;padding:.3rem 0;white-space:nowrap}
.nav a:hover{color:var(--ink)}
.nav a[aria-current]{color:var(--ink);box-shadow:inset 0 -1.5px 0 var(--ink)}
main{max-width:1180px;margin:0 auto;padding:40px 48px 72px}

.rail{display:flex;gap:0;list-style:none;margin:0 0 2.4rem;padding:0;font-size:.78rem;border-top:1px solid var(--line)}
.rail li{flex:1;padding:.7rem .9rem 0 0;color:var(--muted);border-top:2px solid transparent;margin-top:-1px}
.rail li b{display:block;font-weight:600;color:inherit}
.rail li.done{color:var(--ink);border-top-color:var(--ink)}
.rail li.now{color:var(--ink);border-top-color:var(--test)}
.rail li.done b::after{content:" ✓";color:var(--test)}

h1{font-family:var(--serif);font-weight:400;font-size:3rem;line-height:1.04;letter-spacing:-.02em;margin:0 0 1rem;max-width:18ch;text-wrap:balance}
h1 em{font-style:italic;color:var(--test)}
.h-form{font-size:2.2rem;max-width:none}
h2{font-family:var(--serif);font-weight:500;font-size:1.6rem;line-height:1.1;letter-spacing:-.01em;margin:0 0 .4rem}
.lede{font-size:1rem;max-width:36rem;margin:0 0 1.6rem;color:var(--ink-2)}
.small{font-size:.8rem;color:var(--muted)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;font:inherit;font-size:.9rem;font-weight:600;background:var(--ink);color:var(--bg);border:0;border-radius:999px;padding:.7rem 1.5rem;min-height:44px;cursor:pointer;text-decoration:none}
.btn:hover{background:#2B2E36}
.btn:active{transform:scale(.96)}
.btn.pp{background:#FFC439;color:#111}
.btn.pp:hover{background:#F2B52B}
.btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--line)}
.btn.ghost:hover{box-shadow:inset 0 0 0 1.5px var(--ink)}
.ppword{font-weight:800;font-style:italic;letter-spacing:-.02em}
.ppword .p1{color:var(--pp-text)}.ppword .p2{color:var(--pp-blue)}
/* light blue on the yellow button is 3:1; the wordmark goes all navy there */
.btn.pp .ppword .p2{color:var(--pp-navy)}

.how{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2rem;margin:2.8rem 0 0;padding:1.4rem 0 0;border-top:1px solid var(--ink)}
.how div{font-size:.85rem}
.how b{display:block;font-family:var(--serif);font-weight:500;font-size:1.15rem;margin-bottom:.25rem}

.who{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1.2rem;padding:.8rem 0;margin:0 0 2rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:.82rem}
.who .sim{color:var(--held-ink);font-weight:600}
.who form{margin-left:auto}
.linkish{font:inherit;background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer;min-height:44px}

.work{display:grid;grid-template-columns:minmax(0,1fr) 23rem;gap:3.2rem;align-items:start}
fieldset{border:0;margin:0 0 1.9rem;padding:0;min-width:0}
legend{padding:0;margin:0 0 .15rem;font-family:var(--serif);font-weight:500;font-size:1.25rem}
.hint{margin:0 0 .7rem;font-size:.8rem;color:var(--muted);max-width:36rem}
label.f{display:block;font-size:.78rem;font-weight:600;margin:.9rem 0 .3rem}
input[type=text],textarea{display:block;width:100%;font:inherit;font-size:.92rem;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:.6rem .75rem;min-height:44px}
textarea{resize:vertical;line-height:1.45}
textarea.long{min-height:7.5rem;font-family:var(--serif);font-size:1.02rem}
input:focus,textarea:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.opts{display:grid;gap:.5rem}
.opt{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.7rem;align-items:start;padding:.65rem .8rem;border:1px solid var(--line);border-radius:8px;background:var(--paper);cursor:pointer;min-height:44px}
.opt:has(input:checked){border-color:var(--ink)}
.opt input{margin:.2rem 0 0;width:18px;height:18px;accent-color:var(--ink)}
.opt b{font-weight:600}
.opt small{display:block;color:var(--muted);font-size:.75rem}
.opt code{font-size:.68rem}
.payout{margin:0 0 2.2rem;max-width:40rem}
.payout .opts{margin:0 0 .4rem}
.payout .saved{margin:0 0 .9rem;padding:.6rem .9rem;border-left:3px solid var(--test);background:var(--test-tint);font-size:.85rem}
.verdicts .opt.close:has(input:checked){border-color:var(--held)}
.verdicts .opt:not(.close):has(input:checked){border-color:var(--test)}
.err{margin:0 0 1.4rem;padding:.8rem 1rem;border-left:3px solid var(--held);background:var(--held-tint);font-size:.85rem}
.err ul{margin:.3rem 0 0;padding-left:1.1rem}
.actions{display:flex;align-items:center;gap:1.2rem;flex-wrap:wrap}

aside{position:sticky;top:24px}
.spec-k{font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:0 0 .5rem}
.spec{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:1.1rem 1.2rem 1.2rem;font-size:.82rem}
.spec .cat{font-family:var(--mono);font-size:.68rem;color:var(--muted)}
.spec .by{font-weight:600;margin:.2rem 0 .7rem}
.spec .vs{font-family:var(--serif);font-size:1.25rem;line-height:1.15;margin:0 0 .8rem}
.spec .vd{display:flex;align-items:flex-start;gap:.5rem;padding:.55rem .7rem;border-radius:6px;background:var(--test-tint);color:var(--test);font-weight:600;margin:0 0 .8rem}
.spec .vd::before{content:"";flex:none;width:.55rem;height:.55rem;margin-top:.35em;border-radius:50%;background:currentColor}
.spec .vd.close{background:var(--held-tint);color:var(--held-ink)}
.spec .sum{font-family:var(--serif);font-size:.98rem;line-height:1.38;margin:0 0 .8rem;white-space:pre-wrap;overflow-wrap:anywhere}
.spec .sum:empty::before{content:"Your summary appears here.";color:var(--muted);font-style:italic}
.spec .disc{font-size:.72rem;color:var(--muted);border-top:1px solid var(--line);padding-top:.6rem;margin:0;overflow-wrap:anywhere}
.spec .disc b{color:var(--ink)}
.spec-note{font-size:.75rem;color:var(--muted);margin:.7rem 0 0}

.pub{border-top:3px solid var(--test);background:var(--test-tint);padding:1.3rem 1.4rem 1.4rem;margin:0 0 2.4rem}
.pub .k{font-size:.7rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--test)}
.pub h2{margin:.3rem 0 .6rem}
.strip{display:grid;grid-template-columns:var(--cal) var(--steady);height:84px;margin:1.1rem 0 .4rem;border-radius:6px;overflow:hidden;background:var(--paper)}
.strip div{display:flex;flex-direction:column}
.strip div+div{border-left:2px solid var(--paper)}
.strip .t{background:var(--test)}
.strip .h{background:var(--held)}
.strip-legend{display:grid;grid-template-columns:var(--cal) var(--steady);font-size:.78rem}
.strip-legend p{margin:0;padding-right:1rem}
.strip-legend b{display:block}
.key{display:flex;gap:1.2rem;font-size:.75rem;color:var(--muted);margin:.9rem 0 1.1rem}
.key span::before{content:"";display:inline-block;width:.65rem;height:.65rem;border-radius:2px;margin-right:.35rem;vertical-align:-1px;background:var(--test)}
.key span.h::before{background:var(--held)}
.h-list{font-size:1.25rem}
.live{background:var(--paper);border-left:3px solid var(--test);padding:.8rem 1rem .9rem;margin:0 0 1.2rem;max-width:46rem}
.live h3{margin:0 0 .3rem;font-size:.95rem}
.live p{margin:.3rem 0;font-size:.82rem}
.published{list-style:none;margin:0 0 2rem;padding:0;font-size:.82rem}
.published li{display:flex;flex-wrap:wrap;gap:.3rem .9rem;padding:.55rem 0;border-top:1px solid var(--line)}

/* Simulated PayPal consent: PayPal's own colours, labelled as ours in two places. */
main.bare{max-width:none;padding:0}
.sim-bar{background:var(--held-tint);color:var(--held-ink);font-size:.8rem;font-weight:600;text-align:center;padding:.6rem 1rem;border-bottom:1px solid #EAD9B8}
.consent{max-width:26rem;margin:48px auto;padding:0 20px}
.consent .card{background:#fff;border:1px solid #DADCE0;border-radius:14px;padding:1.8rem 1.6rem}
.consent .ppword{font-size:1.6rem;display:block;text-align:center;margin-bottom:1rem}
.consent h1{font-family:var(--sans);font-weight:600;font-size:1.2rem;letter-spacing:0;text-align:center;max-width:none;margin:0 0 .4rem}
.consent ul{font-size:.82rem;padding-left:1.1rem;margin:1rem 0 1.4rem}
.consent .btn{width:100%;margin-top:.5rem}
.consent .btn.blue{background:var(--pp-blue);color:#fff}
.consent .btn.blue:hover{background:#005EA6}

@media (prefers-reduced-motion:no-preference){
  .pub{animation:arrive .35s ease-out}
  @keyframes arrive{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
}
@media (max-width:900px){
  .nav,main{padding-left:20px;padding-right:20px}
  .nav{gap:.2rem .9rem;font-size:.72rem;flex-wrap:wrap}
  .nav .mark{flex-basis:100%}
  main{padding-top:28px}
  h1{font-size:2.1rem}
  .how{grid-template-columns:1fr;gap:1rem}
  .work{grid-template-columns:1fr;gap:2rem}
  aside{position:static}
  .rail{font-size:.7rem}
  .who form{margin-left:0}
  .strip-legend{grid-template-columns:1fr;gap:.5rem}
}
`;

const NAV = siteHeader("creators");

function shell(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="/favicon.svg">
<style>${CSS}${SITE_NAV_TOUCH_CSS}${SITE_THEME_CSS}${SITE_HEADER_CSS}${CREATORS_DARK}</style></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

const PAYPAL_WORD = `<span class="ppword"><span class="p1">Pay</span><span class="p2">Pal</span></span>`;

function rail(step: 1 | 2 | 3): string {
  const items = [
    ["Connect PayPal", "where CITED pays you"],
    ["Publish a test", "and a placebo article"],
    ["Watch your credits", "in your dashboard"],
  ];
  return `<ol class="rail" aria-label="Steps">${items
    .map(([t, s], i) => {
      const cls = i + 1 < step ? "done" : i + 1 === step ? "now" : "";
      return `<li class="${cls}"${i + 1 === step ? ' aria-current="step"' : ""}><b>${t}</b>${s}</li>`;
    })
    .join("")}</ol>`;
}

export function welcomePage(o: { simulated: boolean; error?: string }): string {
  return shell(
    "CITED for creators",
    `${NAV}<main id="main">${rail(1)}
<h1>Get paid when your test <em>changes what an agent buys</em>.</h1>
<p class="lede">AI shopping agents read your test before they buy. CITED shows some of them your test and some of them nothing, then pays you 8% of every sale your test caused, and nothing for sales that would have happened anyway.</p>
${o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : ""}
<a class="btn pp" href="/creators/connect">Connect ${PAYPAL_WORD}</a>
<p class="small">${o.simulated ? "This deployment uses simulated PayPal: sign-in happens on a page we host, and no PayPal account is touched." : "You sign in on paypal.com. CITED receives your PayPal account ID, name and email, never your password."}</p>
<div class="how">
<div><b>Your PayPal account ID</b>Log in with PayPal gives us your payer ID. Payouts go to it directly, so there's no bank form to fill in.</div>
<div><b>A test and a placebo</b>The placebo is something else you wrote. Agents shown it are the comparison group, so your name alone earns nothing.</div>
<div><b>Held 30 days, then paid</b>Credits wait out refunds and disputes, then arrive in one PayPal Payouts batch.</div>
</div></main>`,
  );
}

export function consentPage(o: { state: string; redirectUri: string; code: string }): string {
  const cb = (q: Record<string, string>) =>
    esc(`${o.redirectUri}?${new URLSearchParams({ ...q, state: o.state })}`);
  return shell(
    "Simulated PayPal sign-in",
    `<main id="main" class="bare"><div class="sim-bar" role="note">Simulated PayPal sign-in. This page is hosted by CITED, not PayPal. Nothing you do here reaches a PayPal account.</div>
<div class="consent"><div class="card">${PAYPAL_WORD}
<h1>Connect to CITED</h1>
<p class="small" style="text-align:center;margin:0">Simulated PayPal sign-in</p>
<ul><li>Your PayPal account ID (payer ID), so CITED can pay you</li><li>Your name and email address</li></ul>
<a class="btn blue" href="${cb({ code: o.code })}">Agree and connect</a>
<a class="btn ghost" href="${cb({ error: "access_denied" })}">Cancel</a>
<p class="small" style="margin:1rem 0 0">With real PayPal this is PayPal's own consent screen. Here, the account ID is made up from this one sign-in.</p>
</div></div></main>`,
  );
}

export interface PublishView {
  name: string;
  payerId: string;
  creatorId: string;
  simulated: boolean;
  csrf: string;
  products: Product[];
  category: string;
  defaultDisclosure: string;
  /** Values to put back after a failed submit. */
  values?: Record<string, string | string[]>;
  errors?: string[];
  published?: { testId: string; studioUrl: string };
  /** The creator's AG Studio view. */
  dashboardUrl: string;
  tests: { id: string; kind: string; verdict: string; publishedAt: string }[];
  /** Where CITED pays this creator. `label` is masked (`Venmo ···0123`); never the full receiver. */
  payout: {
    method: "PAYPAL" | "VENMO";
    label: string | null;
    /** What was typed in the Venmo box, put back after a failed save. */
    typed?: string;
    error?: string;
    saved?: boolean;
  };
}

function payoutSection(v: PublishView): string {
  const p = v.payout;
  const venmo = p.method === "VENMO";
  return `<section class="payout" aria-labelledby="payout-h">
<form method="post" action="/creators/payout" novalidate>
<input type="hidden" name="csrf" value="${esc(v.csrf)}">
<fieldset><legend id="payout-h">How you get paid</legend>
<p class="hint">Credits are paid after the 30-day hold, in one PayPal Payouts batch. Pick where yours land.</p>
${p.saved ? `<p class="saved" role="status">Saved. You will be paid ${p.method === "VENMO" ? `to ${esc(p.label ?? "Venmo")}` : "to your PayPal account"}.</p>` : ""}
${p.error ? `<div class="err" role="alert" id="venmo-err">${esc(p.error)}</div>` : ""}
<div class="opts">
<label class="opt"><input type="radio" name="method" value="PAYPAL"${venmo ? "" : " checked"}>
<span><b>PayPal</b><small>Your PayPal account ID, from the sign-in above.</small></span></label>
<label class="opt"><input type="radio" name="method" value="VENMO"${venmo ? " checked" : ""}>
<span><b>Venmo</b><small>US only, in US dollars. Needs your US mobile number or Venmo username.${venmo && p.label ? ` Now: ${esc(p.label)}.` : ""}</small></span></label>
</div>
<label class="f" for="venmo">Venmo mobile number or @username <span class="small">(only for Venmo)</span></label>
<input type="text" id="venmo" name="venmo" maxlength="40" autocomplete="off" placeholder="415 555 0123 or @yourname" value="${esc(p.typed ?? "")}"${p.error ? ' aria-invalid="true" aria-describedby="venmo-err"' : ""}>
</fieldset>
<div class="actions"><button class="btn" type="submit">Save payout choice</button></div>
</form>
</section>`;
}

function scheduleBlock(studioUrl: string): string {
  const s = DEFAULT_SCHEDULE;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const horizon = 30;
  const cal = `${s.calibrationDays}fr`;
  const steady = `${horizon - s.calibrationDays}fr`;
  const calTest = s.calibrationTestShare;
  const steadyTest = 1 - s.steadyHoldoutShare;
  return `<section class="pub" aria-labelledby="pub-h">
<div class="k">Published</div>
<h2 id="pub-h">Your test enters the holdout schedule: ${Math.round(calTest * 100)}/${Math.round((1 - calTest) * 100)} for ${s.calibrationDays} days, then ${pct(s.steadyHoldoutShare)}.</h2>
<div class="strip" style="--cal:${cal};--steady:${steady}" role="img" aria-label="Days 1 to ${s.calibrationDays}: ${pct(calTest)} of agents see your test. After that: ${pct(steadyTest)} see it and ${pct(s.steadyHoldoutShare)} are held out.">
<div><span class="t" style="flex:${calTest}"></span><span class="h" style="flex:${1 - calTest}"></span></div>
<div><span class="t" style="flex:${steadyTest}"></span><span class="h" style="flex:${s.steadyHoldoutShare}"></span></div>
</div>
<div class="strip-legend" style="--cal:${cal};--steady:${steady}">
<p><b>Days 1 to ${s.calibrationDays}</b>Half the agents see your test, half don't. That measures your lift fast.</p>
<p><b>From day ${s.calibrationDays + 1}, for good</b>${pct(steadyTest)} see it. ${pct(s.steadyHoldoutShare)} stay held out, half shown your placebo, so the lift stays measured.</p>
</div>
<div class="key"><span>Shown your test</span><span class="h">Held out</span></div>
<div class="live" id="see-it"><h3>See it in front of an agent</h3>
<p>Point an agent at <a href="/mcp"><code>/mcp</code></a> and search for <b>air purifiers</b>. Within a few seconds, each new session is randomly shown your test, your placebo article, or nothing. Try a few sessions to see each one.</p>
<p>If your agent buys, the sale appears on the <a href="/mcp#feed">live feed at /mcp</a> under your name, with the credit CITED would hold for you. It is never paid out, and it stays out of the study numbers. CITED keeps the newest three creators' tests live at once.</p></div>
<a class="btn" href="${esc(studioUrl)}">Open your creator dashboard</a>
</section>`;
}

export function publishPage(v: PublishView): string {
  const val = (k: string, d = "") => {
    const x = v.values?.[k];
    return esc(typeof x === "string" ? x : d);
  };
  const picked = (upc: string) => {
    const x = v.values?.skus;
    return x === undefined ? true : Array.isArray(x) ? x.includes(upc) : x === upc;
  };
  const verdict =
    typeof v.values?.verdict === "string" ? v.values.verdict : (v.products[0]?.upc ?? "close");
  const skuOpts = v.products
    .map(
      (
        p,
      ) => `<label class="opt"><input type="checkbox" name="skus" value="${p.upc}"${picked(p.upc) ? " checked" : ""} data-name="${esc(`${p.brand} ${p.name}`)}">
<span><b>${esc(p.brand)} ${esc(p.name)}</b><small>${esc(p.specs)} · UPC <code>${p.upc}</code></small></span></label>`,
    )
    .join("");
  const verdictOpts =
    v.products
      .map(
        (
          p,
        ) => `<label class="opt"><input type="radio" name="verdict" value="${p.upc}"${verdict === p.upc ? " checked" : ""}>
<span><b>${esc(p.brand)} ${esc(p.name)}</b><small>Recommend it. Agents get this as the verdict.</small></span></label>`,
      )
      .join("") +
    `<label class="opt close"><input type="radio" name="verdict" value="close"${verdict === "close" ? " checked" : ""}>
<span><b>Close call</b><small>No single winner. Agents get your summary with no verdict.</small></span></label>`;
  const errs = v.errors?.length
    ? `<div class="err" role="alert" id="pub-errors" tabindex="-1"><b>Fix these before publishing:</b><ul>${v.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`
    : "";
  const list = v.tests.length
    ? `<h2 class="h-list">Your published tests</h2><ul class="published">${v.tests
        .map(
          (t) =>
            `<li><code>${esc(t.id)}</code><span>${t.kind === "test" ? esc(t.verdict) : "placebo"}</span><span class="small num">${esc(t.publishedAt.slice(0, 10))}</span></li>`,
        )
        .join(
          "",
        )}</ul>${v.published ? "" : `<p><a class="btn ghost" href="${esc(v.dashboardUrl)}">Open your creator dashboard</a></p>`}`
    : "";
  const step = v.published ? 3 : 2;
  return shell(
    "Publish a test · CITED",
    `${NAV}<main id="main">${rail(step)}
<div class="who"><span>Connected as <b>${esc(v.name)}</b></span>
<span>PayPal account ID <code>${esc(v.payerId)}</code> (<code>PAYPAL_ID</code>)</span>
${v.simulated ? `<span class="sim">Simulated PayPal</span>` : ""}
<form method="post" action="/creators/disconnect"><input type="hidden" name="csrf" value="${esc(v.csrf)}"><button class="linkish" type="submit">Disconnect</button></form></div>
${payoutSection(v)}
${v.published ? scheduleBlock(v.published.studioUrl) : ""}
${list}
<div class="work">
<form id="pub" method="post" action="/creators/tests" novalidate>
<input type="hidden" name="csrf" value="${esc(v.csrf)}">
<h1 class="h-form">${v.published ? "Publish another test" : "Publish your test"}</h1>
<p class="lede">Agents shopping for ${esc(v.category.replace(/-/g, " "))}s get this as a structured test. Write it the way you'd brief a buyer.</p>
${errs}
<fieldset><legend>Byline</legend>
<label class="f" for="name">Publish as</label>
<input type="text" id="name" name="name" maxlength="80" required value="${val("name", v.name)}" autocomplete="organization">
</fieldset>
<fieldset><legend>Products you tested</legend>
<p class="hint">From the PayPal catalogue, matched by UPC: sales join to your test on these codes. Pick at least two.</p>
<div class="opts">${skuOpts}</div></fieldset>
<fieldset class="verdicts"><legend>Your verdict</legend><div class="opts">${verdictOpts}</div></fieldset>
<fieldset><legend>What you measured</legend>
<p class="hint">Method and result, in your words. 60 to 1,200 characters.</p>
<label class="sr" for="summary">What you measured</label>
<textarea class="long" id="summary" name="summary" maxlength="1200" required>${val("summary")}</textarea>
</fieldset>
<fieldset><legend>Disclosure</legend>
<p class="hint">Shown to every agent with your test (FTC endorsement guides, 16 CFR 255). Say that you may earn a commission.</p>
<label class="sr" for="disclosure">Disclosure</label>
<textarea id="disclosure" name="disclosure" rows="3" maxlength="400" required>${val("disclosure", v.defaultDisclosure)}</textarea>
</fieldset>
<fieldset><legend>Placebo article</legend>
<p class="hint">Something else you wrote, on another topic, with no purifier verdict. Some agents are shown this instead of your test, so CITED pays for what your test says, not for your name.</p>
<label class="f" for="placeboTopic">Topic</label>
<input type="text" id="placeboTopic" name="placeboTopic" maxlength="40" required placeholder="desk lamps" value="${val("placeboTopic")}">
<label class="f" for="placeboSummary">What it says</label>
<textarea class="long" id="placeboSummary" name="placeboSummary" maxlength="1200" required>${val("placeboSummary")}</textarea>
</fieldset>
<div class="actions"><button class="btn" type="submit">Publish test</button>
<span class="small">You can publish again later; earlier tests stay as they are.</span></div>
</form>
<aside aria-labelledby="spec-k"><p class="spec-k" id="spec-k">What an agent is handed</p>
<div class="spec" id="spec"><div class="cat">${esc(v.category)} · ${esc(v.creatorId)}</div>
<div class="by" id="s-by">${val("name", v.name)}</div>
<p class="vs" id="s-vs">${esc(v.products.map((p) => `${p.brand} ${p.name}`).join(" vs "))}</p>
<div class="vd" id="s-vd">Verdict</div>
<p class="sum" id="s-sum">${val("summary")}</p>
<p class="disc"><b>Disclosure.</b> <span id="s-disc">${val("disclosure", v.defaultDisclosure)}</span></p></div>
<p class="spec-note">Ranking never changes: the catalogue lists the same offers in the same order whether or not an agent sees your test.</p>
</aside>
</div></main>`,
    SPEC_JS + (v.errors?.length ? FOCUS_ERRORS_JS : ""),
  );
}

/* After a failed publish the page reloads at the top; move focus to the error summary. */
const FOCUS_ERRORS_JS = `
document.getElementById("pub-errors")?.focus();
`;

/* The specimen beside the form, kept in step with it. textContent only. */
const SPEC_JS = `
const f = document.getElementById("pub");
const $ = (id) => document.getElementById(id);
function sync() {
  $("s-by").textContent = f.name.value.trim() || "Your byline";
  const picked = [...f.querySelectorAll('input[name=skus]:checked')].map((i) => i.dataset.name);
  $("s-vs").textContent = picked.length ? picked.join(" vs ") : "Pick the products you tested";
  const v = f.querySelector('input[name=verdict]:checked');
  const vd = $("s-vd");
  if (!v || v.value === "close") { vd.className = "vd close"; vd.textContent = "Close call: no verdict"; }
  else { vd.className = "vd"; vd.textContent = "Verdict: " + v.closest("label").querySelector("b").textContent; }
  $("s-sum").textContent = f.summary.value.trim();
  $("s-disc").textContent = f.disclosure.value.trim();
}
f.addEventListener("input", sync); f.addEventListener("change", sync); sync();
`;

export function messagePage(title: string, message: string): string {
  return shell(
    `${title} · CITED`,
    `${NAV}<main id="main"><h1 style="font-size:2.2rem">${esc(title)}</h1><p class="lede">${esc(message)}</p><a class="btn" href="/creators">Back to creators</a></main>`,
  );
}
