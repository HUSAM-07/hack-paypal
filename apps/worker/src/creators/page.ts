/**
 * /creators: a reviewer connects PayPal (where CITED pays them) and publishes a test. The form
 * sits beside a live specimen of what an agent will be handed; after publishing, the holdout
 * schedule is drawn to scale. Every value a creator typed is escaped; the specimen script only
 * ever writes textContent.
 */
import {
  DEFAULT_SCHEDULE,
  SITE_HEAD_HTML,
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  siteMeta,
} from "@pact/protocol";
import { CREATOR_CATEGORIES, type CreatorCategory, creatorCategory } from "./categories";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface Product {
  category: string;
  upc: string;
  brand: string;
  name: string;
  specs: string;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
body{font:400 15px/1.6 var(--font-sans)}
a{color:inherit;text-underline-offset:3px;text-decoration-color:var(--border)}
a:hover{text-decoration-color:var(--foreground)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.num{font-variant-numeric:tabular-nums lining-nums}
code{overflow-wrap:anywhere}

.hero{padding:32px var(--pad) 32px}
.hero-top{display:flex;align-items:center;gap:12px;margin:0 0 14px}
.hero-top p{margin:0}
.stk{display:block;filter:var(--shadow-sticker);transform:rotate(-6deg)}
.rail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;margin:0 0 32px;padding:0;border-top:1px dashed var(--border)}
.rail li{padding:10px 12px 0 0;margin-top:-1px;border-top:2px solid transparent;font-size:13px;color:var(--muted-foreground)}
.rail li b{display:block;font:500 11px/1.5 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:inherit}
.rail li.done{color:var(--foreground);border-top-color:var(--foreground)}
.rail li.now{color:var(--foreground);border-top-color:var(--primary)}
.rail li.done b::after{content:" ✓";color:var(--primary)}

h1{margin:0 0 14px;font:400 clamp(36px,6vw,52px)/1.05 var(--font-serif);letter-spacing:-.02em;max-width:18ch;text-wrap:balance}
h1 em{font-style:italic;color:var(--primary)}
.h-form{font-size:clamp(30px,4vw,38px);max-width:none}
h2{margin:0 0 6px;font:400 26px/1.15 var(--font-serif);letter-spacing:-.01em}
h2.ui-band-h{font:600 20px/1.4 var(--font-sans);letter-spacing:-.01em;margin:0 0 14px}
.lede{margin:0 0 22px;max-width:62ch;color:var(--muted-foreground)}
.small{font-size:13px;color:var(--muted-foreground)}

.ppword{font-weight:800;font-style:italic;letter-spacing:-.02em}
.ppword .p1{color:var(--paypal)}.ppword .p2{color:var(--primary)}
.ui-btn.pp{height:44px;padding:0 20px;font-size:15px;background:var(--card);color:var(--card-foreground);box-shadow:var(--shadow-pop)}
.ui-btn.pp:hover{background:var(--hover)}
@media (pointer:coarse){.ui-btn{min-height:44px}}

.how{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px dashed var(--border);border-bottom:1px dashed var(--border)}
.how div{padding:16px var(--pad) 18px;font-size:14px;color:var(--muted-foreground);border-right:1px dashed var(--border)}
.how div:last-child{border-right:0}
.how b{display:block;margin-bottom:4px;font:400 22px/1.2 var(--font-serif);color:var(--foreground)}

.who{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;padding:6px 0;border-block:1px dashed var(--border);font-size:14px}
.who .sim{font:500 11px/1.3 var(--font-mono);letter-spacing:.04em;color:var(--warning);background:var(--warning-soft);border-radius:999px;padding:4px 10px}
.who form{margin-left:auto}
.linkish{font:inherit;background:none;border:0;padding:0;color:var(--muted-foreground);text-decoration:underline;text-underline-offset:3px;cursor:pointer;min-height:44px}
.linkish:hover{color:var(--foreground)}

.payout,.listing,.work-band{padding-inline:var(--pad)}
.work{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:48px;align-items:start}
fieldset{border:0;margin:0 0 28px;padding:0;min-width:0}
legend{padding:0;margin:0 0 4px;font:400 24px/1.2 var(--font-serif);letter-spacing:-.01em}
.hint{margin:0 0 12px;font-size:14px;color:var(--muted-foreground);max-width:62ch}
label.f{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input[type=text],textarea{display:block;width:100%;font:inherit;font-size:15px;color:var(--foreground);background:var(--background);border:1px solid var(--input);border-radius:8px;padding:9px 12px;min-height:44px}
input::placeholder,textarea::placeholder{color:var(--muted-foreground)}
textarea{resize:vertical;line-height:1.5}
textarea.long{min-height:150px;font:400 18px/1.45 var(--font-serif)}
input:focus,textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 1px var(--primary)}
.opts{display:grid;gap:8px}
.opts.cols{grid-template-columns:repeat(3,minmax(0,1fr))}
.opt{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:start;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--card-foreground);cursor:pointer;min-height:44px;transition:background-color .15s,border-color .15s}
.opt:hover{background:var(--hover)}
.opt:has(input:checked){border-color:var(--primary);background:var(--primary-soft)}
.opt input{margin:3px 0 0;width:18px;height:18px;accent-color:var(--primary)}
.opt b{font-weight:600}
.opt small{display:block;color:var(--muted-foreground);font-size:13px}
.opt code{font-size:11px}
.verdicts .opt.close:has(input:checked){border-color:var(--warning);background:var(--warning-soft)}
.verdicts .opt.close input{accent-color:var(--warning)}
.payout form{max-width:640px}
.payout fieldset{margin-bottom:18px}
.payout .opts{margin:0 0 6px}
.payout .saved{margin:0 0 14px;padding:10px 14px;border-left:2px solid var(--primary);background:var(--primary-soft);font-size:14px}
.err{margin:0 0 22px;padding:12px 16px;border-left:2px solid var(--destructive);background:var(--destructive-soft);font-size:14px}
.err ul{margin:4px 0 0;padding-left:18px}
.actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap}

