import type { ReactNode } from "react";
import { FlowTall, FlowWide } from "./FlowDiagram";
import { type HowStep, HowTabs } from "./HowTabs";
import { SessionField } from "./SessionField";
import { SiteHeader } from "./SiteHeader";

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

/* Tab visuals: each restates its step's numbers, which all trace to the sources below. */
function VFund() {
  return (
    <div className="vis vis-fund">
      {["Winix", "Levoit"].map((b) => (
        <div key={b} className="vis-row">
          <span className="vis-chip">{b} deposit</span>
          <span className="vis-line" aria-hidden="true" />
          <span className="vis-chip vis-chip-on">Purifier programme</span>
        </div>
      ))}
      <p className="vis-foot">Funds a category. Never a creator, never a verdict.</p>
    </div>
  );
}

function VRandomise() {
  return (
    <div className="vis vis-rand">
      <div className="vis-split">
        <span className="vis-k">Days 1 to 7</span>
        <span className="vis-bar">
          <span className="vb-test" style={{ width: "50%" }}>
            test 50%
          </span>
          <span className="vb-hold" style={{ width: "50%" }}>
            held out 50%
          </span>
        </span>
      </div>
      <div className="vis-split">
        <span className="vis-k">Day 8 on</span>
        <span className="vis-bar">
          <span className="vb-test" style={{ width: "95%" }}>
            test 95%
          </span>
          <span className="vb-hold" style={{ width: "5%" }} title="held out 5%" />
        </span>
      </div>
      <p className="vis-foot">
        <span className="vis-ok" aria-hidden="true">
          ✓
        </span>{" "}
        Ranking identical in every arm
      </p>
    </div>
  );
}

function VPassport() {
  return (
    <pre className="vis vis-code">
      <span className="c-dim">POST /v2/checkout/orders</span>
      {"\npurchase_units[0]\n  payee      "}
      <span className="c-str">"lumen"</span>
      {"\n  custom_id  "}
      <span className="c-pass">"v1|s_8f2c|test|housefresh|northwind,lumen.sig"</span>
      {"\n\n"}
      <span className="c-dim">The capture joins the sale to its arm.</span>
    </pre>
  );
}

function VPay() {
  return (
    <ol className="vis vis-pay num">
      <li>
        <span>57 exposed sales × 90.3%</span>
        <b>51 units</b>
      </li>
      <li>
        <span>× $95.99 × 8%, held 30 days</span>
        <b>$391.64</b>
      </li>
      <li className="vp-void">
        <span>A refund voids one credit</span>
        <b>−$7.68</b>
      </li>
      <li className="vp-total">
        <span>Batch Payout to HouseFresh</span>
        <b>$383.96</b>
      </li>
    </ol>
  );
}

const STEPS: HowStep[] = [
  {
    tab: "Fund",
    visual: <VFund />,
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
    tab: "Randomise",
    visual: <VRandomise />,
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
    tab: "Passport",
    visual: <VPassport />,
    title: "The passport goes into the PayPal order.",
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
    tab: "Pay",
    visual: <VPay />,
    title: "The engine pays only what the test caused.",
    body: (
      <>
        Credit is the attributable fraction at its 80% lower bound, at 8% commission, split by
        Shapley value across co-exposed creators. Credits wait 30 days; refunds void them, and a
        dispute holds them until PayPal decides. Then one batch Payout pays the creators and the
        unspent deposit is refunded.
      </>
    ),
  },
];

