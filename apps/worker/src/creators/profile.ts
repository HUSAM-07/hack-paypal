/**
 * /creators/:creatorId: a creator's public profile. Read-only: it shows what the creator published,
 * the measured lift where a pre-registered study exists for that test, and what the ledger holds
 * for them. Everything creator-written goes through the catalogue's cleaner and is escaped again
 * on output. No payer id, email or payout receiver is ever read into the view.
 */
import {
  airlabWinixTest,
  COMMISSION_BPS,
  CREATOR_TEXT_LIMITS,
  cleanCreatorText,
  crumblabRoborockTest,
  formatCurrency,
  HOLD_DAYS,
  housefreshWinixTest,
  narrowCloseTest,
  quietbenchBoseTest,
  SITE_HEAD_HTML,
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
  siteMeta,
  type VerifiedTest,
} from "@pact/protocol";
import { Hono } from "hono";
import catalogueSummary from "../../../../packages/evals/results/cited/summary.json";
import headphoneSummary from "../../../../packages/evals/results/cited-headphones/summary.json";
import priceSummary from "../../../../packages/evals/results/cited-price-matched/summary.json";
import vacuumSummary from "../../../../packages/evals/results/cited-robot-vacuum/summary.json";
import { CITED_PREFIX, internalEngineFetch } from "../cited";
import { DEMO_PAGE_CSP } from "../cited-apps";
import type { Env } from "../env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The demo's creators: tests come from the committed fixtures, names are ours. */
const FIXTURE_CREATORS: Record<string, { name: string; tests: VerifiedTest[] }> = {
  housefresh: { name: "HouseFresh", tests: [housefreshWinixTest, narrowCloseTest] },
  airlab: { name: "AirLab", tests: [airlabWinixTest] },
  crumblab: { name: "CrumbLab", tests: [crumblabRoborockTest] },
  quietbench: { name: "QuietBench", tests: [quietbenchBoseTest] },
};

interface Cell {
  sessions: number;
  target: number;
}
interface StudyRow {
  sessions: number;
  lift: { lift: number; lowerBound: number };
  pooled: { test: Cell; placebo: Cell };
}
const study = (file: unknown, key: string): StudyRow => {
  const row = (file as Record<string, StudyRow | undefined>)[key];
  if (!row) throw new Error(`summary.json has no ${key}`);
  return row;
};

/**
 * The pre-registered study that measured each fixture test (the same files /proof reads).
 * AirLab's test is deliberately absent: the purifier study measured HouseFresh's test.
 */
const MEASURED: Record<string, { study: StudyRow; anchor: string; label: string }> = {
  [housefreshWinixTest.id]: {
    study: study(priceSummary, "purifier-parity-forced"),
    anchor: "result",
    label: "Air purifiers, same price, every agent made to choose",
  },
  [narrowCloseTest.id]: {
    study: study(catalogueSummary, "narrow-forced"),
    anchor: "result",
    label: "A close call, every agent made to choose",
  },
  [crumblabRoborockTest.id]: {
    study: study(vacuumSummary, "vacuum-parity-forced"),
    anchor: "result",
    label: "Robot vacuums, same price, every agent made to choose",
  },
  [quietbenchBoseTest.id]: {
    study: study(headphoneSummary, "headphones-parity-forced"),
    anchor: "result",
    label: "Headphones, same price, every agent made to choose",
  },
};

export interface ProfileInput {
  creatorId: string;
  name: string;
  tests: { test: VerifiedTest; publishedAt: string | null }[];
  /** The engine's /credits entry for this creator, if the ledger has one. */
  ledger?: { totalsByCurrency?: Record<string, Totals> } | undefined;
  /** The engine's /payouts batches; only items for this creator are read. */
  batches: { senderBatchId: string; status: string; createdAt: string; items: unknown[] }[];
}

interface Totals {
  pending: number;
  voided: number;
  paid: number;
  frozen: number;
  held: number;
}

export interface MeasuredView {
  pp: number;
  lowerBoundPp: number;
  testBought: string;
  placeboBought: string;
  sessions: number;
  label: string;
  proofHref: string;
  credited: boolean;
}

export interface TestView {
  id: string;
  products: string[];
  verdict: string;
  category: string;
  date: string | null;
  summary: string;
  disclosure: string;
  measured: MeasuredView | null;
}

export interface LedgerLine {
  currency: string;
  earned: string;
  paid: string;
  waiting: string;
  frozen: string;
  held: string;
  voided: string;
}

export interface ProfileView {
  creatorId: string;
  name: string;
  isFixture: boolean;
  disclosure: string;
  tests: TestView[];
  ledger: LedgerLine[];
  payouts: { batchId: string; status: string; date: string; amount: string }[];
}

const clean1 = (s: string, max: number) => cleanCreatorText(s, max);

