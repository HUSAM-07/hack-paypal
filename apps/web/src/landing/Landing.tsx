import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { DitherField } from "../components/magicui/dither-field";
import { Halftone } from "./Halftone";
import { SessionField } from "./SessionField";
import { SiteHeader } from "./SiteHeader";
import { STICKERS, type StickerName } from "./stickers";

/**
 * The marketing landing: one bordered column of dashed section bands, with die-cut sticker
 * art. It sells both apps (CITED and Shop); the apps themselves sit behind sign-in at /home.
 * Every CITED number comes from cited/spec/CITED-card.md and the committed eval summaries.
 */

const REPO = "https://github.com/HUSAM-07/hack-paypal";
const blob = (path: string) => `${REPO}/blob/main/${path}`;

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
        buys settled at Lumen, $4 cheaper, not Northwind, whose offer carried the test.
      </>
    ),
  },
  {
    no: "04",
    tab: "Pay",
    sticker: "envelope",
    href: "#money",
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

/** The demo payout, as one chain of arithmetic. Locked numbers from cited/spec/CITED-card.md. */
const CHAIN: { n: string; k: string; op?: string; kind?: "void" | "total" }[] = [
  { n: "57", k: "Winix sales by agents shown the test" },
  { op: "×", n: "90.3%", k: "caused by the test, at its 80% lower bound" },
  { op: "=", n: "51", k: "credited sales" },
  { op: "×", n: "$7.68", k: "8% commission on $95.99" },
  { op: "−", n: "$7.68", k: "one returned, its credit voided", kind: "void" },
  { op: "=", n: "$383.96", k: "paid to HouseFresh on day 30", kind: "total" },
];

const MCP_URL = "https://caaash.shipwith.si/mcp";

const SHELF: { name: StickerName; w: number; rot: number }[] = [
  { name: "passport", w: 62, rot: -6 },
  { name: "receipt", w: 56, rot: 4 },
  { name: "robot", w: 50, rot: -3 },
  { name: "purifier", w: 38, rot: 2 },
  { name: "envelope", w: 76, rot: 5 },
  { name: "dice", w: 66, rot: -4 },
  { name: "coins", w: 66, rot: 3 },
  { name: "stamp", w: 76, rot: -5 },
  { name: "magnifier", w: 76, rot: 6 },
];

const FOOT: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Apps",
    links: [
      { href: "/home", label: "Open the app" },
      { href: "/shop", label: "Shop" },
    ],
  },
  {
    title: "Demo",
    links: [
      { href: "/console?clean=1", label: "Two agents, side by side" },
      { href: "/console/ledger", label: "The ledger" },
      { href: "/try", label: "Run an agent" },
    ],
  },
  {
    title: "Evidence",
    links: [
      { href: "/proof", label: "The proof" },
      { href: blob("cited/SANDBOX-EVIDENCE.md"), label: "Sandbox evidence" },
    ],
  },
  {
    title: "Build",
    links: [
      { href: "/mcp", label: "MCP setup" },
      { href: "/studio", label: "Studio" },
      { href: "/creators", label: "For creators" },
      { href: REPO, label: "Source on GitHub" },
    ],
  },
];

type App = {
  id: string;
  who: string;
  name: string;
  isNew?: boolean;
  line: string;
  points: string[];
  ctas: { href: string; label: string; primary?: boolean }[];
  gate: string;
};

/** The two verticals. Both run on the same PayPal rail: Orders v2, webhooks, Payouts. */
const APPS: App[] = [
  {
    id: "cited",
    who: "For creators and brands",
    name: "CITED",
    line: "Get paid when your test changes what an AI agent buys.",
    points: [
      "Agents are randomly shown your test, a placebo or nothing. Ranking never moves.",
      "A signed passport rides in the PayPal order, so the sale finds your test at any shop.",
      "Credits wait 30 days, refunds void them, and PayPal Payouts pay the rest.",
    ],
    ctas: [
      { href: "/console?clean=1", label: "Watch the demo", primary: true },
      { href: "/creators", label: "For creators" },
    ],
    gate: "Open demo. No account needed.",
  },
  {
    id: "shop",
    who: "For the person buying",
    name: "Shop",
    isNew: true,
    line: "Tell it what you want and your price. It watches, then buys through your PayPal wallet.",
    points: [
      "Searches the web and PayPal sellers. Every step is a card you can read: products, compare, price watch, approval, checkout, receipt.",
      "Auto-buy is a mandate you approve once, and the live price is re-checked before money moves.",
      "It authorises first, then gives you 10 minutes to undo. Big buys ask you to step up.",
    ],
    ctas: [{ href: "/shop", label: "Open Shop", primary: true }],
    gate: "Sign-in required. It's your wallet.",
  },
];

