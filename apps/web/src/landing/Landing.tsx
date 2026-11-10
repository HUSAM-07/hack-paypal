import type { ReactNode } from "react";
import { FlowTall, FlowWide } from "./FlowDiagram";

/**
 * CITED landing. Every number on this page comes from cited/spec/CITED-card.md and
 * the committed eval summaries; each one carries a footnote to its source.
 */

const REPO = "https://github.com/HUSAM-07/hack-paypal";
const blob = (path: string) => `${REPO}/blob/main/${path}`;

const SOURCES = [
  {
    id: "src-1",
    text: "US affiliate marketing spend per year, eMarketer, as cited in the CITED card.",
    href: blob("cited/spec/CITED-card.md"),
    label: "cited/spec/CITED-card.md",
  },
  {
    id: "src-2",
    text: "Measured. Pre-registered price-matched eval, purifier-parity-forced: 147 sessions, Levoit priced like Winix at every seller.",
    href: blob("packages/evals/results/cited-price-matched/summary.md"),
    label: "packages/evals/results/cited-price-matched/summary.md",
  },
  {
    id: "src-3",
    text: "Measured. Pre-registered eval at catalogue prices (Winix already cheaper), including the close-verdict test.",
    href: blob("packages/evals/results/cited/summary.md"),
    label: "packages/evals/results/cited/summary.md",
  },
  {
    id: "src-4",
    text: "Derived from the measured lower bound: 57 exposed sales × 90.3% = 51 units × $95.99 × 8%.",
    href: blob("cited/spec/CITED-card.md"),
    label: "cited/spec/CITED-card.md",
  },
  {
    id: "src-5",
    text: "Scripted for the demo: Lumen's $4 discount and the $1,000 deposit.",
    href: blob("cited/spec/CITED-packet.md"),
    label: "cited/spec/CITED-packet.md",
  },
] as const;

function Ref({ n }: { n: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <sup className="ref">
      <a href={`#src-${n}`} aria-label={`Source ${n}`}>
        {n}
      </a>
    </sup>
  );
}

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

const ARMS = [
  {
    label: "Shown the test",
    note: "HouseFresh: Winix A230 vs Levoit Core 300",
    count: "57 / 57",
    pct: 100,
    cls: "bar-test",
  },
  {
    label: "Placebo",
    note: "another HouseFresh article",
    count: "3 / 54",
    pct: 6,
    cls: "bar-placebo",
  },
  {
    label: "Nothing",
    note: "test withheld, nothing added",
    count: "3 / 36",
    pct: 8,
    cls: "bar-none",
  },
];

