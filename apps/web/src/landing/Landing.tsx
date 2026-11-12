import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { DitherField } from "../components/magicui/dither-field";
import { SessionField } from "./SessionField";
import { SiteHeader } from "./SiteHeader";
import { STICKERS, type StickerName } from "./stickers";

/**
 * CITED landing: one bordered column of dashed section bands, with die-cut sticker art.
 * Every number on this page comes from cited/spec/CITED-card.md and the committed eval
 * summaries; each one carries a footnote to its source.
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

/** A die-cut sticker. Decorative: the copy beside it always says the same thing. */
function Sticker({
  name,
  width,
  className,
  style,
  eager,
}: {
  name: StickerName;
  width: number;
  className?: string;
  style?: CSSProperties;
  eager?: boolean;
}) {
  const s = STICKERS[name];
  return (
    <img
      className={`stk${className ? ` ${className}` : ""}`}
      src={`/art/stickers/${name}.webp`}
      width={width}
      height={Math.round((width * s.h) / s.w)}
      alt=""
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      style={style}
    />
  );
}

function Arrow() {
  return (
    <svg className="row-arrow" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M4.5 9.5 9.5 4.5M5.5 4.5h4v4" />
    </svg>
  );
}

/** A section: dashed rule, a tinted heading band, then the body. */
function Band({
  id,
  title,
  children,
  note,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
  /** A handwritten margin note, shown beside the column on wide screens. */
  note?: ReactNode;
}) {
  return (
    <section id={id} className="band" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="band-h">
        {title}
      </h2>
      {note ? (
        <p className="margin-note" aria-hidden="true">
          <svg viewBox="0 0 60 40" aria-hidden="true" focusable="false">
            <path d="M56 6C40 4 22 10 12 30m0 0-2-9m2 9 8-5" />
          </svg>
          {note}
        </p>
      ) : null}
      <div className="band-body">{children}</div>
    </section>
  );
}

type Step = {
  no: string;
  tab: string;
  sticker: StickerName;
  href: string;
  title: string;
  body: ReactNode;
};