const PRINCIPLES: { k: string; v: string }[] = [
  {
    k: "Value first",
    v: "The CITED demo runs with no account. You see it work before you sign up.",
  },
  {
    k: "Friction first",
    v: "Money waits for your rule, a live re-check and an undo window. Friction where it protects you.",
  },
  { k: "User first", v: "Creators are paid on proof. Buyers keep the last word on every payment." },
];

const RAIL = [
  { id: "top", label: "Start" },
  { id: "apps", label: "Two apps" },
  { id: "problem", label: "The problem" },
  { id: "how", label: "How it works" },
  { id: "proof", label: "The proof" },
  { id: "money", label: "The payout" },
  { id: "try", label: "Try it" },
  { id: "real", label: "What is real" },
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
      <SiteHeader skip />
      <Halftone src="/art/stickers/robot.webp" className="ht ht-robot" />
      <Halftone src="/art/stickers/magnifier.webp" className="ht ht-glass" />
      <Rail />

      <main id="main" className="col">
        <section id="top" className="hero" aria-labelledby="hero-h">
          <DitherField
            className="mast"
            pattern="horizon"
            color={["var(--subtle)", "var(--primary)", "var(--foreground)"]}
            intensity={0.85}
          >
            <p className="mast-mark" aria-hidden="true">
              CITED
            </p>
          </DitherField>

          <div className="hero-copy">
            <p className="id-where">
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <circle cx="8" cy="8" r="6.25" />
                <path d="M1.75 8h12.5M8 1.75c2 2.2 2 10.3 0 12.5M8 1.75c-2 2.2-2 10.3 0 12.5" />
              </svg>
              Built on PayPal · Orders v2, webhooks, Payouts
            </p>
            <h1 id="hero-h" className="h1">
              Affiliate marketing, rebuilt on <u>PayPal</u> for <u>AI&nbsp;agents</u>.
            </h1>
            <p className="lede">
              Agents read a creator's test and buy wherever the price is best. CITED pays creators
              only for the sales their tests caused. Shop is the agent that buys for you, and stops
              to ask before your money moves.
            </p>
            <div className="ctas">
              <a className="btn btn-primary" href="/home">
                Open the app <span aria-hidden="true">→</span>
              </a>
              <a className="btn btn-quiet" href="/console?clean=1">
                Watch two agents shop
              </a>
              <a className="btn btn-tour" href="/?tour=1#problem">
                <span className="dot" aria-hidden="true" /> Take the 2-minute tour
              </a>
            </div>
          </div>
        </section>

        <Band id="apps" title="Two apps, one PayPal rail" note="this page sells, /home is the app">
          <div className="apps">
            {APPS.map((a) => (
              <article key={a.id} className="app" aria-labelledby={`app-${a.id}`}>
                <p className="app-who">
                  <span className="chip-serif">{a.who}</span>
                  {a.isNew ? <span className="app-new">New</span> : null}
                </p>
                <h3 id={`app-${a.id}`} className="app-name">
                  {a.name}
                </h3>
                <p className="app-line">{a.line}</p>
                <ul className="app-points">
                  {a.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
                <div className="app-foot">
                  <div className="ctas app-ctas">
                    {a.ctas.map((c) => (
                      <a
                        key={c.href}
                        className={`btn ${c.primary ? "btn-primary" : "btn-quiet"}`}
                        href={c.href}
                      >
                        {c.label}
                        {c.primary ? <span aria-hidden="true">→</span> : null}
                      </a>
                    ))}
                  </div>
                  <p className="app-gate mono">{a.gate}</p>
                </div>
              </article>
            ))}
          </div>
          <ul className="principles">
            {PRINCIPLES.map((p) => (
              <li key={p.k}>
                <strong>{p.k}.</strong> {p.v}
              </li>
            ))}
          </ul>
          <p className="more-row">
            <a className="more" href="/home">
              Already signed in? Open the app <Arrow />
            </a>
          </p>
        </Band>

        <Band id="problem" title="The problem" note="no click, no cookie, no pay">
          <div className="prose">
            <p>
              <strong>Agents read reviews. They don't click links.</strong> Affiliate marketing is a
              $13.81B a year business in the US, and it pays per click. An AI shopping agent reads a
              creator's product test, decides, and buys wherever the price is best. No link is
              clicked, no cookie is set, and the creator who did the testing is paid nothing.
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
          <SessionField
            caption={
              <>
                <span className="fig-no">Fig. 1</span> Agents that bought the Winix: 147 forced-buy
                sessions across gpt-6-luna, gemini-3.8-flash and claude-sonnet-5-5, Levoit priced
                the same as Winix.
              </>
            }
          />
          <p className="more-row">
            <a className="more" href="/proof">
              How we know the test caused the sales <Arrow />
            </a>
          </p>
        </Band>

        <Band id="money" title="The payout">
          <ol className="chain">
            {CHAIN.map((c) => (
              <li key={c.k} className={c.kind ? `chain-${c.kind}` : undefined}>
                {c.op ? (
                  <span className="chain-op" aria-hidden="true">
                    {c.op}
                  </span>
                ) : null}
                <span className="chain-tile">
                  <span className="chain-n">{c.n}</span>
                  <span className="chain-k">{c.k}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="pay-row">
            <figure className="deposit">
              <figcaption className="deposit-h">
                <span>Where Winix's $1,000 deposit went</span>
                <span className="mono">after the 30-day hold</span>
              </figcaption>
              <div
                className="deposit-bar"
                role="img"
                aria-label="$383.96 to HouseFresh, $616.04 back to Winix"
              >
                <span className="dep-paid" style={{ flexGrow: 383.96 }}>
                  <b>$383.96</b> to HouseFresh
                </span>
                <span className="dep-back" style={{ flexGrow: 616.04 }}>
                  <b>$616.04</b> back to Winix
                </span>
              </div>
              <p className="deposit-note">
                <b className="mono">$0.00</b> Levoit's test moved no agents, so its creator earns
                nothing and Levoit pays nothing.
              </p>
            </figure>
            <aside className="pp-notice" aria-label="The PayPal notice HouseFresh receives">
              <p className="pp-top">
                <span className="pp-logo">PayPal</span>
                <span className="pp-kind">Payment received</span>
              </p>
              <p className="pp-to">HouseFresh, you received a payment</p>
              <p className="pp-amt">
                $383.96 <small>USD</small>
              </p>
              <p className="pp-from">From CITED · commission on sales your test caused</p>
              <dl className="pp-rows">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className="pp-ok">Completed</span>
                  </dd>
                </div>
                <div>
                  <dt>Sent with</dt>
                  <dd>PayPal Payouts, after the 30-day hold</dd>
                </div>
                <div>
                  <dt>Sandbox batch</dt>
                  <dd className="mono">ME2KV57B7KYNS</dd>
                </div>
              </dl>
            </aside>
          </div>
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
        </Band>

        <Band id="real" title="What is real here">
          <ul className="real">
            <li>
              <strong>The eval used real models:</strong> gpt-6-luna, gemini-3.8-flash and
              claude-sonnet-5-5, 147 sessions per price condition.
            </li>
            <li>
              <strong>Agents pay through the real PayPal sandbox</strong>{" "}
              <Sticker name="cart" width={22} className="stk-inline" /> On /try and over MCP, each
              checkout is a real sandbox Orders v2 order charged to the buyer's vaulted wallet, and
              PayPal's signed webhook credits it. The seeded console and payout numbers are a
              recorded replay, so they stay fixed.
            </li>
            <li>
              <strong>
                <a href="/try">/try</a> runs a live agent:
              </strong>{" "}
              claude-sonnet-5-5 picks and buys the product itself; the page shows which model you
              got.
            </li>
            <li>
              <strong>The payout ran once for real in the PayPal sandbox:</strong> batch Payout{" "}
              <code>ME2KV57B7KYNS</code>, status SUCCESS.{" "}
              <a href={blob("cited/SANDBOX-EVIDENCE.md")}>Sandbox evidence</a>
            </li>
          </ul>
        </Band>

        <footer className="foot">
          <ul className="shelf" aria-hidden="true">
            {SHELF.map((s) => (
              <li key={s.name} style={{ "--rot": `${s.rot}deg` } as CSSProperties}>
                <Sticker name={s.name} width={s.w} className="shelf-stk" />
              </li>
            ))}
          </ul>
          <nav className="foot-links" aria-label="Site">
            {FOOT.map((g) => (
              <div key={g.title}>
                <h2 className="foot-h">{g.title}</h2>
                {g.links.map((l) => (
                  <a key={l.href} href={l.href}>
                    {l.label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <p className="foot-line">
            <span className="hand">made for the PayPal AI Hackathon</span>
            <span className="mono">CITED · 2026</span>
          </p>
        </footer>
      </main>
    </>
  );
}