function ArmsFigure() {
  return (
    <figure className="fig fig-arms">
      <p className="fig-title">Agents that bought the Winix</p>
      <div className="fig-rows">
        {ARMS.map((a) => (
          <div key={a.label} className="arm-row">
            <div className="arm-label">
              <span className="arm-name">{a.label}</span>
              <span className="arm-note">{a.note}</span>
            </div>
            <div
              className="arm-track"
              role="img"
              aria-label={`${a.pct}% bought the Winix (${a.count})`}
            >
              <span className={`arm-bar ${a.cls}`} style={{ width: `${a.pct}%` }} />
            </div>
            <div className="arm-value num">
              <span className="arm-pct">{a.pct}%</span>
              <span className="arm-count">{a.count}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="lift num">
        <div>
          <span className="lift-value">+94pp</span>
          <span className="lift-label">lift, test vs placebo</span>
        </div>
        <div>
          <span className="lift-value">+90.3pp</span>
          <span className="lift-label">80% lower bound: what pays</span>
        </div>
      </div>
      <figcaption className="caption">
        <span className="fig-no">Fig. 1</span> 147 forced-buy sessions across GPT, Gemini and
        Sonnet, Levoit priced the same as Winix.
        <Ref n={2} />
      </figcaption>
    </figure>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "A brand funds a category, never a verdict.",
    body: (
      <>
        Winix and Levoit each deposit into the purifier programme. Creators choose the rivals and
        write the verdict. Each brand pays only for its own lifted units, so an honest &ldquo;buy
        the rival&rdquo; verdict still earns.
      </>
    ),
  },
  {
    title: "The catalogue randomises what agents see.",
    body: (
      <>
        PayPal's agent catalogue shows each shopping session the creator's test, a placebo from the
        same creator, or nothing: 50/50 for a test's first 7 days, then a permanent 5% holdout. Only
        the test is added or withheld. <strong>Ranking never changes.</strong>
      </>
    ),
  },
  {
    title: "The passport travels with the sale.",
    body: (
      <>
        The catalogue signs an Agent Affiliate Passport. The shopping agent checks out through
        PayPal itself, with the buyer's saved PayPal and the seller as payee, and puts the passport
        in Orders v2 <code>purchase_units[].custom_id</code>, so the capture joins the sale to its
        arm even when another seller gets paid. No storefront, no redirect, nothing for the seller
        to install. In the demo, all 57 exposed Winix buys settled at Lumen, $4 cheaper
        <Ref n={5} />, not Northwind, whose offer carried the test.
      </>
    ),
  },
  {
    title: "The engine pays only what the test caused.",
    body: (
      <>
        Credit is the attributable fraction at its 80% lower bound, at 8% commission, split by
        Shapley value across co-exposed creators. Credits wait 30 days; refunds and disputes void
        them. Then one batch Payout pays the creators and the unspent deposit is refunded.
      </>
    ),
  },
];

const MODELS = [
  { name: "GPT", lift: "+89pp" },
  { name: "Gemini", lift: "+100pp" },
  { name: "Sonnet", lift: "+94pp" },
];

const LEDGER: { label: string; value: string; kind?: "sub" | "void" | "total" | "return" }[] = [
  { label: "Exposed Winix sales", value: "57" },
  { label: "× attributable fraction, 80% lower bound", value: "90.3%" },
  { label: "Credited units", value: "51", kind: "sub" },
  { label: "× $95.99 × 8% commission", value: "$391.64" },
  {
    label: "A buyer returns one Winix: its pending credit is voided",
    value: "−$7.68",
    kind: "void",
  },
  { label: "Paid to HouseFresh on day 30, by batch Payout", value: "$383.96", kind: "total" },
  { label: "Returned to Winix from its $1,000 deposit", value: "$616.04", kind: "return" },
  { label: "Levoit: no lift, so no credit", value: "$0.00", kind: "return" },
];

const TRY = [
  {
    href: "/console?clean=1",
    title: "Two agents, side by side",
    body: "Same request. One sees the test and buys the Winix; the held-out one buys the Levoit.",
  },
  {
    href: "/console/payout?clean=1",
    title: "The payout",
    body: "Day 30: the voided refund, the batch Payout to HouseFresh, the deposit returned to Winix.",
  },
  {
    href: "/try",
    title: "Run an agent yourself",
    body: "Type what the buyer wants. A live agent shops, pays a seller through PayPal, and the engine decides whether the creator earns.",
  },
  {
    href: "/studio",
    title: "Studio dashboards",
    body: "The brand and creator views of the same ledger.",
  },
  {
    href: REPO,
    title: "Source on GitHub",
    body: "Engine, catalogue, agent checkout, evals, and every number on this page.",
  },
];

export function Landing() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <div className="wrap top-inner">
          <a className="wordmark" href="/">
            CITED
          </a>
          <nav aria-label="Sections" className="top-nav">
            <a href="#how" className="hide-sm">
              How it works
            </a>
            <a href="#proof" className="hide-sm">
              Proof
            </a>
            <a href="#money" className="hide-sm">
              Payout
            </a>
            <a href="/console?clean=1" className="top-cta">
              Live demo
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        <div className="wrap hero">
          <div className="hero-copy">
            <p className="kicker">Built on PayPal Orders, webhooks and Payouts</p>
            <h1 className="h1">PayPal's affiliate network, rebuilt for AI&nbsp;agents.</h1>
            <p className="lede">It pays creators on proven lift, not last-click cookies.</p>
            <div className="ctas">
              <a className="btn btn-primary" href="/console?clean=1">
                Watch two agents shop
              </a>
              <a className="btn btn-quiet" href="/console/payout?clean=1">
                See the payout
              </a>
            </div>
          </div>
          <ArmsFigure />
        </div>

        <div className="wrap">
          <Section id="problem" kicker="The problem" title="Agents read. They never click.">
            <div className="prose two-col">
              <p>
                Affiliate marketing is a $13.81B a year business in the US
                <Ref n={1} />, and it pays per click. An AI shopping agent reads a creator's product
                test, decides, and buys wherever the price is best. No link is clicked, no cookie is
                set, and the creator who did the testing is paid nothing.
              </p>
              <p>
                Last-click credit was always easy to overwrite; with agents it disappears. What a
                creator can still prove is that their test <em>changed what agents bought</em>. That
                proof needs a holdout, not a cookie.
              </p>
            </div>
          </Section>

          <Section
            id="how"
            kicker="How it works"
            title="Four steps from a review to a payout."
            wide={
              <figure className="fig fig-flow">
                <div className="flow-frame">
                  <FlowWide />
                  <FlowTall />
                </div>
                <figcaption className="caption">
                  <span className="fig-no">Fig. 2</span> The sale's path. The catalogue assigns an
                  arm and signs the passport; the agent pays the seller through PayPal with the
                  passport in tow to the engine, which pays the creator.
                </figcaption>
              </figure>
            }
          >
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="step">
                  <span className="step-no num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="h3">{s.title}</h3>
                    <p className="step-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="proof" kicker="The proof" title="Measured on three models, pre-registered.">
            <div className="proof">
              <div className="prose">
                <p>
                  In 147 agent sessions with the Winix and Levoit priced the same, agents shown
                  HouseFresh's test chose the Winix 94 points more often than agents shown other
                  HouseFresh content. The lower bound, +90.3pp, is what pays.
                  <Ref n={2} />
                </p>
                <p>
                  Agents otherwise default to the Levoit and flip when a test names the Winix, so
                  this mostly measures deference to an explicit verdict. When the Winix was already
                  the cheaper one, the lift fell to +24pp; a close-verdict test moved nothing and
                  paid $0.
                  <Ref n={3} /> Agents that read the test elsewhere only shrink the measured lift,
                  so pay is a floor.
                </p>
              </div>
              <figure className="fig fig-models">
                <table className="table num">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col">Lift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODELS.map((m) => (
                      <tr key={m.name}>
                        <th scope="row">{m.name}</th>
                        <td className="pos">{m.lift}</td>
                      </tr>
                    ))}
                    <tr className="row-total">
                      <th scope="row">Pooled, model-stratified</th>
                      <td className="pos">+94pp</td>
                    </tr>
                    <tr>
                      <th scope="row">80% lower bound</th>
                      <td className="pos">+90.3pp</td>
                    </tr>
                  </tbody>
                </table>
                <figcaption className="caption">
                  <span className="fig-no">Table 1</span> Lift by model, test vs placebo,
                  price-matched study.
                  <Ref n={2} />
                </figcaption>
              </figure>
            </div>
          </Section>

          <Section
            id="money"
            kicker="The payout"
            title="Only caused sales are paid. The rest goes back."
          >
            <figure className="fig fig-ledger">
              <table className="ledger num">
                <tbody>
                  {LEDGER.map((r) => (
                    <tr key={r.label} className={r.kind ? `l-${r.kind}` : undefined}>
                      <th scope="row">{r.label}</th>
                      <td>{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <figcaption className="caption">
                <span className="fig-no">Table 2</span> The demo ledger for HouseFresh's purifier
                test.
                <Ref n={4} />
                <Ref n={5} />
              </figcaption>
            </figure>
            <p className="note">
              Money never buys rank or verdicts. Brands fund a category; funding buys measurement of
              which tests move agents.
            </p>
          </Section>

          <Section id="try" kicker="Try it" title="Everything here runs live.">
            <ul className="try">
              {TRY.map((t) => (
                <li key={t.href}>
                  <a className="try-link" href={t.href}>
                    <span className="try-title">
                      {t.title}
                      <span className="try-arrow" aria-hidden="true">
                        →
                      </span>
                    </span>
                    <span className="try-body">{t.body}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </main>

      <footer className="foot">
        <div className="wrap">
          <h2 className="foot-h">Sources</h2>
          <ol className="sources">
            {SOURCES.map((s) => (
              <li key={s.id} id={s.id}>
                {s.text}{" "}
                <a href={s.href} className="src-link">
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
          <p className="foot-line">CITED, built for the PayPal AI Hackathon, 2026.</p>
        </div>
      </footer>
    </>
  );
}
