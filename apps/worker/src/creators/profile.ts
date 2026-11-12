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
  SITE_HEADER_CSS,
  SITE_NAV_TOUCH_CSS,
  SITE_THEME_CSS,
  siteHeader,
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
    anchor: "secondary",
    label: "A close call, every agent made to choose",
  },
  [crumblabRoborockTest.id]: {
    study: study(vacuumSummary, "vacuum-parity-forced"),
    anchor: "vacuums",
    label: "Robot vacuums, same price, every agent made to choose",
  },
  [quietbenchBoseTest.id]: {
    study: study(headphoneSummary, "headphones-parity-forced"),
    anchor: "headphones",
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

const pp = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pp`;

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
@font-face{font-family:"Newsreader";font-style:normal;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-latin-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-mono-latin-v1.woff2") format("woff2-variations")}
:root{--serif:"Newsreader",Charter,Georgia,serif;--sans:"Geist",ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--mono:"Geist Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
html{font-size:18px;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit}
.num{font-variant-numeric:tabular-nums lining-nums}
main{max-width:900px;margin:0 auto;padding:40px clamp(16px,4vw,56px) 72px}
.crumb{font-size:.8rem;margin:0 0 1.2rem}
.crumb a{color:var(--muted)}
h1{font-family:var(--serif);font-weight:300;font-size:clamp(2.2rem,7vw,3.2rem);line-height:1.05;letter-spacing:-.02em;margin:0 0 .6rem;overflow-wrap:anywhere}
h2{font-family:var(--serif);font-weight:500;font-size:1.5rem;line-height:1.15;margin:0 0 .6rem}
h3{font-family:var(--serif);font-weight:500;font-size:1.2rem;line-height:1.2;margin:0 0 .4rem;overflow-wrap:anywhere}
.lede{margin:0 0 .4rem;color:var(--ink-2);max-width:40rem}
.disclosure{margin:1rem 0 0;padding:.7rem 1rem;border-left:3px solid var(--held);background:var(--held-tint);font-size:.85rem;max-width:42rem;overflow-wrap:anywhere}
.disclosure b{color:var(--held-ink)}
section{margin:2.6rem 0 0}
.test{padding:1.2rem 0;border-top:1px solid var(--line)}
.meta{display:flex;flex-wrap:wrap;gap:.2rem 1rem;font-size:.8rem;color:var(--muted);margin:0 0 .6rem}
.vd{font-weight:600;margin:0 0 .6rem}
.sum{font-family:var(--serif);font-size:1rem;line-height:1.4;margin:.4rem 0 .8rem;white-space:pre-wrap;overflow-wrap:anywhere}
.lift{background:var(--test-tint);border-top:3px solid var(--test);padding:.8rem 1rem;font-size:.85rem}
.lift.none{background:var(--raise);border-top-color:var(--line-strong)}
.lift.zero{background:var(--held-tint);border-top-color:var(--held)}
.lift b{font-weight:600}
.lift p{margin:.2rem 0}
.lift .big{font-family:var(--serif);font-size:1.5rem;line-height:1.1}
.dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:1rem 1.4rem;margin:0 0 1rem}
.dl div{border-top:1px solid var(--ink);padding-top:.4rem}
.dl dt{font-size:.75rem;color:var(--muted)}
.dl dd{margin:0;font-family:var(--serif);font-size:1.4rem}
.cur{font-size:.8rem;font-weight:600;margin:1.2rem 0 .4rem}
.batches{list-style:none;margin:.4rem 0 0;padding:0;font-size:.85rem}
.batches li{display:flex;flex-wrap:wrap;gap:.2rem 1rem;padding:.5rem 0;border-top:1px solid var(--line)}
.batches code{overflow-wrap:anywhere}
.how{max-width:42rem;font-size:.9rem}
.small{font-size:.8rem;color:var(--muted)}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:.6rem 1.4rem;border-radius:999px;text-decoration:none}
@media (max-width:600px){html{font-size:17px}main{padding-top:24px}}
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
    ? `<h3>Payout batches</h3><ul class="batches">${v.payouts
        .map(
          (p) =>
            `<li><code>${esc(p.batchId)}</code><span class="num">${esc(p.amount)}</span><span>${esc(p.status.toLowerCase())}</span><span class="num">${esc(p.date)}</span></li>`,
        )
        .join("")}</ul>`
    : `<p class="small">No payout batch has included ${esc(v.name)} yet.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(v.name)} · CITED creator</title><link rel="icon" href="/favicon.svg">
<style>${CSS}${SITE_NAV_TOUCH_CSS}${SITE_THEME_CSS}${SITE_HEADER_CSS}</style></head><body>${siteHeader("creators")}
<main id="main">
<p class="crumb"><a href="/creators">Creators</a></p>
<h1>${esc(v.name)}</h1>
<p class="lede">A creator on CITED. ${v.tests.length} published ${v.tests.length === 1 ? "test" : "tests"}.</p>
${v.disclosure ? `<p class="disclosure"><b>Disclosure.</b> ${esc(v.disclosure)}</p>` : ""}
<section aria-labelledby="tests-h"><h2 id="tests-h">Published tests</h2>${v.tests.map((t) => testHtml(t, v)).join("")}</section>
<section aria-labelledby="earn-h"><h2 id="earn-h">Earned and paid</h2>${ledgerHtml(v)}${batches}</section>
<section aria-labelledby="how-h"><h2 id="how-h">How CITED pays</h2>
<p class="how">CITED pays only for sales a test caused. Some agents are shown the test, others a placebo from the same creator, and the difference in what they buy is the lift. Credits are ${COMMISSION_BPS / 100}% commission on the share of sales the lift explains, taken at the 80% lower bound of that lift, so a test that cannot be told apart from the placebo earns nothing. Credits wait ${HOLD_DAYS} days, are voided by refunds, are frozen while a dispute is open, then arrive in one PayPal Payouts batch.</p></section>
</main></body></html>`;
}

function notFoundHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Creator not found · CITED</title><link rel="icon" href="/favicon.svg"><style>${CSS}${SITE_NAV_TOUCH_CSS}${SITE_THEME_CSS}${SITE_HEADER_CSS}</style></head><body>${siteHeader("creators")}<main id="main"><h1>No creator here</h1><p class="lede">CITED has no creator with that address.</p><p><a class="btn" style="background:var(--cream);color:var(--bg)" href="/creators">Back to creators</a></p></main></body></html>`;
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