function verdictOf(t: VerifiedTest): string {
  if (!t.verdictUpc) return "Close call, no winner named";
  const p = t.skus.find((s) => s.upc === t.verdictUpc);
  return p ? clean1(`${p.brand} ${p.name}`, 80) : "Verdict on one of the products";
}

const pp = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} points`;

function measuredFor(t: VerifiedTest, fixture: boolean): MeasuredView | null {
  const m = fixture ? MEASURED[t.id] : undefined;
  if (!m) return null;
  const { lift, pooled, sessions } = m.study;
  return {
    pp: lift.lift,
    lowerBoundPp: lift.lowerBound,
    testBought: `${pooled.test.target} of ${pooled.test.sessions}`,
    placeboBought: `${pooled.placebo.target} of ${pooled.placebo.sessions}`,
    sessions,
    label: m.label,
    proofHref: `/proof#${m.anchor}`,
    credited: lift.lowerBound > 0,
  };
}

const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);

/** Everything the page shows, shaped and cleaned. Pure: the tests exercise this directly. */
export function shapeProfile(input: ProfileInput): ProfileView {
  const isFixture = input.creatorId in FIXTURE_CREATORS;
  const tests = input.tests
    .filter((t) => t.test.kind === "test")
    .map(
      ({ test, publishedAt }): TestView => ({
        id: test.id,
        products: test.skus.map((s) => clean1(`${s.brand} ${s.name}`, 80)),
        verdict: verdictOf(test),
        category: clean1(test.category, CREATOR_TEXT_LIMITS.topic),
        date: publishedAt ? day(publishedAt) : null,
        summary: cleanCreatorText(test.summary, CREATOR_TEXT_LIMITS.summary, true),
        disclosure: clean1(test.disclosure, CREATOR_TEXT_LIMITS.disclosure),
        measured: measuredFor(test, isFixture),
      }),
    );

  const byCur = input.ledger?.totalsByCurrency ?? {};
  const ledger = Object.keys(byCur)
    .sort((a, b) => Number(b === "USD") - Number(a === "USD") || (a < b ? -1 : 1))
    .map((currency): LedgerLine => {
      const t = byCur[currency] as Totals;
      const m = (n: number) => formatCurrency(n, currency);
      return {
        currency,
        earned: m(t.pending + t.paid),
        paid: m(t.paid),
        waiting: m(Math.max(0, t.pending - t.frozen - t.held)),
        frozen: m(t.frozen),
        held: m(t.held),
        voided: m(t.voided),
      };
    });

  const payouts: ProfileView["payouts"] = [];
  for (const b of input.batches) {
    for (const raw of b.items) {
      const i = raw as { creatorId?: unknown; amountMinor?: unknown; currency?: unknown };
      if (i.creatorId !== input.creatorId) continue;
      if (typeof i.amountMinor !== "number" || typeof i.currency !== "string") continue;
      payouts.push({
        batchId: clean1(b.senderBatchId, 80),
        status: clean1(b.status, 24),
        date: day(b.createdAt) ?? "",
        amount: formatCurrency(i.amountMinor, i.currency),
      });
    }
  }

  return {
    creatorId: input.creatorId,
    name: clean1(input.name, CREATOR_TEXT_LIMITS.name),
    isFixture,
    disclosure: tests[0]?.disclosure ?? "",
    tests,
    ledger,
    payouts,
  };
}

