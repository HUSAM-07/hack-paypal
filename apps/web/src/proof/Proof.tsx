import { type CSSProperties, type ReactNode, useState } from "react";
import { SiteHeader } from "../landing/SiteHeader";
import {
  blob,
  type Cell,
  commit,
  headphoneChain,
  headphoneHypotheses,
  hypotheses,
  MODEL_NAMES,
  modelLift,
  moneyChain,
  PATHS,
  pct,
  pp,
  REPO,
  type StudyResult,
  studies,
  usd,
  type Verdict,
  vacuumChain,
  vacuumHypotheses,
} from "./data";
import { journeysCsv } from "./journeys";

/**
 * /proof: how CITED knows the test caused the sales. Every number is read from the
 * committed eval summaries at build time (./data.ts); data.test.ts pins them to the card.
 */

const S = studies;
const H = S.parityForced;
/** Every session in the downloads: the sum of the committed summaries. */
const ALL_SESSIONS =
  S.parityForced.sessions +
  S.parityAbstain.sessions +
  S.cheaperForced.sessions +
  S.cheaperAbstain.sessions +
  S.catalogueForced.sessions +
  S.catalogueAbstain.sessions +
  S.narrowForced.sessions +
  S.vacuumParityForced.sessions +
  S.vacuumParityAbstain.sessions +
  S.vacuumCheaperForced.sessions +
  S.vacuumCheaperAbstain.sessions +
  S.headphoneParityForced.sessions +
  S.headphoneParityAbstain.sessions +
  S.headphoneCheaperForced.sessions +
  S.headphoneCheaperAbstain.sessions;
const money = moneyChain();

function Section({
  id,
  kicker,
  title,
  children,
  wide,
}: {
  id: string;
  kicker: string;
  title: ReactNode;
  children: ReactNode;
  wide?: ReactNode;
}) {
  return (
    <section id={id} className="section" aria-labelledby={`${id}-h`}>
      <div className="section-head">
        <p className="kicker">{kicker}</p>
        <h2 id={`${id}-h`} className="h2">
          {title}
        </h2>
      </div>
      <div className="section-body">{children}</div>
      {wide ? <div className="section-wide">{wide}</div> : null}
    </section>
  );
}

function Src({ path, children }: { path: string; children?: ReactNode }) {
  return (
    <a className="src-link" href={blob(path)}>
      {children ?? path}
    </a>
  );
}

/* ---------- The PayPal sandbox runs (ids only; see cited/SANDBOX-EVIDENCE.md) ---------- */

const SANDBOX_RUNS: { step: string; api: string; id: string; status: string }[] = [
  {
    step: "Buyer links PayPal to the agent once",
    api: "Vault v3: setup token → payment token",
    id: "order 50542347YD822594J",
    status: "COMPLETED",
  },
  {
    step: "Agent pays the seller, passport in custom_id",
    api: "Orders v2, payment_source.paypal.vault_id",
    id: "8E6030344K4198450 · 8F195714E6441535R · 4XV50799SF6195530",
    status: "COMPLETED",
  },
  {
    step: "Brand funds the programme",
    api: "Orders v2 capture",
    id: "capture 1RW3974186481415R",
    status: "COMPLETED",
  },
  {
    step: "Seller refunds a sale; its credit is voided",
    api: "Payments v2 refund, Agent Toolkit",
    id: "refund 81C245246C527113H",
    status: "COMPLETED",
  },
  {
    step: "PayPal tells CITED, signature verified",
    api: "Webhooks, SHA256withRSA",
    id: "7 events on subscription 8042373202922840X",
    status: "verified",
  },
  {
    step: "A creator connects PayPal (the Payouts receiver)",
    api: "Log in with PayPal: code → token → userinfo",
    id: "payer id returned (not shown)",
    status: "verified",
  },
  {
    step: "HouseFresh paid $383.96",
    api: "Payouts v1, batch",
    id: "batch ME2KV57B7KYNS",
    status: "SUCCESS",
  },
  {
    step: "Engine's own payout run",
    api: "Payouts v1, recipient PAYPAL_ID",
    id: "batch GB9U5DYBGHLY4",
    status: "SUCCESS",
  },
  {
    step: "Winix's statement, settled against the deposit",
    api: "Invoicing v2",
    id: "INV2-TNXC-9GA6-W36V-WTF6",
    status: "MARKED_AS_PAID",
  },
];

/* ---------- Fig. 1: every session of the headline study ---------- */

const ARMS = [
  { key: "test", label: "Shown the test", note: "HouseFresh: Winix A230 vs Levoit Core 300" },
  { key: "placebo", label: "Placebo", note: "another HouseFresh article" },
  { key: "none", label: "Nothing", note: "no creator content" },
] as const;

function Squares({ cell, label }: { cell: Cell; label: string }) {
  return (
    <span
      className="sq-run"
      role="img"
      aria-label={`${label}: ${cell.target} of ${cell.sessions} bought the Winix`}
    >
      {Array.from({ length: cell.sessions }, (_, i) => (
        // Squares are interchangeable: position carries no information.
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, never reordered
        <span key={i} className={i < cell.target ? "sq sq-on" : "sq"} />
      ))}
    </span>
  );
}