aside{position:sticky;top:84px}
aside .ui-label{margin:0 0 8px}
.spec{background:var(--card);color:var(--card-foreground);border:1px dashed var(--border);border-radius:6px;padding:18px 18px 18px;font-size:14px}
.spec .cat{font:400 11px/1.4 var(--font-mono);letter-spacing:.04em;color:var(--muted-foreground)}
.spec .by{font-weight:600;margin:4px 0 10px}
.spec .vs{font:400 22px/1.15 var(--font-serif);margin:0 0 12px}
.spec .vd{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-radius:6px;background:var(--primary-soft);color:var(--primary);font-weight:600;margin:0 0 12px}
.spec .vd::before{content:"";flex:none;width:8px;height:8px;margin-top:.55em;border-radius:50%;background:currentColor}
.spec .vd.close{background:var(--warning-soft);color:var(--warning)}
.spec .sum{font:400 17px/1.4 var(--font-serif);margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}
.spec .sum:empty::before{content:"Your summary appears here.";color:var(--muted-foreground);font-style:italic}
.spec .disc{font-size:12px;color:var(--muted-foreground);border-top:1px dashed var(--border);padding-top:10px;margin:0;overflow-wrap:anywhere}
.spec .disc b{color:var(--foreground)}
.spec-note{font-size:13px;color:var(--muted-foreground);margin:12px 0 0}

.pub{padding-inline:var(--pad);background:var(--primary-soft)}
.pub .k{margin:0 0 4px;color:var(--primary)}
.pub h2{margin:0 0 10px;max-width:40ch}
.strip{display:grid;grid-template-columns:var(--cal) var(--steady);height:84px;margin:18px 0 8px;border-radius:6px;overflow:hidden;background:var(--card)}
.strip div{display:flex;flex-direction:column}
.strip div+div{border-left:2px solid var(--background)}
.strip .t{background:var(--primary)}
.strip .h{background:var(--warning)}
.strip-legend{display:grid;grid-template-columns:var(--cal) var(--steady);font-size:14px}
.strip-legend p{margin:0;padding-right:16px}
.strip-legend b{display:block}
.key{display:flex;gap:18px;margin:14px 0 18px;font:400 11px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.key span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px;background:var(--primary)}
.key span.h::before{background:var(--warning)}
.live{background:var(--card);border:1px dashed var(--border);border-left:2px solid var(--primary);border-radius:0 6px 6px 0;padding:12px 16px 14px;margin:0 0 18px;max-width:46rem;font-size:14px}
.live h3{margin:0 0 4px;font-size:15px;font-weight:600}
.live p{margin:6px 0}
.listing .ui-band-h{margin-inline:calc(var(--pad) * -1)}
.published{list-style:none;margin:0 -12px 18px;padding:0;font-size:14px}
.published li{flex-wrap:wrap;gap:4px 16px}
.listing p{display:flex;flex-wrap:wrap;gap:8px}