const MODELS = [
  // Names exactly as recorded in packages/evals/results/cited-price-matched/results.jsonl.
  { name: "gpt-6-luna", lift: "+89pp" },
  { name: "gemini-3.8-flash", lift: "+100pp" },
  { name: "claude-sonnet-5-5", lift: "+94pp" },
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

const MCP_URL = "https://pact-worker.vincent-wesley-liem.workers.dev/mcp";

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
    href: "/proof",
    title: "The proof",
    body: "The pre-registration, every interval, and every eval session to download.",
  },
  {
    href: "/studio",
    title: "Studio dashboards",
    body: "The brand and creator views of the same ledger.",
  },
  {
    href: "/creators",
    title: "For creators",
    body: "Connect PayPal and publish a test; see the holdout schedule it will run on.",
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
      <SiteHeader />

      <main id="main">
        <section className="hero" aria-labelledby="hero-h">
          <div className="wrap hero-inner">
            <h1 id="hero-h" className="h1">
              PayPal's affiliate network, rebuilt for AI&nbsp;agents.
            </h1>
            <div className="hero-foot">
              <div>
                <p className="lede">
                  It pays creators on proven lift, not last-click cookies.{" "}
                  <span className="lede-dim">
                    Agents read a creator's test and buy wherever the price is best. CITED measures
                    which tests changed what they bought, and pays only for those sales.
                  </span>
                </p>
                <div className="ctas">
                  <a className="btn btn-primary" href="/console?clean=1">
                    Watch two agents shop <span aria-hidden="true">→</span>
                  </a>
                  <a className="btn btn-quiet" href="/console/payout?clean=1">
                    See the payout
                  </a>
                </div>
              </div>
              <a className="hero-proof" href="/proof">
                <span className="dot" aria-hidden="true" /> Pre-registered, three models{" "}
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <div className="wrap">
            <SessionField
              caption={
                <>
                  <span className="fig-no">Fig. 1</span> Agents that bought the Winix: 147
                  forced-buy sessions across gpt-6-luna, gemini-3.8-flash and claude-sonnet-5-5,
                  Levoit priced the same as Winix.
                  <Ref n={2} />
                </>
              }
            />
            <dl className="stats num">
              <div>
                <dt>Lift, test vs placebo</dt>
                <dd>+94pp</dd>
              </div>
              <div>
                <dt>80% lower bound: what pays</dt>
                <dd className="pos">+90.3pp</dd>
              </div>
              <div>
                <dt>Paid to HouseFresh, day 30</dt>
                <dd>$383.96</dd>
              </div>
              <div>
                <dt>Built on PayPal</dt>
                <dd className="stats-small">Orders v2 · webhooks · Payouts</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="wrap">
          <Section
            id="problem"
            kicker="The problem"
            title="Agents read reviews. They don't click links."
          >
            <div className="prose two-col">
              <p>
                Affiliate marketing is a $13.81B a year business in the US
                <Ref n={1} />, and it pays per click. An AI shopping agent reads a creator's product
                test, decides, and buys wherever the price is best. No link is clicked, no cookie is
                set, and the creator who did the testing is paid nothing.
              </p>
              <p>
                Last-click credit was always easy to overwrite; with agents it disappears. What a
                creator can still prove is that their test <em>changed what agents bought</em>.
                Proving it takes a holdout: some agents never see the test.
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
                  arm and signs the passport. The agent pays the seller through PayPal, the capture
                  carries the passport to the engine, and the engine pays the creator.
                </figcaption>
              </figure>
            }
          >
            <HowTabs steps={STEPS} />
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
                  so the payout is a lower limit.
                </p>
                <p>
                  <a className="proof-link" href="/proof">
                    How we know the test caused the sales: the pre-registration, every interval, and
                    every session to download
                    <span className="try-arrow" aria-hidden="true">
                      →
                    </span>
                  </a>
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

          <Section id="try" kicker="Try it" title="Open it, or point your own agent at it.">
            <div className="own-agent">
              <div>
                <h3 className="h3">Run it with your own agent</h3>
                <p>
                  The catalogue is a public MCP server. Your agent searches the offers and checks
                  out through PayPal; the creator is credited only if the test it was shown caused
                  the sale.{" "}
                  <a className="proof-link" href="/mcp">
                    Setup for other clients
                    <span className="try-arrow" aria-hidden="true">
                      →
                    </span>
                  </a>
                </p>
              </div>
              <div className="own-agent-cmd">
                <p className="own-agent-label">Server URL</p>
                <pre>{MCP_URL}</pre>
                <p className="own-agent-label">Claude Code</p>
                <pre>claude mcp add --transport http cited {MCP_URL}</pre>
              </div>
            </div>
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
            <div className="runs">
              <h3 className="h3">What is real here</h3>
              <ul>
                <li>
                  <strong>The eval used real models:</strong> gpt-6-luna, gemini-3.8-flash and
                  claude-sonnet-5-5, 147 sessions per study condition.
                  <Ref n={2} />
                </li>
                <li>
                  <strong>The hosted demo simulates PayPal.</strong> Orders, webhooks and Payouts
                  run against an in-memory mock, so no money moves.
                </li>
                <li>
                  <strong>
                    <a href="/try">/try</a> runs a scripted agent
                  </strong>{" "}
                  until the host has a model key; the page says which one you got.
                </li>
                <li>
                  <strong>The payout ran once for real in the PayPal sandbox:</strong> batch Payout{" "}
                  <code>ME2KV57B7KYNS</code>, $383.96, status SUCCESS.{" "}
                  <a href={blob("cited/SANDBOX-EVIDENCE.md")}>Sandbox evidence</a>
                </li>
              </ul>
            </div>
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