const CSS = `
*,*::before,*::after{box-sizing:border-box}
body{font:400 15px/1.6 var(--font-sans)}
a{color:inherit;text-underline-offset:3px;text-decoration-color:var(--border)}
a:hover{text-decoration-color:var(--foreground)}
.num{font-variant-numeric:tabular-nums lining-nums}
.hero{padding:36px var(--pad) 32px}
.crumb{margin:0 0 14px}
.crumb a{text-decoration:none;color:var(--muted-foreground)}
.crumb a:hover{color:var(--foreground)}
h1{font:400 clamp(40px,8vw,56px)/1.04 var(--font-serif);letter-spacing:-.02em;margin:0 0 10px;overflow-wrap:anywhere}
h2{margin:0 0 14px}
h3{font:400 24px/1.2 var(--font-serif);letter-spacing:-.01em;margin:0 0 6px;overflow-wrap:anywhere}
.lede{margin:0;color:var(--muted-foreground);max-width:62ch}
.ui-band .lede{padding:0 var(--pad)}
.disclosure{margin:18px 0 0;padding:10px 14px;border:1px dashed var(--warning);border-radius:6px;background:var(--warning-soft);font-size:14px;max-width:62ch;overflow-wrap:anywhere}
.disclosure b{color:var(--warning)}
.test{padding:18px var(--pad) 22px;border-bottom:1px dashed var(--border)}
.test:last-child{border-bottom:0}
.meta{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 10px;font:400 11px/1.5 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.vd{font-weight:600;margin:0 0 6px}
.sum{font:400 18px/1.45 var(--font-serif);margin:6px 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}
.lift{border:1px dashed var(--primary);border-radius:6px;background:var(--primary-soft);padding:12px 16px;font-size:14px}
.lift.none{background:var(--fill);border-color:var(--border)}
.lift.zero{background:var(--warning-soft);border-color:var(--warning)}
.lift b{font-weight:600}
.lift p{margin:3px 0}
.lift .big{font:400 26px/1.15 var(--font-serif);color:var(--primary)}
.lift.zero .big{color:var(--warning)}
.cur{margin:0;padding:0 var(--pad) 8px}
.dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0 0 18px;border-top:1px dashed var(--border)}
.dl div{padding:12px var(--pad);border-bottom:1px dashed var(--border);border-right:1px dashed var(--border);min-width:0}
.dl div:nth-child(3n){border-right:0}
.dl dt{font:400 11px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.dl dd{margin:4px 0 0;font:400 26px/1.15 var(--font-serif)}
.pay{padding:0 var(--pad)}
.pay h3{font-size:20px}
.batches{list-style:none;margin:6px -12px 0;padding:0;font-size:14px}
.batches li{flex-wrap:wrap;gap:4px 14px}
.batches code{overflow-wrap:anywhere}
.how{margin:0;padding:0 var(--pad);max-width:70ch;color:var(--muted-foreground)}
.small{font-size:13px;color:var(--muted-foreground)}
.cta{margin:20px 0 0}
@media (max-width:640px){:root{--pad:16px}.dl{grid-template-columns:repeat(2,minmax(0,1fr))}.dl div:nth-child(3n){border-right:1px dashed var(--border)}.dl div:nth-child(2n){border-right:0}}
`;

function measuredHtml(t: TestView, fixture: boolean): string {
  const m = t.measured;
  if (!m) {
    return fixture
      ? `<div class="lift none"><p><b>No measured lift for this test yet.</b> The pre-registered study measured another creator's version of this comparison, not this one, so nothing here is claimed for it.</p></div>`
      : `<div class="lift none"><p><b>New, not yet measured.</b> No study has run on this test. It reaches agents through the public MCP catalogue, and CITED only counts a lift it has measured.</p></div>`;
  }
  return `<div class="lift${m.credited ? "" : " zero"}"><p class="big num">${esc(pp(m.pp))} over the placebo</p>
<p class="num">80% lower bound ${esc(pp(m.lowerBoundPp))}. ${m.credited ? "The bound is above zero, so sales this test caused are credited." : "The bound is not above zero, so nothing is credited for this test."}</p>
<p class="num">In the test group ${esc(m.testBought)} agents bought the recommended product; in the placebo group ${esc(m.placeboBought)}. ${m.sessions} sessions, ${esc(m.label.toLowerCase())}.</p>
<p><a href="${esc(m.proofHref)}">See the pre-registered study on /proof</a></p></div>`;
}

function testHtml(t: TestView, v: ProfileView): string {
  const own = t.disclosure && t.disclosure !== v.disclosure;
  return `<article class="test" aria-labelledby="t-${esc(t.id)}">
<h3 id="t-${esc(t.id)}">${esc(t.products.join(" vs "))}</h3>
<p class="meta"><span>${esc(t.category)}</span><span class="num">${t.date ? esc(t.date) : "Seeded sample test"}</span></p>
<p class="vd">Verdict: ${esc(t.verdict)}</p>
${t.summary ? `<p class="sum">${esc(t.summary)}</p>` : ""}
${own ? `<p class="small">Disclosure for this test: ${esc(t.disclosure)}</p>` : ""}
${measuredHtml(t, v.isFixture)}</article>`;
}

function ledgerHtml(v: ProfileView): string {
  if (!v.ledger.length)
    return `<p class="lede">Nothing earned yet: the ledger holds no credits for ${esc(v.name)}.${v.isFixture ? "" : " Sales made through the public MCP catalogue are never credited or paid."}</p>`;
  return v.ledger
    .map(
      (l) => `<p class="cur">${esc(l.currency)}</p><dl class="dl num">
<div><dt>Earned</dt><dd>${esc(l.earned)}</dd></div>
<div><dt>Paid</dt><dd>${esc(l.paid)}</dd></div>
<div><dt>Waiting out the ${HOLD_DAYS}-day hold</dt><dd>${esc(l.waiting)}</dd></div>
<div><dt>Frozen by a dispute</dt><dd>${esc(l.frozen)}</dd></div>
<div><dt>Held for review</dt><dd>${esc(l.held)}</dd></div>
<div><dt>Voided by refunds</dt><dd>${esc(l.voided)}</dd></div></dl>`,
    )
    .join("");
}