main.bare{padding:0}
.sim-bar{background:var(--warning-soft);color:var(--warning);font-size:13px;font-weight:600;text-align:center;padding:10px 16px;border-bottom:1px dashed var(--border)}
.consent{max-width:420px;margin:48px auto;padding:0 20px}
.consent .card{background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:14px;padding:28px 26px;box-shadow:var(--shadow-pop)}
.consent .ppword{font-size:26px;display:block;text-align:center;margin-bottom:16px}
.consent h1{font:600 20px/1.3 var(--font-sans);letter-spacing:0;text-align:center;max-width:none;margin:0 0 6px}
.consent ul{font-size:14px;padding-left:18px;margin:16px 0 22px}
.consent .ui-btn{width:100%;height:44px;margin-top:8px}
.ui-btn.pp-blue{background:var(--paypal);color:var(--background)}
.ui-btn.pp-blue:hover{opacity:.88}

@media (prefers-reduced-motion:no-preference){
  .pub{animation:arrive .35s ease-out}
  @keyframes arrive{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
}
@media (max-width:900px){
  .work{grid-template-columns:minmax(0,1fr);gap:32px}
  .opts.cols{grid-template-columns:minmax(0,1fr)}
  aside{position:static}
  .who form{margin-left:0}
  .strip-legend{grid-template-columns:minmax(0,1fr);gap:8px}
}
@media (max-width:640px){
  :root{--pad:16px}
  .how{grid-template-columns:minmax(0,1fr)}
  .how div{border-right:0;border-bottom:1px dashed var(--border)}
  .how div:last-child{border-bottom:0}
  .rail{font-size:12px}
}
`;

const NAV = siteHeader("creators");

/** `wide` pages (the publish form) use the 1200px frame; the rest sit in the 768px column. */
function shell(title: string, body: string, script = "", wide = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${siteMeta({ title, description: "Creators: connect PayPal, publish a product test, and get paid only for the agent sales it caused.", path: "/creators" })}${SITE_HEAD_HTML}
<style>${SITE_THEME_CSS}${CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}</style></head><body${wide ? "" : ' class="site-col"'}>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
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
    `${NAV}<div class="ui-frame"><main id="main"><section class="hero">${rail(1)}
<div class="hero-top"><img class="stk" src="/art/stickers/passport.webp" alt="" width="48" height="48"><p class="ui-label">For creators</p></div>
<h1>Get paid when your test <em>changes what an agent buys</em>.</h1>
<p class="lede">AI shopping agents read your test before they buy. CITED shows some of them your test and some of them nothing, then pays you 8% of every sale your test caused, and nothing for sales that would have happened anyway.</p>
${o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : ""}
<a class="ui-btn pp" href="/creators/connect">Connect ${PAYPAL_WORD}</a>
<p class="small">${o.simulated ? "This deployment uses simulated PayPal: sign-in happens on a page we host, and no PayPal account is touched." : "You sign in on paypal.com. CITED receives your PayPal account ID, name and email, never your password."}</p>
</section>
<section class="ui-band" aria-labelledby="how-h"><h2 class="ui-band-h" id="how-h">How it works</h2>
<div class="how">
<div><b>Your PayPal account ID</b>Log in with PayPal gives us your payer ID. Payouts go to it directly, so there's no bank form to fill in.</div>
<div><b>A test and a placebo</b>The placebo is something else you wrote. Agents shown it are the comparison group, so your name alone earns nothing.</div>
<div><b>Held 30 days, then paid</b>Credits wait out refunds and disputes, then arrive in one PayPal Payouts batch.</div>
</div></section></main></div>`,
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
<a class="ui-btn pp-blue" href="${cb({ code: o.code })}">Agree and connect</a>
<a class="ui-btn ui-btn-quiet" href="${cb({ error: "access_denied" })}">Cancel</a>
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
  /** Every product in the catalogue; the form shows the selected category's. */
  products: Product[];
  /** The selected category id. */
  category: string;
  defaultDisclosure: string;
  /** Values to put back after a failed submit. */
  values?: Record<string, string | string[]>;
  errors?: string[];
  published?: { testId: string; studioUrl: string; category: string };
  /** The creator's AG Studio view. */
  dashboardUrl: string;
  tests: { id: string; kind: string; verdict: string; category?: string; publishedAt: string }[];
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
  return `<section class="payout ui-band" aria-labelledby="payout-h">
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
<div class="actions"><button class="ui-btn ui-btn-solid" type="submit">Save payout choice</button></div>
</form>
</section>`;
}

function scheduleBlock(studioUrl: string, categoryId: string): string {
  const cat = creatorCategory(categoryId) ?? CREATOR_CATEGORIES[0];
  const s = DEFAULT_SCHEDULE;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const horizon = 30;
  const cal = `${s.calibrationDays}fr`;
  const steady = `${horizon - s.calibrationDays}fr`;
  const calTest = s.calibrationTestShare;
  const steadyTest = 1 - s.steadyHoldoutShare;
  return `<section class="pub ui-band" aria-labelledby="pub-h">
<p class="k ui-label">Published</p>
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
<p>Point an agent at <a href="/mcp"><code>/mcp</code></a> and search for <b>${esc(cat?.searchFor ?? "air purifiers")}</b>. Within a few seconds, each new session is randomly shown your test, your placebo article, or nothing. Try a few sessions to see each one.</p>
<p>If your agent buys, the sale appears on the <a href="/mcp#sales-feed">live feed at /mcp</a> under your name, with the credit CITED would hold for you. It is never paid out, and it stays out of the study numbers. In each category, CITED keeps the newest three creators' tests live at once.</p></div>
<a class="ui-btn ui-btn-solid" href="${esc(studioUrl)}">Open your creator dashboard</a>
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
  const selected = creatorCategory(v.category) ?? (CREATOR_CATEGORIES[0] as CreatorCategory);
  const catOpts = CREATOR_CATEGORIES.map((c) => {
    const names = v.products
      .filter((p) => p.category === c.id)
      .map((p) => `${p.brand} ${p.name}`)
      .join(", ");
    return `<label class="opt"><input type="radio" name="category" value="${c.id}"${c.id === selected.id ? " checked" : ""} data-noun="${esc(c.noun)}">
<span><b>${esc(c.label)}</b><small>${esc(names)}</small></span></label>`;
  }).join("");
  // One group of products and verdicts per category; only the selected one is shown and sent.
  const groups = CREATOR_CATEGORIES.map((c) => {
    const on = c.id === selected.id;
    const prods = v.products.filter((p) => p.category === c.id);
    const verdict =
      on && typeof v.values?.verdict === "string" ? v.values.verdict : (prods[0]?.upc ?? "close");
    const off = on ? "" : " disabled";
    const skuOpts = prods
      .map(
        (
          p,
        ) => `<label class="opt"><input type="checkbox" name="skus" value="${p.upc}"${on && picked(p.upc) ? " checked" : ""}${off} data-name="${esc(`${p.brand} ${p.name}`)}">
<span><b>${esc(p.brand)} ${esc(p.name)}</b><small>${esc(p.specs)} · UPC <code>${p.upc}</code></small></span></label>`,
      )
      .join("");
    const verdictOpts =
      prods
        .map(
          (
            p,
          ) => `<label class="opt"><input type="radio" name="verdict" value="${p.upc}"${on && verdict === p.upc ? " checked" : ""}${off}>
<span><b>${esc(p.brand)} ${esc(p.name)}</b><small>Recommend it. Agents get this as the verdict.</small></span></label>`,
        )
        .join("") +
      `<label class="opt close"><input type="radio" name="verdict" value="close"${on && verdict === "close" ? " checked" : ""}${off}>
<span><b>Close call</b><small>No single winner. Agents get your summary with no verdict.</small></span></label>`;
    return `<div class="cat-group" data-cat="${c.id}"${on ? "" : " hidden"}>
<fieldset><legend>Products you tested</legend>
<p class="hint">From the PayPal catalogue, matched by UPC: sales join to your test on these codes. Pick at least two.</p>
<div class="opts">${skuOpts}</div></fieldset>
<fieldset class="verdicts"><legend>Your verdict</legend><div class="opts">${verdictOpts}</div></fieldset>
</div>`;
  }).join("");
  const errs = v.errors?.length
    ? `<div class="err" role="alert" id="pub-errors" tabindex="-1"><b>Fix these before publishing:</b><ul>${v.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`
    : "";
  const list = v.tests.length
    ? `<section class="listing ui-band" aria-labelledby="list-h"><h2 class="h-list ui-band-h" id="list-h">Your published tests</h2><ul class="published">${v.tests
        .map(
          (t) =>
            `<li class="ui-row"><code>${esc(t.id)}</code><span>${t.kind === "test" ? esc(t.verdict) : "placebo"}</span><span class="small num">${esc(t.publishedAt.slice(0, 10))}</span></li>`,
        )
        .join(
          "",
        )}</ul>${v.published ? "" : `<p><a class="ui-btn ui-btn-quiet" href="${esc(v.dashboardUrl)}">Open your creator dashboard</a> <a class="ui-btn ui-btn-quiet" href="/creators/${esc(v.creatorId)}">Your public profile</a></p>`}</section>`
    : "";
  const step = v.published ? 3 : 2;
  return shell(
    "Publish a test · CITED",
    `${NAV}<div class="ui-frame-wide"><main id="main"><section class="hero">${rail(step)}
<div class="who"><span>Connected as <b>${esc(v.name)}</b></span>
<span>PayPal account ID <code>${esc(v.payerId)}</code> (<code>PAYPAL_ID</code>)</span>
${v.simulated ? `<span class="sim">Simulated PayPal</span>` : ""}
<form method="post" action="/creators/disconnect"><input type="hidden" name="csrf" value="${esc(v.csrf)}"><button class="linkish" type="submit">Disconnect</button></form></div></section>
${payoutSection(v)}
${v.published ? scheduleBlock(v.published.studioUrl, v.published.category) : ""}
${list}
<section class="work-band ui-band" aria-label="Publish"><div class="work">
<form id="pub" method="post" action="/creators/tests" novalidate>
<input type="hidden" name="csrf" value="${esc(v.csrf)}">
<h1 class="h-form">${v.published ? "Publish another test" : "Publish your test"}</h1>
<p class="lede">Agents shopping for <span class="c-noun">${esc(selected.noun)}</span> get this as a structured test. Write it the way you'd brief a buyer.</p>
${errs}
<fieldset><legend>Byline</legend>
<label class="f" for="name">Publish as</label>
<input type="text" id="name" name="name" maxlength="80" required value="${val("name", v.name)}" autocomplete="organization">
</fieldset>
<fieldset class="cats"><legend>Category</legend>
<p class="hint">Agents are shown your test when they search this category. Your products and verdict come from it.</p>
<div class="opts cols">${catOpts}</div></fieldset>
${groups}
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
<p class="hint">Something else you wrote, on another topic, with no verdict on <span class="c-noun">${esc(selected.noun)}</span>. Some agents are shown this instead of your test, so CITED pays for what your test says, not for your name.</p>
<label class="f" for="placeboTopic">Topic</label>
<input type="text" id="placeboTopic" name="placeboTopic" maxlength="40" required placeholder="desk lamps" value="${val("placeboTopic")}">
<label class="f" for="placeboSummary">What it says</label>
<textarea class="long" id="placeboSummary" name="placeboSummary" maxlength="1200" required>${val("placeboSummary")}</textarea>
</fieldset>
<div class="actions"><button class="ui-btn ui-btn-solid" type="submit">Publish test</button>
<span class="small">You can publish again later; earlier tests stay as they are.</span></div>
</form>
<aside aria-labelledby="spec-k"><p class="spec-k ui-label" id="spec-k">What an agent is handed</p>
<div class="spec" id="spec"><div class="cat"><span id="s-cat">${esc(selected.id)}</span> · ${esc(v.creatorId)}</div>
<div class="by" id="s-by">${val("name", v.name)}</div>
<p class="vs" id="s-vs">${esc(
      v.products
        .filter((p) => p.category === selected.id)
        .map((p) => `${p.brand} ${p.name}`)
        .join(" vs "),
    )}</p>
<div class="vd" id="s-vd">Verdict</div>
<p class="sum" id="s-sum">${val("summary")}</p>
<p class="disc"><b>Disclosure.</b> <span id="s-disc">${val("disclosure", v.defaultDisclosure)}</span></p></div>
<p class="spec-note">Ranking never changes: the catalogue lists the same offers in the same order whether or not an agent sees your test.</p>
</aside>
</div></section></main></div>`,
    SPEC_JS + (v.errors?.length ? FOCUS_ERRORS_JS : ""),
    true,
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
const nouns = document.querySelectorAll(".c-noun");
f.addEventListener("change", (e) => {
  const r = e.target;
  if (r.name !== "category") return;
  for (const g of f.querySelectorAll(".cat-group")) {
    const on = g.dataset.cat === r.value;
    g.hidden = !on;
    for (const i of g.querySelectorAll("input")) { i.disabled = !on; if (!on) i.checked = false; }
    if (on) {
      for (const i of g.querySelectorAll("input[name=skus]")) i.checked = true;
      const first = g.querySelector("input[name=verdict]");
      if (first) first.checked = true;
    }
  }
  for (const n of nouns) n.textContent = r.dataset.noun;
  $("s-cat").textContent = r.value;
});
f.addEventListener("input", sync); f.addEventListener("change", sync); sync();
`;

export function messagePage(title: string, message: string): string {
  return shell(
    `${title} · CITED`,
    `${NAV}<div class="ui-frame"><main id="main"><section class="hero"><h1>${esc(title)}</h1><p class="lede">${esc(message)}</p><a class="ui-btn ui-btn-solid" href="/creators">Back to creators</a></section></main></div>`,
  );
}