const STEPS: Step[] = [
  {
    no: "01",
    tab: "Fund",
    sticker: "coins",
    href: "/studio",
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
    no: "02",
    tab: "Randomise",
    sticker: "dice",
    href: "/console?clean=1",
    title: "The catalogue randomises what agents see.",
    body: (
      <>
        The agent catalogue (a mock of PayPal's Store Sync in this demo) shows each shopping session
        the creator's test, a placebo from the same creator, or nothing. For a test's first 7 days
        half the sessions see it; after that, 5% are held out for good. Only the test is added or
        withheld. <strong>Ranking never changes.</strong>
      </>
    ),
  },
  {
    no: "03",
    tab: "Passport",
    sticker: "passport",
    href: "/mcp",
    title: "The passport goes into the PayPal order.",
    body: (
      <>
        The catalogue signs an Agent Affiliate Passport recording what this session was shown. The
        agent checks out through PayPal with the buyer's saved wallet and the seller as payee, and
        puts the passport in Orders v2 <code>purchase_units[].custom_id</code>, so the capture joins
        the sale to its group even when another seller gets paid. In the demo, all 57 exposed Winix
        buys settled at Lumen, $4 cheaper
        <Ref n={5} />, not Northwind, whose offer carried the test.
      </>
    ),
  },
  {
    no: "04",
    tab: "Pay",
    sticker: "envelope",
    href: "/console/payout?clean=1",
    title: "The engine pays only what the test caused.",
    body: (
      <>
        Credit is the attributable fraction at its 80% lower bound, at 8% commission, split by
        Shapley value when more than one creator's test was shown. Credits wait 30 days; refunds
        void them, and a dispute holds them until PayPal decides. Then one batch Payout pays the
        creators and the unspent deposit is refunded.
      </>
    ),
  },
];

const MODELS = [
  // Names exactly as recorded in packages/evals/results/cited-price-matched/results.jsonl.
  { name: "gpt-6-luna", lift: "+89pp", note: "test vs placebo" },
  { name: "gemini-3.8-flash", lift: "+100pp", note: "test vs placebo" },
  { name: "claude-sonnet-5-5", lift: "+94pp", note: "test vs placebo" },
  { name: "Pooled, model-stratified", lift: "+94pp", note: "147 sessions" },
] as const;

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

/** What keeps the money honest: each card restates a rule from CLAUDE.md's non-negotiables. */
const TRUST: { sticker: StickerName; title: string; body: string }[] = [
  {
    sticker: "dice",
    title: "Ranking never changes",
    body: "The catalogue only adds or withholds the creator's test. Every arm sees the same offers in the same order.",
  },
  {
    sticker: "magnifier",
    title: "A signed passport, verified",
    body: "The passport rides in the order's custom_id and is signed. A sale that doesn't verify stays unattributed, never guessed.",
  },
  {
    sticker: "hourglass",
    title: "Void before pay",
    body: "Credits wait 30 days. A refund voids them; an open dispute freezes them, and they're voided if the buyer wins.",
  },
  {
    sticker: "stamp",
    title: "Every PayPal call, once",
    body: "Each mutating call carries a deterministic PayPal-Request-Id, and each payout batch a deterministic sender_batch_id.",
  },
];

const MCP_URL = "https://caaash.shipwith.si/mcp";

const TRY: { href: string; title: string; path: string; sticker: StickerName; live?: boolean }[] = [
  {
    href: "/console?clean=1",
    title: "Two agents, side by side",
    path: "/console",
    sticker: "cart",
  },
  {
    href: "/console/payout?clean=1",
    title: "The day-30 payout",
    path: "/console/payout",
    sticker: "envelope",
  },
  { href: "/try", title: "Run an agent yourself", path: "/try", sticker: "robot", live: true },
  { href: "/proof", title: "The proof, every session", path: "/proof", sticker: "magnifier" },
  { href: "/studio", title: "Studio dashboards", path: "/studio", sticker: "folder" },
  { href: "/creators", title: "For creators", path: "/creators", sticker: "microphone" },
  {
    href: "/console/ledger",
    title: "The ledger, every sale",
    path: "/console/ledger",
    sticker: "receipt",
  },
  {
    href: REPO,
    title: "Source on GitHub",
    path: "github.com/HUSAM-07/hack-paypal",
    sticker: "folder",
  },
];

/** The hero collage. Positions are % of the stage, so it scales with the column. */
const HERO: { name: StickerName; left: number; top: number; w: number; rot: number }[] = [
  { name: "receipt", left: 2, top: 3, w: 15, rot: -9 },
  { name: "passport", left: 19, top: 0, w: 24, rot: 7 },
  { name: "purifier", left: 46, top: 6, w: 13, rot: -4 },
  { name: "dice", left: 68, top: 0, w: 21, rot: 8 },
  { name: "coins", left: 76, top: 47, w: 17, rot: -7 },
  { name: "envelope", left: 49, top: 56, w: 18, rot: 5 },
  { name: "robot", left: 3, top: 50, w: 13, rot: 0 },
];

const RAIL = [
  { id: "top", label: "CITED" },
  { id: "problem", label: "The problem" },
  { id: "how", label: "How it works" },
  { id: "proof", label: "The proof" },
  { id: "money", label: "The payout" },
  { id: "trust", label: "Guardrails" },
  { id: "try", label: "Try it" },
  { id: "real", label: "What is real" },
  { id: "sources", label: "Sources" },
];

/** Left-margin ticks, one per section; the one in view grows. Hidden below 1100px. */
function Rail() {
  const [active, setActive] = useState("top");
  useEffect(() => {
    const els = RAIL.map((r) => document.getElementById(r.id)).filter(
      (e): e is HTMLElement => e !== null,
    );
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-35% 0px -60% 0px" },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <nav className="rail" aria-label="Sections">
      {RAIL.map((r) => (
        <a key={r.id} href={`#${r.id}`} aria-current={active === r.id ? "true" : undefined}>
          <span className="rail-tick" aria-hidden="true" />
          <span className="rail-label">{r.label}</span>
        </a>
      ))}
    </nav>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={done ? "Copied" : `Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          },
          () => {},
        );
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function Landing() {
  return (
    <>
      <SiteHeader skip column links={["console", "proof", "studio", "creators"]} />
      <Rail />
      <DitherField
        aria-hidden="true"
        className="fade-foot"
        style={{ position: "fixed" }}
        pattern="clouds"
        color={["var(--subtle)", "var(--muted-foreground)", "var(--foreground)"]}
        intensity={0.7}
        interactive={false}
      />

      <main id="main" className="col">
        <section id="top" className="hero" aria-labelledby="hero-h">
          <div className="stage" aria-hidden="true">
            {HERO.map((h, i) => (
              <Sticker
                key={h.name}
                name={h.name}
                width={Math.round((766 * h.w) / 100)}
                eager
                className="stk-hero"
                style={
                  {
                    left: `${h.left}%`,
                    top: `${h.top}%`,
                    width: `${h.w}%`,
                    "--rot": `${h.rot}deg`,
                    "--i": i,
                  } as CSSProperties
                }
              />
            ))}
          </div>

          <div className="hero-copy">
            <p className="id-line">
              <span className="id-name">CITED</span>
              <Sticker name="passport" width={22} className="stk-inline" eager />
              <span className="id-sep" aria-hidden="true" />
              <span className="id-where">
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle cx="8" cy="8" r="6.25" />
                  <path d="M1.75 8h12.5M8 1.75c2 2.2 2 10.3 0 12.5M8 1.75c-2 2.2-2 10.3 0 12.5" />
                </svg>
                Built on PayPal · Orders v2, webhooks, Payouts
              </span>
            </p>
            <h1 id="hero-h" className="h1">
              Affiliate marketing, rebuilt on <u>PayPal</u> for <u>AI&nbsp;agents</u>.
            </h1>
            <p className="lede">
              It pays creators on proven lift, not last-click cookies. Agents read a creator's test
              and buy wherever the price is best. CITED measures which tests changed what they
              bought, and pays only for those sales.
            </p>
            <div className="ctas">
              <a className="btn btn-primary" href="/console?clean=1">
                Watch two agents shop <span aria-hidden="true">→</span>
              </a>
              <a className="btn btn-quiet" href="/console/payout?clean=1">
                See the payout
              </a>
              <a className="btn btn-tour" href="/?tour=1#problem">
                <span className="dot" aria-hidden="true" /> Take the 2-minute tour
              </a>
            </div>
          </div>
        </section>

        <Band id="problem" title="The problem" note="no click, no cookie, no pay">
          <div className="prose">
            <p>
              <strong>Agents read reviews. They don't click links.</strong> Affiliate marketing is a
              $13.81B a year business in the US
              <Ref n={1} />, and it pays per click. An AI shopping agent reads a creator's product
              test, decides, and buys wherever the price is best. No link is clicked, no cookie is
              set, and the creator who did the testing is paid nothing.
            </p>
            <p>
              <strong>CITED pays for what a test changed.</strong> Last-click credit was always easy
              to overwrite; with agents it disappears. What a creator can still prove is that their
              test <em>changed what agents bought</em>. Proving it takes a holdout: some agents
              never see the test.
            </p>
          </div>
        </Band>

        <Band id="how" title="How it works">
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.no} className="step">
                <p className="step-tag">
                  <Sticker name={s.sticker} width={34} className="stk-tag" />
                  <span className="chip-serif">
                    {s.no} · {s.tab}
                  </span>
                </p>
                <a className="row row-tall" href={s.href}>
                  <span className="row-text">
                    <span className="row-title">{s.title}</span>
                    <span className="row-body">{s.body}</span>
                  </span>
                  <Arrow />
                </a>
              </li>
            ))}
          </ol>
        </Band>

        <Band id="proof" title="The proof" note="pre-registered, three models">
          <div className="prose">
            <p>
              In 147 agent sessions with the Winix and Levoit priced the same, agents shown
              HouseFresh's test chose the Winix 94 points more often than agents shown other
              HouseFresh content. The lower bound, <strong className="accent">+90.3 points</strong>,
              is what pays.
              <Ref n={2} />
            </p>
          </div>
          <SessionField
            caption={
              <>
                <span className="fig-no">Fig. 1</span> Agents that bought the Winix: 147 forced-buy
                sessions across gpt-6-luna, gemini-3.8-flash and claude-sonnet-5-5, Levoit priced
                the same as Winix.
                <Ref n={2} />
              </>
            }
          />
          <ul className="grid2">
            {MODELS.map((m) => (
              <li key={m.name}>
                <a className="cell" href="/proof">
                  <span className="cell-ico mono" aria-hidden="true">
                    {m.name.startsWith("Pooled") ? "Σ" : m.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="cell-text">
                    <span className="cell-title">{m.name}</span>
                    <span className="cell-sub mono">
                      {m.lift} · {m.note}
                    </span>
                  </span>
                  <Arrow />
                </a>
              </li>
            ))}
          </ul>
          <div className="prose prose-after">
            <p>
              Agents otherwise default to the Levoit and flip when a test names the Winix, so this
              mostly measures deference to an explicit verdict. When the Winix was already the
              cheaper one, the lift fell to +24pp; a close-verdict test moved nothing and paid $0.
              <Ref n={3} /> Agents that read the test elsewhere only shrink the measured lift, so
              the payout is a lower limit.
            </p>
            <p>
              <a className="more" href="/proof">
                How we know the test caused the sales <Arrow />
              </a>
            </p>
          </div>
        </Band>

        <Band id="money" title="The payout">
          <figure className="ledger-fig">
            <ol className="ledger">
              {LEDGER.map((r, i) => (
                <li key={r.label} className={r.kind ? `l-${r.kind}` : undefined}>
                  <span className="l-no mono" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="l-label">{r.label}</span>
                  <span className="l-value mono">{r.value}</span>
                </li>
              ))}
            </ol>
            <figcaption className="caption">
              <span className="fig-no">Table 1</span> The demo ledger for HouseFresh's purifier
              test.
              <Ref n={4} />
              <Ref n={5} />
            </figcaption>
          </figure>
          <p className="callout">
            <Sticker name="coins" width={40} />
            <span>
              <strong>Only caused sales are paid. The rest goes back.</strong> Money never buys rank
              or verdicts: brands fund a category, and funding buys measurement of which tests move
              agents.
            </span>
          </p>
        </Band>

        <Band id="trust" title="Guardrails" note="money can't buy a verdict">
          <ul className="grid2 grid2-cards">
            {TRUST.map((t) => (
              <li key={t.title} className="tcard">
                <Sticker name={t.sticker} width={44} className="tcard-stk" />
                <span>
                  <span className="cell-title">{t.title}</span>
                  <span className="tcard-body">{t.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </Band>

        <Band id="try" title="Try it">
          <div className="mcp">
            <p className="mcp-lede">
              <strong>Point your own agent at it.</strong> The catalogue is a public MCP server.
              Your agent searches the offers and checks out through PayPal; the creator is credited
              only if the test it was shown caused the sale.{" "}
              <a className="more" href="/mcp">
                Other clients <Arrow />
              </a>
            </p>
            <div className="cmd">
              <span className="cmd-k mono">Server URL</span>
              <code className="cmd-v">{MCP_URL}</code>
              <CopyButton text={MCP_URL} label="server URL" />
            </div>
            <div className="cmd">
              <span className="cmd-k mono">Claude Code</span>
              <code className="cmd-v">claude mcp add --transport http cited {MCP_URL}</code>
              <CopyButton
                text={`claude mcp add --transport http cited ${MCP_URL}`}
                label="Claude Code command"
              />
            </div>
          </div>
          <ul className="grid2">
            {TRY.map((t) => (
              <li key={t.href}>
                <a className="cell" href={t.href}>
                  <Sticker name={t.sticker} width={28} className="cell-stk" />
                  <span className="cell-text">
                    <span className="cell-title">
                      {t.title}
                      {t.live ? <span className="pill-new">live</span> : null}
                    </span>
                    <span className="cell-sub mono">{t.path}</span>
                  </span>
                  <Arrow />
                </a>
              </li>
            ))}
          </ul>
        </Band>

        <section id="real" className="band band-serif" aria-labelledby="real-h">
          <div className="serif-head">
            <Sticker name="robot" width={46} className="serif-stk-l" />
            <h2 id="real-h" className="serif-h">
              What is real here
            </h2>
            <Sticker name="stamp" width={46} className="serif-stk-r" />
          </div>
          <ul className="real">
            <li>
              <strong>The eval used real models</strong>{" "}
              <Sticker name="magnifier" width={22} className="stk-inline" /> gpt-6-luna,
              gemini-3.8-flash and claude-sonnet-5-5, 147 sessions per price condition.
              <Ref n={2} />
            </li>
            <li>
              <strong>The hosted demo simulates PayPal</strong>{" "}
              <Sticker name="cart" width={22} className="stk-inline" /> Orders, webhooks and Payouts
              run against an in-memory mock, so no money moves.
            </li>
            <li>
              <strong>
                <a href="/try">/try</a> runs a scripted agent
              </strong>{" "}
              <Sticker name="robot" width={18} className="stk-inline" /> until the host has a model
              key; the page says which one you got.
            </li>
            <li>
              <strong>The payout ran once for real in the PayPal sandbox</strong>{" "}
              <Sticker name="envelope" width={22} className="stk-inline" /> batch Payout{" "}
              <code>ME2KV57B7KYNS</code>, $383.96, status SUCCESS.{" "}
              <a href={blob("cited/SANDBOX-EVIDENCE.md")}>Sandbox evidence</a>
            </li>
          </ul>
        </section>

        <section className="closer" aria-labelledby="closer-h">
          <Sticker name="receipt" width={70} className="closer-stk closer-stk-l" />
          <h2 id="closer-h" className="closer-h">
            Pay the tests that <em>move agents</em>.
          </h2>
          <div className="ctas ctas-center">
            <a className="btn btn-primary" href="/try">
              Run an agent <span aria-hidden="true">→</span>
            </a>
            <a className="btn btn-quiet" href="/studio">
              Open Studio
            </a>
          </div>
          <Sticker name="coins" width={70} className="closer-stk closer-stk-r" />
        </section>

        <footer id="sources" className="band foot">
          <h2 id="sources-h" className="band-h">
            Sources
          </h2>
          <ol className="sources">
            {SOURCES.map((s) => (
              <li key={s.id} id={s.id}>
                {s.text}{" "}
                <a href={s.href} className="src-link mono">
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
          <p className="foot-line">
            <span className="hand">made for the PayPal AI Hackathon</span>
            <span className="mono">CITED · 2026</span>
          </p>
          <DitherField
            className="foot-dither"
            pattern="horizon"
            color={["var(--subtle)", "var(--primary)", "var(--foreground)"]}
            intensity={0.85}
          >
            <p className="foot-mark" aria-hidden="true">
              CITED
            </p>
          </DitherField>
        </footer>
      </main>
    </>
  );
}