function SessionsFigure() {
  return (
    <figure className="fig sessions">
      <div className="sessions-head">
        <p className="fig-title">147 shopping sessions, one square each</p>
        <p className="legend">
          <span className="sq sq-on" aria-hidden="true" /> bought the Winix
          <span className="sq" aria-hidden="true" /> bought the Levoit
        </p>
      </div>
      <div className="arms">
        {ARMS.map((arm) => {
          const pooled = H.pooled[arm.key];
          return (
            <div key={arm.key} className={`arm arm-${arm.key}`}>
              <div className="arm-top">
                <div>
                  <p className="arm-name">{arm.label}</p>
                  <p className="arm-note">{arm.note}</p>
                </div>
                <p className="arm-share num">
                  <span>{pct(pooled.target, pooled.sessions)}</span>
                  <span className="arm-count">
                    {pooled.target} / {pooled.sessions}
                  </span>
                </p>
              </div>
              <div className="arm-models">
                {H.byModel.map((m) => (
                  <div key={m.model} className="arm-model">
                    <span className="arm-model-name">{MODEL_NAMES[m.model]}</span>
                    <Squares
                      cell={m[arm.key]}
                      label={`${MODEL_NAMES[m.model]}, ${arm.label.toLowerCase()}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="caption">
        <span className="fig-no">Fig. 1</span> The headline study: Levoit priced the same as Winix
        at every seller, each agent required to buy one purifier. Arms assigned by a seeded plan;
        the listings were identical in all three. <Src path={PATHS.priceSummary}>summary.md</Src>
      </figcaption>
    </figure>
  );
}

/* ---------- Fig. 2: every estimate with its one-sided 80% bound ---------- */

const AXIS_MIN = -0.2;
const AXIS_MAX = 1.0;
const at = (v: number) =>
  `${((Math.min(AXIS_MAX, Math.max(AXIS_MIN, v)) - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * 100}%`;
const TICKS = [-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0];

interface Row {
  label: string;
  sub?: string;
  lift: number;
  bound: number;
  se?: number;
  strong?: boolean;
}

function rowsFor(s: StudyResult, label: string, sub: string, strong = false): Row[] {
  return [
    { label, sub, lift: s.lift.lift, bound: s.lift.lowerBound, se: s.lift.stdError, strong },
    ...s.byModel.map((m) => {
      const l = modelLift(s, m.model);
      return { label: MODEL_NAMES[m.model] ?? m.model, lift: l.lift, bound: l.lowerBound };
    }),
  ];
}

const GROUPS: { title: string; note: string; rows: Row[] }[] = [
  {
    title: "Price-matched: Levoit priced like Winix",
    note: "The headline.",
    rows: rowsFor(H, "Pooled", `${H.sessions} sessions, forced`, true),
  },
  {
    title: "Price-matched: Levoit $4 cheaper",
    note: "The test has to beat a price disadvantage.",
    rows: [
      {
        label: "Pooled",
        sub: `${S.cheaperForced.sessions} sessions, forced`,
        lift: S.cheaperForced.lift.lift,
        bound: S.cheaperForced.lift.lowerBound,
        se: S.cheaperForced.lift.stdError,
      },
    ],
  },
  {
    title: "First study: Winix already cheaper",
    note: "Price decided most picks.",
    rows: rowsFor(S.catalogueForced, "Pooled", `${S.catalogueForced.sessions} sessions, forced`),
  },
  {
    title: "Second category, robot vacuums: Roomba priced like Roborock",
    note: "Same design, new creator and products.",
    rows: rowsFor(
      S.vacuumParityForced,
      "Pooled",
      `${S.vacuumParityForced.sessions} sessions, forced`,
    ),
  },
  {
    title: "Robot vacuums: Roomba $4 cheaper",
    note: "The test has to beat a price disadvantage.",
    rows: [
      {
        label: "Pooled",
        sub: `${S.vacuumCheaperForced.sessions} sessions, forced`,
        lift: S.vacuumCheaperForced.lift.lift,
        bound: S.vacuumCheaperForced.lift.lowerBound,
        se: S.vacuumCheaperForced.lift.stdError,
      },
    ],
  },
  {
    title: "Third category, headphones: Sony priced like Bose, listed first",
    note: "The tested pick is listed second.",
    rows: rowsFor(
      S.headphoneParityForced,
      "Pooled",
      `${S.headphoneParityForced.sessions} sessions, forced`,
    ),
  },
  {
    title: "Headphones: Sony $4 cheaper",
    note: "The test has to beat a price disadvantage.",
    rows: [
      {
        label: "Pooled",
        sub: `${S.headphoneCheaperForced.sessions} sessions, forced`,
        lift: S.headphoneCheaperForced.lift.lift,
        bound: S.headphoneCheaperForced.lift.lowerBound,
        se: S.headphoneCheaperForced.lift.stdError,
      },
    ],
  },
  {
    title: "Close verdict: two near-identical purifiers",
    note: "The test names no clear winner.",
    rows: [
      {
        label: "Pooled",
        sub: `${S.narrowForced.sessions} sessions, forced`,
        lift: S.narrowForced.lift.lift,
        bound: S.narrowForced.lift.lowerBound,
        se: S.narrowForced.lift.stdError,
      },
    ],
  },
];

function IntervalRow({ r }: { r: Row }) {
  const pays = r.bound > 0;
  const style = (left: number, right?: number): CSSProperties =>
    right === undefined
      ? { left: at(left) }
      : { left: at(left), width: `calc(${at(right)} - ${at(left)})` };
  return (
    <div className={`iv-row${r.strong ? " iv-strong" : ""}${pays ? "" : " iv-nopay"}`}>
      <div className="iv-label">
        <span className="iv-name">{r.label}</span>
        {r.sub ? <span className="iv-sub">{r.sub}</span> : null}
      </div>
      <div
        className="iv-track"
        role="img"
        aria-label={`${r.label}: lift ${pp(r.lift)}, 80% lower bound ${pp(r.bound)}`}
      >
        {/* One-sided interval: everything right of the bound, shaded to the edge. */}
        <span className="iv-band" style={style(r.bound, AXIS_MAX)} />
        {r.se !== undefined ? (
          <span className="iv-se" style={style(r.lift - r.se, r.lift + r.se)} />
        ) : null}
        <span className="iv-bound" style={style(r.bound)} />
        <span className="iv-dot" style={style(r.lift)} />
      </div>
      <div className="iv-nums num">
        <span className="iv-lift">{pp(r.lift)}</span>
        <span className="iv-lb">{pp(r.bound)}</span>
      </div>
    </div>
  );
}

function IntervalFigure() {
  return (
    <figure className="fig iv">
      <div className="iv-head">
        <p className="fig-title">Lift over the placebo, with its 80% lower bound</p>
        <div className="iv-keys num" aria-hidden="true">
          <span>lift</span>
          <span>bound</span>
        </div>
      </div>
      <div className="iv-axis" aria-hidden="true">
        <div className="iv-label" />
        <div className="iv-ticks">
          {TICKS.map((t) => (
            <span
              key={t}
              className={t === 0 ? "iv-tick iv-zero" : "iv-tick"}
              style={{ left: at(t) }}
            >
              {t === 0 ? "0" : pp(t, 0)}
            </span>
          ))}
        </div>
        <div className="iv-nums" />
      </div>
      {GROUPS.map((g) => (
        <div key={g.title} className="iv-group">
          <p className="iv-group-title">
            {g.title} <span>{g.note}</span>
          </p>
          {g.rows.map((r) => (
            <IntervalRow key={`${g.title}-${r.label}`} r={r} />
          ))}
        </div>
      ))}
      <div className="iv-legend">
        <span>
          <span className="lg-dot" aria-hidden="true" /> measured lift
        </span>
        <span>
          <span className="lg-se" aria-hidden="true" /> ±1 standard error (pooled rows)
        </span>
        <span>
          <span className="lg-band" aria-hidden="true" /> one-sided 80% interval, open to the right;
          its left edge is what pays
        </span>
        <span>
          <span className="lg-band lg-nopay" aria-hidden="true" /> bound at or below zero: pays $0
        </span>
      </div>
      <figcaption className="caption">
        <span className="fig-no">Fig. 2</span> Pooled rows are the model-stratified estimates from
        the summaries. Per-model rows run each model's committed counts through the same{" "}
        <code>computeLift</code>, alone; with 18 or 19 sessions per arm their bounds are wide, so
        only the pooled bound is used for pay. <Src path={PATHS.priceSummaryJson}>summary.json</Src>{" "}
        · <Src path={PATHS.catalogueSummaryJson}>first study</Src> ·{" "}
        <Src path={PATHS.vacuumSummaryJson}>robot vacuums</Src> ·{" "}
        <Src path={PATHS.headphoneSummaryJson}>headphones</Src> ·{" "}
        <Src path={PATHS.lift}>lift.ts</Src>
      </figcaption>
    </figure>
  );
}

/* ---------- Pre-registration ---------- */

const TIMELINE = [
  {
    sha: "d83f7f586404d17e0cf02a348bc1e7a41d19d999",
    utc: "4 Nov 2026, 17:03 UTC",
    what: "Pre-registration of the first study committed",
    path: PATHS.catalogueReg,
    kind: "reg",
  },
  {
    sha: "62551e8b5e2bcff6857ade0ac5aca197cd33c4e0",
    utc: "17:11 UTC",
    what: "Its 375 sessions committed, unedited",
    path: PATHS.catalogueResults,
    kind: "result",
  },
  {
    sha: "8cd4bf622288edc9b57dbe4d6dad57c9feed4f28",
    utc: "17:20 UTC",
    what: "Price-matched study pre-registered",
    path: PATHS.priceReg,
    kind: "reg",
  },
  {
    sha: "abf9b860c87f8a1dda2ad3a5cbbe869d83ef68bd",
    utc: "17:29 UTC",
    what: "Its 588 sessions committed, unedited",
    path: PATHS.priceResults,
    kind: "result",
  },
  {
    sha: "cc25be8cfadb084f1f67fc8674d3b998cde7da71",
    utc: "12 Nov 2026, 05:09 UTC",
    what: "Robot-vacuum study pre-registered, with its code and fixtures",
    path: PATHS.vacuumReg,
    kind: "reg",
  },
  {
    sha: "5110d57991023c947bb3e57c54bab94203b1156a",
    utc: "05:18 UTC",
    what: "Its 588 sessions committed, unedited",
    path: PATHS.vacuumResults,
    kind: "result",
  },
  {
    sha: "b80d272e36ba727a0de7688762b74f0c354e6d34",
    utc: "12 Nov 2026, 07:46 UTC",
    what: "Headphone study pre-registered, with its code and fixtures",
    path: PATHS.headphoneReg,
    kind: "reg",
  },
  {
    sha: "7c77d47ac59b758f1e6f2e7a0b7cb28c5d88f447",
    utc: "07:54 UTC",
    what: "Its 588 sessions committed, unedited",
    path: PATHS.headphoneResults,
    kind: "result",
  },
] as const;

const FIXED: { term: string; value: ReactNode }[] = [
  {
    term: "Question",
    value:
      "Do agents shown a creator's test buy the tested brand more often than agents shown other content from the same creator?",
  },
  {
    term: "Arms",
    value: "Test, same-creator placebo, nothing. Assigned by a seeded plan, balanced per model.",
  },
  {
    term: "Sample",
    value: "Per model 19 test, 18 placebo, 12 nothing: 147 sessions per price condition.",
  },
  {
    term: "Models",
    value: (
      <>
        <code>gpt-6-luna</code>, <code>gemini-3.8-flash</code>, <code>claude-sonnet-5-5</code>,
        temperature 0.7, four buyer requests that name no brand.
      </>
    ),
  },
  {
    term: "Seeds",
    value: (
      <>
        <code>20261105</code> (first study), <code>20261106</code> (price-matched).
      </>
    ),
  },
  {
    term: "Outcome",
    value:
      "The session bought the Winix. Unparseable sessions retried up to three times, then excluded and counted. There were none.",
  },
  {
    term: "Statistic",
    value: (
      <>
        Model-stratified lift; one-sided 80% lower bound = lift − 0.8416 × SE. The code that pays
        creators: <Src path={PATHS.lift}>lift.ts</Src>.
      </>
    ),
  },
  {
    term: "Reporting",
    value:
      "Every number as measured, a failed hypothesis stated as failed, no session dropped or re-run after seeing outcomes.",
  },
];

function VerdictTag({ v }: { v: Verdict }) {
  return <span className={`verdict v-${v.replace(" ", "-")}`}>{v}</span>;
}

/* ---------- A second category: robot vacuums ---------- */

const V1 = S.vacuumParityForced;
const V2 = S.vacuumCheaperForced;

/** Only a positive number gets the "positive" colour; a null result is shown plainly. */
const liftClass = (x: number) => (x > 0 ? "pos" : undefined);

function SecondCategory() {
  const vh = vacuumHypotheses();
  const pays = V1.lift.lowerBound > 0;
  const v1Met = vh[0]?.verdict === "met";
  const flat = V1.lift.perModel
    .filter((m) => m.lift <= 0)
    .map((m) => MODEL_NAMES[m.model] ?? m.model);
  return (
    <Section id="vacuums" kicker="A second category" title="The same test, run on robot vacuums.">
      <div className="prose">
        <p>
          Everything above is one category, air purifiers. To check that the design is not a
          one-off, we pre-registered the same study for robot vacuums, with a different creator,
          different products and different buyer requests: the Roborock Q7 Max against the iRobot
          Roomba Combo j5, sold by the same three sellers at the same prices ($299.99, $295.99 and
          $302.99). The creator, CrumbLab, is fictional, and its test and placebo are illustrative
          text we wrote, not real measurements; what is measured is how agents respond. Same three
          models, same tools, same statistic, same thresholds. {V1.sessions * 4} sessions, in the
          order the <a href="#prereg">pre-registration</a> describes.
        </p>
        <p>
          With the two vacuums priced the same, the Roborock share was {V1.pooled.test.target}/
          {V1.pooled.test.sessions} with the test, {V1.pooled.placebo.target}/
          {V1.pooled.placebo.sessions} with the placebo and {V1.pooled.none.target}/
          {V1.pooled.none.sessions} with nothing: a lift of{" "}
          <strong className="num">{pp(V1.lift.lift)}</strong>, with an 80% lower bound of{" "}
          <strong className="num">{pp(V1.lift.lowerBound)}</strong>.{" "}
          {pays
            ? "The bound is above zero, so the engine credits CrumbLab for the sales the test caused, and only those."
            : "The bound is not above zero, so the engine would credit CrumbLab nothing."}
        </p>
        <p>
          This category behaves differently from the purifiers, and we report that as it is. Here
          agents already leaned towards the Roborock without a test: it was bought in{" "}
          {pct(V1.pooled.placebo.target, V1.pooled.placebo.sessions)} of placebo sessions and{" "}
          {pct(V1.pooled.none.target, V1.pooled.none.sessions)} of sessions with nothing shown (the
          Winix: {pct(H.pooled.placebo.target, H.pooled.placebo.sessions)} and{" "}
          {pct(H.pooled.none.target, H.pooled.none.sessions)}). At equal price it is also listed
          first, by the UPC tie-break that is the same in every arm. That leaves less for a test to
          add, so the lift is smaller and the credit shrinks with it: {vacuumChain.units} of 50
          sales are credited. The pre-registered V1 is {v1Met ? "met" : "not met"}
          {flat.length > 0
            ? `: ${flat.join(" and ")} bought the Roborock as often with the placebo as with the test, so the test did not beat the placebo in every model`
            : ""}
          . When the Roomba is $4 cheaper the default flips and the test matters again (below).
        </p>
      </div>
      <table className="table num result-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Test</th>
            <th scope="col">Placebo</th>
            <th scope="col">Nothing</th>
            <th scope="col">Lift</th>
          </tr>
        </thead>
        <tbody>
          {V1.byModel.map((m) => {
            const l = V1.lift.perModel.find((x) => x.model === m.model);
            return (
              <tr key={m.model}>
                <th scope="row">{MODEL_NAMES[m.model] ?? m.model}</th>
                <td>
                  {m.test.target}/{m.test.sessions}
                </td>
                <td>
                  {m.placebo.target}/{m.placebo.sessions}
                </td>
                <td>
                  {m.none.target}/{m.none.sessions}
                </td>
                <td className={l ? liftClass(l.lift) : undefined}>{l ? pp(l.lift) : "n/a"}</td>
              </tr>
            );
          })}
          <tr className="row-total">
            <th scope="row">Pooled, model-stratified</th>
            <td>
              {V1.pooled.test.target}/{V1.pooled.test.sessions}
            </td>
            <td>
              {V1.pooled.placebo.target}/{V1.pooled.placebo.sessions}
            </td>
            <td>
              {V1.pooled.none.target}/{V1.pooled.none.sessions}
            </td>
            <td className={liftClass(V1.lift.lift)}>{pp(V1.lift.lift)}</td>
          </tr>
          <tr>
            <th scope="row">Standard error · 80% lower bound</th>
            <td colSpan={3} />
            <td className={liftClass(V1.lift.lowerBound)}>
              ±{(V1.lift.stdError * 100).toFixed(1)} · {pp(V1.lift.lowerBound)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="secondary">
        <div>
          <h3 className="h3">Roomba $4 cheaper: {pp(V2.lift.lift)}</h3>
          <p>
            Roborock share {pct(V2.pooled.test.target, V2.pooled.test.sessions)} /{" "}
            {pct(V2.pooled.placebo.target, V2.pooled.placebo.sessions)} /{" "}
            {pct(V2.pooled.none.target, V2.pooled.none.sessions)} across the arms. Lift{" "}
            {pp(V2.lift.lift)}, bound {pp(V2.lift.lowerBound)}.
          </p>
        </div>
        <div>
          <h3 className="h3">When agents may decline</h3>
          <p>
            Priced the same, lift was {pp(S.vacuumParityAbstain.lift.lift)} (bound{" "}
            {pp(S.vacuumParityAbstain.lift.lowerBound)}); among buyers only,{" "}
            {pp(S.vacuumParityAbstainBuyers.lift.lift)} (bound{" "}
            {pp(S.vacuumParityAbstainBuyers.lift.lowerBound)}). With the Roomba $4 cheaper:{" "}
            {pp(S.vacuumCheaperAbstain.lift.lift)} overall,{" "}
            {pp(S.vacuumCheaperAbstainBuyers.lift.lift)} among buyers (bound{" "}
            {pp(S.vacuumCheaperAbstainBuyers.lift.lowerBound)}).
          </p>
        </div>
        <div>
          <h3 className="h3">What it would pay</h3>
          <p>
            Applied to 50 exposed Roborock sales at Lumen's $295.99 and a $3,000 deposit (scripted,
            like the purifiers' deposit), the same maths gives {vacuumChain.units} caused units and{" "}
            {usd(vacuumChain.commission.amountMinor)} of commission, with{" "}
            {usd(vacuumChain.refund.amountMinor)} of the deposit returned.{" "}
            {vacuumChain.units === 0
              ? "Nothing is credited without a lower bound above zero."
              : "That is computed from the lower bound, not the estimate."}
          </p>
        </div>
      </div>
      <div className="hyps">
        <table className="hyp-table">
          <caption className="fig-title">
            Robot-vacuum hypotheses, same thresholds as the purifier study
          </caption>
          <tbody>
            {vh.map((x) => (
              <tr key={x.id}>
                <th scope="row" className="num">
                  {x.id}
                </th>
                <td>{x.text}</td>
                <td>
                  <VerdictTag v={x.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="caption">
          <Src path={PATHS.vacuumReg}>PREREGISTRATION-ROBOT-VACUUM.md</Src> ·{" "}
          <Src path={PATHS.vacuumSummary}>summary.md</Src> ·{" "}
          <Src path={PATHS.vacuumFixtureTest}>the test</Src> and{" "}
          <Src path={PATHS.vacuumFixturePlacebo}>the placebo</Src>. Verdicts are computed on this
          page from the summaries.
        </p>
      </div>
    </Section>
  );
}

/* ---------- A third category: noise-cancelling headphones ---------- */

const N1 = S.headphoneParityForced;
const N2 = S.headphoneCheaperForced;

function ThirdCategory() {
  const nh = headphoneHypotheses();
  const n1Met = nh[0]?.verdict === "met";
  const pays = N1.lift.lowerBound > 0;
  const never = N1.byModel
    .filter((m) => m.placebo.target + m.none.target === 0)
    .map((m) => MODEL_NAMES[m.model] ?? m.model);
  const declinedAll = S.headphoneParityAbstain.byModel
    .filter(
      (m) =>
        m.placebo.declines + m.none.declines === m.placebo.sessions + m.none.sessions &&
        m.placebo.sessions + m.none.sessions > 0,
    )
    .map((m) => MODEL_NAMES[m.model] ?? m.model);
  return (
    <Section
      id="headphones"
      kicker="A third category"
      title="Again on headphones, with the tested pick listed second."
    >
      <div className="prose">
        <p>
          In the robot-vacuum study the tested product was also listed first at equal price, by the
          UPC tie-break. So we pre-registered the same study a third time, for noise-cancelling
          headphones, and turned the tie-break around: the Bose QuietComfort Headphones, the
          creator's pick, has the higher UPC, so at equal price the Sony WH-1000XM5 is listed first
          and the Bose second. The creator, QuietBench, is fictional, and its test and placebo are
          illustrative text we wrote, not real measurements; what is measured is how agents respond.
          New products, new creator, new buyer requests, the same three sellers at $349.99, $345.99
          and $352.99 for both pairs. Same three models, tools, statistic and thresholds.{" "}
          {N1.sessions * 4} sessions, in the order the <a href="#prereg">pre-registration</a>{" "}
          describes. Which product to test was our judgement before any session ran, written into
          the pre-registration.
        </p>
        <p>
          With the two headphones priced the same, the Bose share was {N1.pooled.test.target}/
          {N1.pooled.test.sessions} with the test, {N1.pooled.placebo.target}/
          {N1.pooled.placebo.sessions} with the placebo and {N1.pooled.none.target}/
          {N1.pooled.none.sessions} with nothing: a lift of{" "}
          <strong className="num">{pp(N1.lift.lift)}</strong>, with an 80% lower bound of{" "}
          <strong className="num">{pp(N1.lift.lowerBound)}</strong>.{" "}
          {pays
            ? "The bound is above zero, so the engine credits QuietBench for the sales the test caused, and only those."
            : "The bound is not above zero, so the engine would credit QuietBench nothing."}
        </p>
        <p>
          Without a test, agents leaned the other way from the robot vacuums: the Bose was bought in{" "}
          {pct(N1.pooled.placebo.target, N1.pooled.placebo.sessions)} of placebo sessions and{" "}
          {pct(N1.pooled.none.target, N1.pooled.none.sessions)} of sessions with nothing shown (the
          Roborock: {pct(V1.pooled.placebo.target, V1.pooled.placebo.sessions)} and{" "}
          {pct(V1.pooled.none.target, V1.pooled.none.sessions)})
          {never.length > 0 ? `, and ${never.join(" and ")} never bought it without the test` : ""}.
          Listed second, it had more to gain, and the test moved every model: the pre-registered N1
          is {n1Met ? "met" : "not met"}, and {headphoneChain.units} of 50 sales are credited,
          against {vacuumChain.units} for the vacuums. As with the purifiers, much of this is
          deference to an explicit verdict, in text we wrote; it does not show that the Bose is the
          better headphone.
        </p>
      </div>
      <table className="table num result-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Test</th>
            <th scope="col">Placebo</th>
            <th scope="col">Nothing</th>
            <th scope="col">Lift</th>
          </tr>
        </thead>
        <tbody>
          {N1.byModel.map((m) => {
            const l = N1.lift.perModel.find((x) => x.model === m.model);
            return (
              <tr key={m.model}>
                <th scope="row">{MODEL_NAMES[m.model] ?? m.model}</th>
                <td>
                  {m.test.target}/{m.test.sessions}
                </td>
                <td>
                  {m.placebo.target}/{m.placebo.sessions}
                </td>
                <td>
                  {m.none.target}/{m.none.sessions}
                </td>
                <td className={l ? liftClass(l.lift) : undefined}>{l ? pp(l.lift) : "n/a"}</td>
              </tr>
            );
          })}
          <tr className="row-total">
            <th scope="row">Pooled, model-stratified</th>
            <td>
              {N1.pooled.test.target}/{N1.pooled.test.sessions}
            </td>
            <td>
              {N1.pooled.placebo.target}/{N1.pooled.placebo.sessions}
            </td>
            <td>
              {N1.pooled.none.target}/{N1.pooled.none.sessions}
            </td>
            <td className={liftClass(N1.lift.lift)}>{pp(N1.lift.lift)}</td>
          </tr>
          <tr>
            <th scope="row">Standard error · 80% lower bound</th>
            <td colSpan={3} />
            <td className={liftClass(N1.lift.lowerBound)}>
              ±{(N1.lift.stdError * 100).toFixed(1)} · {pp(N1.lift.lowerBound)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="secondary">
        <div>
          <h3 className="h3">Sony $4 cheaper: {pp(N2.lift.lift)}</h3>
          <p>
            Bose share {pct(N2.pooled.test.target, N2.pooled.test.sessions)} /{" "}
            {pct(N2.pooled.placebo.target, N2.pooled.placebo.sessions)} /{" "}
            {pct(N2.pooled.none.target, N2.pooled.none.sessions)} across the three groups. Lift{" "}
            {pp(N2.lift.lift)}, bound {pp(N2.lift.lowerBound)}.
          </p>
        </div>
        <div>
          <h3 className="h3">When agents may decline</h3>
          <p>
            Priced the same, lift was {pp(S.headphoneParityAbstain.lift.lift)} (bound{" "}
            {pp(S.headphoneParityAbstain.lift.lowerBound)}); among buyers only,{" "}
            {pp(S.headphoneParityAbstainBuyers.lift.lift)} (bound{" "}
            {pp(S.headphoneParityAbstainBuyers.lift.lowerBound)}). With the Sony $4 cheaper:{" "}
            {pp(S.headphoneCheaperAbstain.lift.lift)} overall,{" "}
            {pp(S.headphoneCheaperAbstainBuyers.lift.lift)} among buyers (bound{" "}
            {pp(S.headphoneCheaperAbstainBuyers.lift.lowerBound)}).
            {declinedAll.length > 0
              ? ` ${declinedAll.join(" and ")} declined every placebo and nothing session when it could, so its comparison groups among buyers are empty and the buyers-only figure rests on the other models.`
              : ""}
          </p>
        </div>
        <div>
          <h3 className="h3">What it would pay</h3>
          <p>
            Applied to 50 exposed Bose sales at Lumen's $345.99 and a $3,000 deposit (scripted, like
            the other deposits), the same maths gives {headphoneChain.units} caused units and{" "}
            {usd(headphoneChain.commission.amountMinor)} of commission, with{" "}
            {usd(headphoneChain.refund.amountMinor)} of the deposit returned.{" "}
            {headphoneChain.units === 0
              ? "Nothing is credited without a lower bound above zero."
              : "That is computed from the lower bound, not the estimate."}
          </p>
        </div>
      </div>
      <div className="hyps">
        <table className="hyp-table">
          <caption className="fig-title">
            Headphone hypotheses, same thresholds as the other studies
          </caption>
          <tbody>
            {nh.map((x) => (
              <tr key={x.id}>
                <th scope="row" className="num">
                  {x.id}
                </th>
                <td>{x.text}</td>
                <td>
                  <VerdictTag v={x.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="caption">
          <Src path={PATHS.headphoneReg}>PREREGISTRATION-HEADPHONES.md</Src> ·{" "}
          <Src path={PATHS.headphoneSummary}>summary.md</Src> ·{" "}
          <Src path={PATHS.headphoneFixtureTest}>the test</Src> and{" "}
          <Src path={PATHS.headphoneFixturePlacebo}>the placebo</Src>. Verdicts are computed on this
          page from the summaries.
        </p>
      </div>
    </Section>
  );
}

/* ---------- Money ---------- */

const CHAIN: { label: ReactNode; value: string; kind?: "sub" | "total" | "void" | "muted" }[] = [
  {
    label: "Exposed Winix sales: one per agent shown the test",
    value: String(money.exposedSales),
  },
  {
    label: (
      <>
        × attributable fraction = bound ÷ exposed rate = {pp(H.lift.lowerBound)} ÷{" "}
        {Math.round(H.lift.exposedRate * 100)}%
      </>
    ),
    value: `${(money.fraction * 100).toFixed(1)}%`,
  },
  { label: "Caused units, rounded down", value: String(money.units), kind: "sub" },
  {
    label: `× $95.99 × ${money.commissionBps / 100}% commission, rounded once for the batch`,
    value: usd(money.commission),
  },
  {
    label: "A buyer returns one Winix: its pending credit is voided",
    value: "−$7.68",
    kind: "void",
  },
  { label: "Paid to HouseFresh after the 30-day hold", value: usd(money.paid), kind: "total" },
  { label: "Returned to Winix from its $1,000 deposit", value: usd(money.returned), kind: "muted" },
];

/* ---------- Downloads ---------- */

function JourneysButton() {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function download() {
    setState("busy");
    try {
      const res = await fetch("/api/cited/api/journeys?limit=200");
      if (!res.ok) throw new Error(`The engine answered ${res.status}.`);
      const csv = journeysCsv(await res.json());
      const url = URL.createObjectURL(new Blob([csv.text], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "cited-demo-journeys.csv";
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`${csv.rows} sales downloaded.`);
      setState("idle");
    } catch (e) {
      setMsg(
        `${e instanceof Error ? e.message : "Download failed."} The JSON link below has the same data.`,
      );
      setState("error");
    }
  }
  return (
    <>
      <button type="button" className="dl" onClick={download} disabled={state === "busy"}>
        <span className="dl-title">
          {state === "busy" ? "Fetching…" : "Hosted demo's sales"}{" "}
          <span className="dl-fmt">CSV</span>
        </span>
        <span className="dl-body">
          Read live from the engine: order, model, arm, seller, amount, credit state. The hosted
          demo runs scripted agents; these are not eval sessions.
        </span>
      </button>
      <p className={`dl-msg${state === "error" ? " dl-err" : ""}`} aria-live="polite">
        {msg}
      </p>
    </>
  );
}

/* ---------- Page ---------- */

export function Proof() {
  const h = hypotheses();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader current="proof" />

      <main id="main">
        <div className="wrap proof-hero">
          <div className="proof-hero-copy">
            <p className="kicker">The proof</p>
            <h1 className="h1">How we know the test caused the&nbsp;sales.</h1>
            <p className="lede">We withheld it at random, and counted what the agents bought.</p>
            <p className="hero-body">
              Same listings, same prices, same requests. The only thing that changed between arms
              was whether the agent saw HouseFresh's test. Agents shown it bought the Winix{" "}
              <strong className="num">{pp(H.lift.lift)}</strong> more often than agents shown other
              HouseFresh content, and creators are paid on the 80% lower bound,{" "}
              <strong className="num">{pp(H.lift.lowerBound)}</strong>.
            </p>
            <p className="hero-links">
              <a href="#data">Download every session</a>
              <span aria-hidden="true"> · </span>
              <a href={blob(PATHS.priceReg)}>Read the pre-registration</a>
              <span aria-hidden="true"> · </span>
              <a href="#sandbox">See it run on PayPal's sandbox</a>
            </p>
          </div>
          <SessionsFigure />
        </div>

        <div className="wrap">
          <Section id="prereg" kicker="Pre-registered" title="Fixed before a single session ran.">
            <div className="prereg">
              <dl className="fixed">
                {FIXED.map((f) => (
                  <div key={f.term} className="fixed-row">
                    <dt>{f.term}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="timeline-wrap">
                <p className="fig-title">The order, in the repository's history</p>
                <ol className="timeline">
                  {TIMELINE.map((t) => (
                    <li key={t.sha} className={`tl tl-${t.kind}`}>
                      <span className="tl-time num">{t.utc}</span>
                      <span className="tl-what">{t.what}</span>
                      <span className="tl-refs">
                        <a className="src-link" href={commit(t.sha)}>
                          {t.sha.slice(0, 7)}
                        </a>{" "}
                        <Src path={t.path}>{t.path.split("/").pop()}</Src>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="caption">
                  Each pre-registration was committed before its study's results. The price-matched
                  study was added after the first one showed price deciding most picks; the first
                  study's results stay as they were and are reported below. The robot-vacuum and
                  headphone studies repeat the price-matched design in a second and a third
                  category.
                </p>
              </div>
            </div>
          </Section>

          <Section id="design" kicker="The design" title="Only the test changes between arms.">
            <div className="design">
              <div className="design-item">
                <h3 className="h3">Three arms</h3>
                <p>
                  Each session is randomly assigned to one of three arms (groups). The{" "}
                  <strong>test</strong> arm sees HouseFresh's Winix A230 vs Levoit Core 300 test.
                  The <strong>placebo</strong> arm sees another HouseFresh article, so the creator's
                  name and reputation are present in both; only the test differs. The{" "}
                  <strong>nothing</strong> arm checks that the placebo itself is neutral.
                </p>
              </div>
              <div className="design-item">
                <h3 className="h3">Identical ranking</h3>
                <p>
                  The catalogue's listings never see the arm: price, then seller, then UPC. At equal
                  price the UPC tie-break lists the Winix first in every arm. That position
                  advantage is the same for all three arms, and disclosed rather than removed.
                </p>
              </div>
              <div className="design-item">
                <h3 className="h3">Price-matched</h3>
                <p>
                  Levoit is priced the same as Winix at each seller: Northwind $99.99, Lumen $95.99,
                  MegaMart $102.99. A second condition makes Levoit $4 cheaper, so the test has to
                  beat a price disadvantage.
                </p>
              </div>
              <div className="design-item">
                <h3 className="h3">Three model families</h3>
                <p>
                  {H.sessions} forced-buy sessions across gpt-6-luna, gemini-3.8-flash and
                  claude-sonnet-5-5, each agent given the same payload the catalogue's{" "}
                  <code>search_product</code> returns and a PayPal checkout tool. A second variant
                  lets the agent decline to buy.
                </p>
              </div>
            </div>
          </Section>

          <Section
            id="result"
            kicker="The result"
            title="The lift was positive in every model."
            wide={<IntervalFigure />}
          >
            <div className="prose">
              <p>
                Winix share was {H.pooled.test.target}/{H.pooled.test.sessions} with the test,{" "}
                {H.pooled.placebo.target}/{H.pooled.placebo.sessions} with the placebo and{" "}
                {H.pooled.none.target}/{H.pooled.none.sessions} with nothing. The placebo and
                nothing arms differ by {pp(H.placeboVsNone ?? 0)}, so the placebo carries no lift of
                its own. Invalid sessions: {H.invalid}.
              </p>
            </div>
            <table className="table num result-table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Test</th>
                  <th scope="col">Placebo</th>
                  <th scope="col">Nothing</th>
                  <th scope="col">Lift</th>
                </tr>
              </thead>
              <tbody>
                {H.byModel.map((m) => {
                  const l = H.lift.perModel.find((x) => x.model === m.model);
                  return (
                    <tr key={m.model}>
                      <th scope="row">
                        {MODEL_NAMES[m.model] ?? m.model}
                        {MODEL_NAMES[m.model] && MODEL_NAMES[m.model] !== m.model ? (
                          <span className="model-id"> {m.model}</span>
                        ) : null}
                      </th>
                      <td>
                        {m.test.target}/{m.test.sessions}
                      </td>
                      <td>
                        {m.placebo.target}/{m.placebo.sessions}
                      </td>
                      <td>
                        {m.none.target}/{m.none.sessions}
                      </td>
                      <td className="pos">{l ? pp(l.lift) : "n/a"}</td>
                    </tr>
                  );
                })}
                <tr className="row-total">
                  <th scope="row">Pooled, model-stratified</th>
                  <td>
                    {H.pooled.test.target}/{H.pooled.test.sessions}
                  </td>
                  <td>
                    {H.pooled.placebo.target}/{H.pooled.placebo.sessions}
                  </td>
                  <td>
                    {H.pooled.none.target}/{H.pooled.none.sessions}
                  </td>
                  <td className="pos">{pp(H.lift.lift)}</td>
                </tr>
                <tr>
                  <th scope="row">Standard error · 80% lower bound</th>
                  <td colSpan={3} />
                  <td className="pos">
                    ±{(H.lift.stdError * 100).toFixed(1)} · {pp(H.lift.lowerBound)}
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section
            id="secondary"
            kicker="The other studies"
            title="Where the test moved less, or nothing."
          >
            <div className="secondary">
              <div>
                <h3 className="h3">Winix already cheaper: {pp(S.catalogueForced.lift.lift)}</h3>
                <p>
                  In the first study the Winix was cheaper than the Levoit at every seller. Winix
                  share was{" "}
                  {pct(
                    S.catalogueForced.pooled.test.target,
                    S.catalogueForced.pooled.test.sessions,
                  )}{" "}
                  /{" "}
                  {pct(
                    S.catalogueForced.pooled.placebo.target,
                    S.catalogueForced.pooled.placebo.sessions,
                  )}{" "}
                  /{" "}
                  {pct(
                    S.catalogueForced.pooled.none.target,
                    S.catalogueForced.pooled.none.sessions,
                  )}{" "}
                  across the arms: price decided most picks, so the test had little to add. Lift{" "}
                  {pp(S.catalogueForced.lift.lift)}, bound {pp(S.catalogueForced.lift.lowerBound)}.
                  claude-sonnet-5-5 bought the Winix in all 18 placebo sessions, so its lift was
                  zero and the hypothesis that every model shows lift failed.
                </p>
              </div>
              <div>
                <h3 className="h3">Close verdict: {pp(S.narrowForced.lift.lift)}, paid $0</h3>
                <p>
                  A test of two near-identical purifiers with no clear winner moved nothing: lift{" "}
                  {pp(S.narrowForced.lift.lift)}, bound {pp(S.narrowForced.lift.lowerBound)}, zero
                  credited units. The caveat: the QuietMax was the cheaper of the two and won every
                  arm on price, {S.narrowForced.pooled.placebo.target}/
                  {S.narrowForced.pooled.placebo.sessions} even with the placebo, so this is weak
                  evidence about close verdicts and strong evidence only that the engine pays
                  nothing without a bound above zero.
                </p>
              </div>
              <div>
                <h3 className="h3">When agents may decline</h3>
                <p>
                  Price-matched, lift was {pp(S.parityAbstain.lift.lift)} (bound{" "}
                  {pp(S.parityAbstain.lift.lowerBound)}); among buyers only,{" "}
                  {pp(S.parityAbstainBuyers.lift.lift)} (bound{" "}
                  {pp(S.parityAbstainBuyers.lift.lowerBound)}). gemini-3.8-flash declined more often
                  without the test. In the first study it was {pp(S.catalogueAbstain.lift.lift)}{" "}
                  overall but {pp(S.catalogueAbstainBuyers.lift.lift)} among buyers (bound{" "}
                  {pp(S.catalogueAbstainBuyers.lift.lowerBound)}): the test made agents buy, not
                  switch brands.
                </p>
              </div>
            </div>

            <div className="hyps">
              <table className="hyp-table">
                <caption className="fig-title">
                  Pre-registered hypotheses, checked against the committed numbers
                </caption>
                <tbody>
                  {[...h.priceMatched, ...h.catalogue].map((x) => (
                    <tr key={x.id}>
                      <th scope="row" className="num">
                        {x.id}
                      </th>
                      <td>{x.text}</td>
                      <td>
                        <VerdictTag v={x.verdict} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="caption">
                P1 to P4: <Src path={PATHS.priceReg}>PREREGISTRATION-PRICE-MATCHED.md</Src>. H1 to
                H4: <Src path={PATHS.catalogueReg}>PREREGISTRATION.md</Src>. Verdicts are computed
                on this page from the summaries, not typed in.
              </p>
            </div>
          </Section>

          <SecondCategory />

          <ThirdCategory />

          <Section
            id="money"
            kicker="From bound to payout"
            title="Pay uses the lower bound, not the estimate."
          >
            <div className="prose">
              <p>
                The engine credits the share of exposed sales the test caused, at the lower bound
                rather than the point estimate. Applied to the demo's {money.exposedSales} exposed
                Winix sales:
              </p>
            </div>
            <figure className="fig fig-ledger">
              <table className="ledger num">
                <tbody>
                  {CHAIN.map((r) => (
                    <tr key={r.value} className={r.kind ? `l-${r.kind}` : undefined}>
                      <th scope="row">{r.label}</th>
                      <td>{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <figcaption className="caption">
                <span className="fig-no">Table 1</span> Computed here from the headline study with{" "}
                <Src path={PATHS.lift}>lift.ts</Src> and the ledger's batch rounding (
                <Src path={PATHS.ledger}>ledger.ts</Src>). The refund, the $95.99 price and the
                $1,000 deposit are scripted for the demo (<Src path={PATHS.card}>CITED-card.md</Src>
                ).
              </figcaption>
            </figure>
            <div className="prose">
              <p>
                The hosted demo moves this money through a simulated PayPal. The same $383.96 was
                also sent for real once, as a PayPal sandbox batch Payout (batch{" "}
                <code>ME2KV57B7KYNS</code>, status SUCCESS), with a sandbox invoice settling the
                brand's statement: <Src path="cited/SANDBOX-EVIDENCE.md">SANDBOX-EVIDENCE.md</Src>.
              </p>
            </div>
          </Section>

          <Section
            id="sandbox"
            kicker="On PayPal's sandbox"
            title="Every money step also ran on the PayPal sandbox."
          >
            <div className="prose">
              <p>
                The hosted demo uses a simulated PayPal so anyone can click through it without keys.
                Each step it simulates was also run against the PayPal sandbox through the engine's
                own code. These are the PayPal ids; credentials, emails and vault ids are left out.
              </p>
            </div>
            <figure className="fig fig-sandbox">
              <table className="ledger sandbox-runs">
                <thead>
                  <tr>
                    <th scope="col">Step</th>
                    <th scope="col">PayPal API</th>
                    <th scope="col">Sandbox id</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {SANDBOX_RUNS.map((r) => (
                    <tr key={r.step}>
                      <th scope="row">{r.step}</th>
                      <td>{r.api}</td>
                      <td>
                        <code>{r.id}</code>
                      </td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <figcaption className="caption">
                <span className="fig-no">Table 2</span> Run on 2026-11-10 and 11. The signed
                webhooks are listed live at{" "}
                <a className="src-link" href="/api/cited/api/webhook-proof">
                  /api/cited/api/webhook-proof
                </a>
                ; the full record, and the scripts that reproduce it, are in{" "}
                <Src path="cited/SANDBOX-EVIDENCE.md">SANDBOX-EVIDENCE.md</Src>.
              </figcaption>
            </figure>
          </Section>

          <Section id="limits" kicker="Limitations" title="What this does not show.">
            <ul className="limits">
              <li>
                <strong>Agents defer to verdicts.</strong> Without a test, agents default to the
                Levoit; shown a test that names the Winix, they flip. This mostly measures how far
                agents defer to an explicit verdict.
              </li>
              <li>
                <strong>A small lab setup.</strong> Three sellers, two products in each of three
                categories, four buyer requests each, our own fixtures. Lift in a real catalogue
                with many rivals is unmeasured.
              </li>
              <li>
                <strong>Not exactly reproducible.</strong> The plan is seeded; model sampling at
                temperature 0.7 is not. A re-run reproduces the design, not the outputs.
              </li>
              <li>
                <strong>Small cells.</strong> 18 or 19 sessions per model and arm. Per-model bounds
                are wide (Fig. 2), so pay uses only the pooled bound.
              </li>
              <li>
                <strong>The payout is a lower limit.</strong> A held-out agent that reads the test
                somewhere else still counts as held out, which can only shrink the measured lift.
              </li>
              <li>
                <strong>Earlier runs were weaker.</strong> Before these studies, earlier models
                pooled to {"+32pp"} with about zero lift when agents could decline (
                <Src path={PATHS.reference}>pooled-all-runs.txt</Src>). They are kept, not used.
              </li>
            </ul>
          </Section>

          <Section id="data" kicker="The data" title="Every session, downloadable.">
            <ul className="downloads">
              <li>
                <a className="dl" href="/data/cited-eval-sessions.csv" download>
                  <span className="dl-title">
                    All eval sessions <span className="dl-fmt">CSV</span>
                  </span>
                  <span className="dl-body">
                    {ALL_SESSIONS.toLocaleString("en-US")} sessions from the four studies (two
                    purifier, one robot vacuum, one headphones): arm, model, product bought, seller,
                    price, and the reason the agent gave the buyer.
                  </span>
                </a>
              </li>
              <li>
                <a className="dl" href="/data/cited-eval-sessions.json" download>
                  <span className="dl-title">
                    All eval sessions <span className="dl-fmt">JSON</span>
                  </span>
                  <span className="dl-body">The same rows, with their source files.</span>
                </a>
              </li>
              <li>
                <JourneysButton />
              </li>
              <li>
                <a className="dl" href="/api/cited/api/journeys?limit=200">
                  <span className="dl-title">
                    Hosted demo's sales <span className="dl-fmt">JSON</span>
                  </span>
                  <span className="dl-body">
                    <code>/api/cited/api/journeys</code>, as AG Studio reads it. Public{" "}
                    <code>/mcp</code> sales: <code>?source=mcp</code>.
                  </span>
                </a>
              </li>
            </ul>
            <p className="note-data">
              The CSV and JSON are generated at build time from the committed{" "}
              <Src path={PATHS.priceResults}>price-matched results</Src>,{" "}
              <Src path={PATHS.catalogueResults}>first-study results</Src>,{" "}
              <Src path={PATHS.vacuumResults}>robot-vacuum results</Src> and{" "}
              <Src path={PATHS.headphoneResults}>headphone results</Src>, which are the raw,
              unedited session records. <code>price_usd</code> is the listed price the session saw
              at that seller. Re-run the summaries with{" "}
              <code>npm run cited:summarize:price -w @pact/evals</code>.
            </p>
          </Section>
        </div>
      </main>

      <footer className="foot">
        <div className="wrap">
          <h2 className="foot-h">Sources</h2>
          <ol className="sources">
            {[
              PATHS.priceReg,
              PATHS.priceSummary,
              PATHS.catalogueReg,
              PATHS.catalogueSummary,
              PATHS.vacuumReg,
              PATHS.vacuumSummary,
              PATHS.headphoneReg,
              PATHS.headphoneSummary,
              PATHS.lift,
              PATHS.card,
            ].map((p) => (
              <li key={p}>
                <Src path={p} />
              </li>
            ))}
          </ol>
          <p className="foot-line">
            <a href="/">CITED</a>, built for the PayPal AI Hackathon, 2026.{" "}
            <a href={REPO}>Source on GitHub</a>.
          </p>
        </div>
      </footer>
    </>
  );
}
