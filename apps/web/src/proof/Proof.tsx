import { type CSSProperties, type ReactNode, useState } from "react";
import { SiteHeader } from "../landing/SiteHeader";
import {
  blob,
  type Cell,
  commit,
  hypotheses,
  MODEL_NAMES,
  modelLift,
  PATHS,
  pct,
  pp,
  REPO,
  type StudyResult,
  studies,
  type Verdict,
} from "./data";
import { journeysCsv } from "./journeys";

/**
 * /proof: how CITED knows the test caused the sales. Every number is read from the
 * committed eval summaries at build time (./data.ts); data.test.ts pins them to the card.
 */

const S = studies;
const H = S.parityForced;

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
    <section id={id} className="section ui-band" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="ui-band-h">
        {kicker}
      </h2>
      <p className="section-title">{title}</p>
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
        <span className="fig-no">Fig. 1</span> Levoit priced the same as Winix; arms assigned at
        random.
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
        <span className="fig-no">Fig. 2</span> Only the pooled bound is used for pay.{" "}
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

function VerdictTag({ v }: { v: Verdict }) {
  return <span className={`verdict v-${v.replace(" ", "-")}`}>{v}</span>;
}

/* ---------- A second category: robot vacuums ---------- */

/* ---------- A third category: noise-cancelling headphones ---------- */

/* ---------- Money ---------- */

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
      <SiteHeader current="proof" skip column />

      <div className="ui-frame">
        <main id="main">
          <div className="wrap proof-hero">
            <div className="proof-hero-copy">
              <p className="kicker">The proof</p>
              <h1 className="h1">How we know the test caused the&nbsp;sales.</h1>
              <p className="lede">We withheld it at random, and counted what the agents bought.</p>
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

          <div className="bands">
            <Section
              id="result"
              kicker="The result"
              title="The lift was positive in every model."
              wide={<IntervalFigure />}
            >
              {null}
            </Section>

            <Section id="design" kicker="The design" title="Only the test changes between arms.">
              <div className="design">
                <div className="design-item">
                  <h3 className="h3">Three arms</h3>
                  <p>Test, a placebo from the same creator, or nothing.</p>
                </div>
                <div className="design-item">
                  <h3 className="h3">Identical ranking</h3>
                  <p>Listings never see the arm.</p>
                </div>
                <div className="design-item">
                  <h3 className="h3">Price-matched</h3>
                  <p>Same price at every seller, then $4 cheaper for the rival.</p>
                </div>
                <div className="design-item">
                  <h3 className="h3">Three model families</h3>
                  <p>GPT, Gemini and Claude, same payload and checkout tool.</p>
                </div>
              </div>
            </Section>

            <Section id="prereg" kicker="Pre-registered" title="Fixed before a single session ran.">
              <ol className="timeline timeline-wide">
                {TIMELINE.map((t) => (
                  <li key={t.sha} className={`tl tl-${t.kind}`}>
                    <span className="tl-time num">{t.utc}</span>
                    <span className="tl-what">{t.what}</span>
                    <span className="tl-refs">
                      <a className="src-link" href={commit(t.sha)}>
                        {t.sha.slice(0, 7)}
                      </a>
                    </span>
                  </li>
                ))}
              </ol>
            </Section>

            <Section id="secondary" kicker="Predictions" title="Every prediction, checked.">
              {(
                [
                  ["Price-matched study", h.priceMatched],
                  ["First study, Winix already cheaper", h.catalogue],
                ] as const
              ).map(([study, list]) => (
                <div key={study} className="hyp-group">
                  <p className="hyp-study">{study}</p>
                  <ul className="hyp-cards">
                    {list.map((x) => (
                      <li key={x.id} className={`hyp-card hv-${x.verdict.replace(" ", "-")}`}>
                        <span className="hyp-top">
                          <span className="hyp-id num">{x.id}</span>
                          <VerdictTag v={x.verdict} />
                        </span>
                        <span className="hyp-text">{x.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Section>

            <Section
              id="sandbox"
              kicker="On PayPal's sandbox"
              title="Every money step also ran on the PayPal sandbox."
            >
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
              </figure>
            </Section>

            <Section id="limits" kicker="Limitations" title="What this does not show.">
              <ul className="limits">
                <li>
                  <strong>Agents defer to verdicts.</strong> The lift mostly measures deference.
                </li>
                <li>
                  <strong>A small lab catalogue.</strong> Real catalogues with many rivals are
                  unmeasured.
                </li>
                <li>
                  <strong>Small cells.</strong> Pay uses only the pooled bound.
                </li>
                <li>
                  <strong>A lower limit.</strong> Agents that read the test elsewhere only shrink
                  the lift.
                </li>
              </ul>
            </Section>

            <Section id="data" kicker="The data" title="Every session, downloadable.">
              <ul className="downloads downloads-row">
                <li>
                  <a className="dl" href="/data/cited-eval-sessions.csv" download>
                    <span className="dl-title">
                      All eval sessions <span className="dl-fmt">CSV</span>
                    </span>
                  </a>
                </li>
                <li>
                  <a className="dl" href="/data/cited-eval-sessions.json" download>
                    <span className="dl-title">
                      All eval sessions <span className="dl-fmt">JSON</span>
                    </span>
                  </a>
                </li>
                <li>
                  <JourneysButton />
                </li>
              </ul>
            </Section>
          </div>
        </main>

        <footer className="foot ui-band">
          <p className="foot-line">
            <a href="/">CITED</a>, built for the PayPal AI Hackathon, 2026.{" "}
            <a href={REPO}>Source on GitHub</a>.
          </p>
        </footer>
      </div>
    </>
  );
}