export function renderProfile(v: ProfileView): string {
  const batches = v.payouts.length
    ? `<div class="pay"><h3>Payout batches</h3><ul class="batches">${v.payouts
        .map(
          (p) =>
            `<li class="ui-row"><code>${esc(p.batchId)}</code><span class="num">${esc(p.amount)}</span><span>${esc(p.status.toLowerCase())}</span><span class="num">${esc(p.date)}</span></li>`,
        )
        .join("")}</ul></div>`
    : `<p class="small pay">No payout batch has included ${esc(v.name)} yet.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(v.name)} · CITED creator</title>${siteMeta({ title: `${v.name} · CITED creator`, description: `${v.name}: published tests, credited sales and PayPal payouts on CITED.`, path: "/creators" })}
${SITE_HEAD_HTML}
<style>${SITE_THEME_CSS}${CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}</style></head><body class="site-col">${siteHeader("creators")}
<div class="ui-frame"><main id="main">
<section class="hero">
<p class="crumb ui-label"><a href="/creators">← Creators</a></p>
<h1>${esc(v.name)}</h1>
<p class="lede">A creator on CITED. ${v.tests.length} published ${v.tests.length === 1 ? "test" : "tests"}.</p>
${v.disclosure ? `<p class="disclosure"><b>Disclosure.</b> ${esc(v.disclosure)}</p>` : ""}
</section>
<section class="ui-band" aria-labelledby="tests-h"><h2 class="ui-band-h" id="tests-h">Published tests</h2>${v.tests.map((t) => testHtml(t, v)).join("")}</section>
<section class="ui-band" aria-labelledby="earn-h"><h2 class="ui-band-h" id="earn-h">Earned and paid</h2>${ledgerHtml(v)}${batches}</section>
<section class="ui-band" aria-labelledby="how-h"><h2 class="ui-band-h" id="how-h">How CITED pays</h2>
<p class="how">CITED pays only for sales a test caused. Some agents are shown the test, others a placebo from the same creator, and the difference in what they buy is the lift. Credits are ${COMMISSION_BPS / 100}% commission on the share of sales the lift explains, taken at the 80% lower bound of that lift, so a test that cannot be told apart from the placebo earns nothing. Credits wait ${HOLD_DAYS} days, are voided by refunds, are frozen while a dispute is open, then arrive in one PayPal Payouts batch.</p></section>
</main></div></body></html>`;
}

function notFoundHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Creator not found · CITED</title>${siteMeta({ title: "Creator not found · CITED", path: "/creators", noindex: true })}${SITE_HEAD_HTML}<style>${SITE_THEME_CSS}${CSS}${SITE_NAV_TOUCH_CSS}${SITE_HEADER_CSS}</style></head><body class="site-col">${siteHeader("creators")}<div class="ui-frame"><main id="main"><section class="hero"><p class="crumb ui-label">Error 404</p><h1>No creator here</h1><p class="lede">CITED has no creator with that address.</p><p class="cta"><a class="ui-btn ui-btn-solid" href="/creators">Back to creators</a></p></section></main></div></body></html>`;
}

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Content-Security-Policy": DEMO_PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cache-Control": "no-cache",
      "X-Frame-Options": "DENY",
    },
  });

export const profiles = new Hono<{ Bindings: Env }>();

profiles.get("/:creatorId", async (c) => {
  const raw = c.req.param("creatorId");
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(raw)) return html(notFoundHtml(), 404);
  const id = raw.toLowerCase() in FIXTURE_CREATORS ? raw.toLowerCase() : raw;
  const read = internalEngineFetch(c.env, c.executionCtx);
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await read(`https://engine.internal${CITED_PREFIX}/api${path}`);
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const fixture = FIXTURE_CREATORS[id];
  let name: string;
  let tests: ProfileInput["tests"];
  if (fixture) {
    name = fixture.name;
    tests = fixture.tests.map((test) => ({ test, publishedAt: null }));
  } else {
    const stored = await get<{
      tests: { test: VerifiedTest; creatorName: string | null; publishedAt: string }[];
    }>(`/tests?creatorId=${encodeURIComponent(id)}`);
    const rows = stored?.tests ?? [];
    if (!rows.length) return html(notFoundHtml(), 404);
    name = rows[0]?.creatorName || id;
    tests = rows.map((r) => ({ test: r.test, publishedAt: r.publishedAt }));
  }
  const credits = await get<{
    creators: { creatorId: string; totalsByCurrency?: Record<string, Totals> }[];
  }>(`/credits?creatorId=${encodeURIComponent(id)}`);
  const payouts = await get<{ batches: ProfileInput["batches"] }>("/payouts");
  const view = shapeProfile({
    creatorId: id,
    name,
    tests,
    ledger: credits?.creators.find((x) => x.creatorId === id),
    batches: payouts?.batches ?? [],
  });
  return html(renderProfile(view));
});
