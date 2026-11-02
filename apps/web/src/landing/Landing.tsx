import {
  ArrowRight,
  ArrowUpRight,
  Fingerprint,
  FlaskConical,
  KeyRound,
  Plus,
  RotateCcw,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Art, type ArtName } from "./ArtImage";
import { cx as cn } from "./cx";
import { ApprovePhone, SplitPhone, WatchPhone } from "./Phones";
import { SplitDemo } from "./SplitDemo";

const d = (ms: number) => ({ "--d": ms }) as CSSProperties;

const pill =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[17px] font-medium tracking-[0.01em] transition-[transform,background-color,opacity] duration-150 ease-snappy active:scale-[0.96]";

function Mark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="flex size-7 items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
        <svg viewBox="0 0 32 32" className="size-[18px]" aria-hidden>
          <path
            d="M10 22V10h7a4 4 0 0 1 0 8h-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="22.5" cy="22.5" r="2.5" fill="var(--lav-400)" />
        </svg>
      </span>
      <span className="text-[17px] font-semibold tracking-tight">Pact</span>
    </span>
  );
}

function Chip({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[15px] font-medium",
        dark ? "text-white/80" : "text-muted-foreground",
      )}
    >
      <span className="flex size-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-lav-400 to-lav-600 shadow-[inset_0_1px_0_oklch(1_0_0/0.35)]">
        <span className="size-2 rounded-full bg-white" />
      </span>
      {children}
    </span>
  );
}

const NAV = [
  ["How it works", "#how"],
  ["PayPal", "#paypal"],
  ["Security", "#security"],
  ["FAQ", "#faq"],
] as const;

function Nav() {
  return (
    <header data-nav className="nav fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
        <a href="/" aria-label="Pact home">
          <Mark />
        </a>
        <nav className="flex items-center gap-1 sm:gap-2">
          {NAV.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="hidden rounded-full px-3.5 py-2 text-[15px] text-muted-foreground transition-colors hover:text-foreground md:block"
            >
              {label}
            </a>
          ))}
          <a
            href="/app"
            className="ml-2 inline-flex h-9 items-center rounded-full bg-primary px-4 text-[15px] font-medium text-primary-foreground transition-transform duration-150 ease-snappy active:scale-[0.96]"
          >
            Open Pact
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative mx-2 overflow-hidden rounded-b-[40px] bg-gradient-to-b from-background via-lav-50 to-lav-100 sm:mx-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-[radial-gradient(60%_60%_at_50%_100%,oklch(0.72_0.14_285/0.35),transparent_70%)]"
      />
      <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-5 pt-32 text-center sm:pt-40">
        <div className="rise" style={d(0)}>
          <Chip>Pact for groups</Chip>
        </div>
        <h1
          className="rise display mt-5 max-w-[14ch] text-[44px] text-foreground/90 sm:text-[64px] lg:text-[72px]"
          style={d(60)}
        >
          Money your group agrees on
        </h1>
        <p
          className="rise mt-5 max-w-[34rem] text-[17px] text-muted-foreground sm:text-[19px]"
          style={d(120)}
        >
          An agent in your group chat that watches prices, splits the bill and pays on PayPal. It
          never moves money without your approval.
        </p>
        <div className="rise mt-8 flex flex-wrap justify-center gap-3" style={d(180)}>
          <a
            href="/app"
            className={cn(pill, "bg-accent text-accent-foreground hover:brightness-110")}
          >
            Get started
          </a>
          <a href="#how" className={cn(pill, "bg-accent-soft text-accent-soft-foreground")}>
            See how it works
          </a>
        </div>
        <div className="mt-16 -mb-40 flex items-end justify-center gap-6 sm:-mb-32 lg:gap-10">
          <div data-parallax="0.06" className="hidden md:block">
            <WatchPhone className="translate-y-16" style={d(260)} />
          </div>
          <div data-parallax="0.02">
            <SplitPhone style={d(160)} />
          </div>
          <div data-parallax="0.06" className="hidden md:block">
            <ApprovePhone className="translate-y-16" style={d(340)} />
          </div>
        </div>
      </div>
    </section>
  );
}

const FACTS: { n: number; unit?: string; label: string }[] = [
  { n: 0, label: "Payments without your approval" },
  { n: 4, label: "Kinds of pacts" },
  { n: 1, label: "Hold to approve" },
  { n: 3, unit: "days", label: "To settle a group buy" },
];

function Facts() {
  return (
    <section className="mx-auto mt-6 max-w-[1200px] px-3 sm:px-6">
      <div data-reveal className="rounded-[32px] bg-surface px-6 py-12 shadow-card sm:px-12">
        <h2 className="heading text-center text-[22px] sm:text-[24px]">
          Group money that only moves when you say so
        </h2>
        <dl className="mt-10 grid grid-cols-2 gap-y-10 lg:grid-cols-4 lg:divide-x lg:divide-border">
          {FACTS.map((f) => (
            <div key={f.label} className="flex flex-col items-center gap-1 text-center">
              <dt className="order-2 text-[15px] text-muted-foreground">{f.label}</dt>
              <dd className="display text-lav text-[44px] sm:text-[52px]">
                <span data-count={f.n}>{f.n}</span>
                {f.unit && <span className="ml-2 text-[0.5em]">{f.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const PACTS: { art: ArtName; kicker: string; title: string; body: string }[] = [
  {
    art: "watch",
    kicker: "Price watch",
    title: "Buy it when it drops",
    body: "Set a target and a deadline. Pact checks the price and buys the moment it hits.",
  },
  {
    art: "split",
    kicker: "Group buy",
    title: "Split it, with caps",
    body: "Everyone commits their share. Funds are held, then captured only when all are in.",
  },
  {
    art: "schedule",
    kicker: "Standing order",
    title: "Pay on a schedule",
    body: "Rent, subscriptions, coffee runs. Each run stays inside the limits you signed.",
  },
  {
    art: "send",
    kicker: "Send & request",
    title: "Settle up in chat",
    body: "Ask a friend for their half or pay them back without leaving the thread.",
  },
];

function BrowserMock() {
  const threads = ["Flat 4B", "Ski trip", "Coffee club", "Mum's birthday"];
  return (
    <div
      data-reveal
      className="mx-auto mt-16 max-w-[1040px] overflow-hidden rounded-[20px] bg-surface shadow-pop"
      aria-hidden
    >
      <div className="flex h-11 items-center gap-2 border-b border-border px-4">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="mx-auto rounded-full bg-surface-2 px-16 py-1 text-[12px] text-subtle-foreground">
          Pact
        </span>
      </div>
      <div className="grid min-h-[440px] grid-cols-[200px_1fr] text-left max-sm:grid-cols-1">
        <aside className="border-r border-border p-4 max-sm:hidden">
          <Mark className="mb-6 scale-90 origin-left" />
          <p className="mb-2 text-[11px] uppercase tracking-wider text-subtle-foreground">
            Threads
          </p>
          {threads.map((t, i) => (
            <p
              key={t}
              className={cn(
                "rounded-[12px] px-3 py-2 text-[13px]",
                i === 0 ? "bg-surface-2 text-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </p>
          ))}
        </aside>
        <div className="flex flex-col gap-4 p-6 sm:p-8">
          <p className="ml-auto max-w-[70%] rounded-[18px] rounded-br-md bg-accent px-4 py-2.5 text-[14px] text-accent-foreground">
            Get the PS6 when it's under $500 before Friday, split three ways
          </p>
          <p className="max-w-[80%] text-[14px] text-muted-foreground">
            I'll watch it until Friday and buy at $500 or less. Commit your shares below. Nobody is
            charged until everyone has.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[22px] bg-surface-2 p-5">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-medium">PS6 Digital · price watch</span>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-soft-foreground">
                  Watching
                </span>
              </div>
              <p className="mt-4 font-mono text-[30px] font-medium tracking-tight tabular">
                $549.99
              </p>
              <p className="text-[12px] text-subtle-foreground">Target $500.00 · 3 days left</p>
            </div>
            <div className="rounded-[22px] bg-surface-2 p-5">
              <span className="text-[14px] font-medium">Shares</span>
              {[
                ["You", "$166.67", true],
                ["Sam", "$166.67", true],
                ["Priya", "$166.66", false],
              ].map(([n, a, ok]) => (
                <div key={n as string} className="mt-2.5 flex items-center justify-between">
                  <span className="text-[13px]">{n}</span>
                  <span className="flex items-center gap-2 font-mono text-[13px] tabular">
                    {a}
                    <span
                      className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-surface-3")}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Groups() {
  return (
    <section
      id="how"
      className="lazy-section dark relative mx-2 mt-6 overflow-hidden rounded-[40px] bg-ink-deep px-5 pt-20 pb-16 text-foreground sm:mx-4 sm:pt-28 sm:pb-24"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[38%] h-[60%] bg-[radial-gradient(50%_50%_at_50%_50%,oklch(0.6_0.18_285/0.28),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-[1200px] text-center">
        <div data-reveal>
          <Chip dark>How it works</Chip>
          <h2 className="display text-glow mx-auto mt-5 max-w-[16ch] text-[40px] sm:text-[60px] lg:text-[72px]">
            Say it in chat. Pact does the rest.
          </h2>
          <p className="mx-auto mt-5 max-w-[32rem] text-[17px] text-muted-foreground sm:text-[19px]">
            Describe the plan in plain words. Pact drafts it, everyone commits their part, and it
            runs on its own.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="/app" className={cn(pill, "bg-white text-[#252228] hover:opacity-90")}>
              Open Pact
            </a>
            <a href="#security" className={cn(pill, "bg-white/10 text-white hover:bg-white/15")}>
              How it stays safe
            </a>
          </div>
        </div>
        <BrowserMock />
        <div className="mt-24 flex flex-col items-start justify-between gap-6 text-left md:flex-row md:items-end">
          <div data-reveal>
            <h3 className="display text-[30px] sm:text-[40px]">A pact for every plan.</h3>
            <p className="mt-2 max-w-[34rem] text-[17px] text-muted-foreground">
              From a one-off group buy to a monthly standing order, each pact has its own limits and
              its own members.
            </p>
          </div>
        </div>
        <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
          {PACTS.map((p, i) => (
            <article
              key={p.art}
              data-reveal
              style={d(i * 80)}
              className="group flex flex-col rounded-[24px] bg-white/[0.04] p-6 ring-1 ring-white/[0.06] transition-colors duration-300 hover:bg-white/[0.07]"
            >
              <Art
                name={p.art}
                sizes="120px"
                className="-mt-2 size-[120px] self-center transition-transform duration-700 ease-swift group-hover:-translate-y-1.5 group-hover:scale-105"
              />
              <p className="mt-4 text-[13px] font-medium text-lav-400">{p.kicker}</p>
              <h4 className="mt-1 text-[19px] font-medium tracking-tight">{p.title}</h4>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{p.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const RAILS = [
  {
    title: "Saved payment methods",
    body: "Members connect PayPal once. Pact charges it only inside the caps and dates they agreed to.",
  },
  {
    title: "Hold first, then capture",
    body: "Group buys hold every share and capture only when everyone is in. If anyone drops out, the holds are voided.",
  },
  {
    title: "Payouts",
    body: "Pay a friend back or settle a split straight to their PayPal account.",
  },
];

function PayPal() {
  return (
    <section
      id="paypal"
      className="lazy-section relative mx-2 mt-6 overflow-hidden rounded-[40px] bg-gradient-to-b from-lav-50 via-lav-100/70 to-background px-5 pt-20 pb-20 sm:mx-4 sm:pt-28"
    >
      <div className="mx-auto max-w-[1200px] text-center">
        <div data-reveal>
          <Chip>Built on PayPal</Chip>
          <h2 className="display mx-auto mt-5 max-w-[15ch] text-[40px] text-foreground/90 sm:text-[60px] lg:text-[72px]">
            Real payments, not IOUs
          </h2>
          <p className="mx-auto mt-5 max-w-[32rem] text-[17px] text-muted-foreground sm:text-[19px]">
            Every charge, hold and payout runs on PayPal. Pact decides when; PayPal moves the money.
          </p>
        </div>
        <div data-reveal style={d(120)} className="mx-auto mt-10 max-w-[560px]">
          <Art name="rails" sizes="(min-width: 640px) 560px, 92vw" className="h-auto w-full" />
        </div>
        <div className="mt-12 grid gap-4 text-left md:grid-cols-3">
          {RAILS.map((r, i) => (
            <article
              key={r.title}
              data-reveal
              style={d(i * 80)}
              className="rounded-[24px] bg-surface p-7 shadow-card"
            >
              <h3 className="text-[19px] font-medium tracking-tight">{r.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{r.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const SAFETY = [
  {
    icon: Fingerprint,
    title: "Passkey approvals",
    body: "Every payment you approve is signed on your device.",
  },
  {
    icon: ShieldCheck,
    title: "A policy engine, in code",
    body: "Caps, payees and expiry dates are checked before any PayPal call.",
  },
  {
    icon: KeyRound,
    title: "The AI never types money",
    body: "Prices and amounts come from the server, never from the model.",
  },
  {
    icon: ScrollText,
    title: "Safe retries",
    body: "Each PayPal request carries an idempotency key, so a retry can't charge twice.",
  },
  {
    icon: RotateCcw,
    title: "Automatic unwinds",
    body: "If a group buy falls through, held funds are voided or refunded.",
  },
  {
    icon: FlaskConical,
    title: "Red-teamed",
    body: "Passes 100% of our prompt-injection and money-safety evals.",
  },
];

function Security() {
  return (
    <section id="security" className="lazy-section mx-auto mt-6 max-w-[1200px] px-3 pt-20 sm:px-6">
      <div data-reveal className="text-center">
        <Chip>Safe by default</Chip>
        <h2 className="display mx-auto mt-5 max-w-[15ch] text-[40px] text-foreground/90 sm:text-[60px] lg:text-[72px]">
          Nothing moves without you
        </h2>
        <p className="mx-auto mt-5 max-w-[32rem] text-[17px] text-muted-foreground sm:text-[19px]">
          The agent can suggest anything. Only you can approve a payment.
        </p>
      </div>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SAFETY.map((s, i) => (
          <article
            key={s.title}
            data-reveal
            style={d((i % 3) * 80)}
            className="rounded-[24px] bg-surface p-7 shadow-card"
          >
            <span className="flex size-10 items-center justify-center rounded-[12px] bg-accent-soft text-accent-soft-foreground">
              <s.icon className="size-5" strokeWidth={1.75} />
            </span>
            <h3 className="mt-5 text-[19px] font-medium tracking-tight">{s.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
          </article>
        ))}
      </div>
      <div className="mt-24 text-center" data-reveal>
        <h2 className="display text-[32px] sm:text-[44px]">Fair splits, even with caps.</h2>
        <p className="mx-auto mt-3 max-w-[30rem] text-[17px] text-muted-foreground">
          This is the same split Pact runs before anyone is charged.
        </p>
      </div>
      <div data-reveal style={d(100)} className="mt-10">
        <SplitDemo />
      </div>
    </section>
  );
}

const FAQS = [
  [
    "What is Pact?",
    "Pact is a money agent that lives in your group chats. You describe a plan, like buying something when it drops or splitting a bill. Pact drafts it, everyone commits their part, and it pays through PayPal.",
  ],
  [
    "Does Pact hold my money?",
    "No. Payments run through PayPal. Pact keeps references to saved payment methods on the server and never sees card numbers.",
  ],
  [
    "What can the agent do without me?",
    "Only what a mandate you signed allows: a specific payee, a cap and an end date. Anything outside that asks you first, and you approve with your passkey.",
  ],
  [
    "What if someone drops out of a group buy?",
    "Shares are held, not charged, until everyone commits. If the pact doesn't complete, the holds are voided and nobody pays.",
  ],
  [
    "Can I use it today?",
    "Pact is in an invite-only preview, and payments run on test money. Ask the team for an invite link.",
  ],
] as const;

function Faq() {
  return (
    <section id="faq" className="lazy-section mx-auto mt-28 max-w-[760px] px-5">
      <h2 data-reveal className="display text-center text-[32px] sm:text-[44px]">
        Questions
      </h2>
      <div className="mt-10 divide-y divide-border border-y border-border">
        {FAQS.map(([q, a]) => (
          <details key={q} className="faq group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium">
              {q}
              <Plus className="faq-icon size-5 shrink-0 text-accent" />
            </summary>
            <p className="pb-6 text-[15px] leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="mx-auto mt-28 max-w-[1200px] px-3 sm:px-6">
      <div
        data-reveal
        className="relative overflow-hidden rounded-[32px] bg-surface px-6 py-14 text-center shadow-card sm:py-20"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-[radial-gradient(50%_80%_at_50%_100%,var(--lav-100),transparent_70%)]"
        />
        <div className="relative">
          <h2 className="display text-[32px] sm:text-[44px]">Start a pact with your people</h2>
          <p className="mx-auto mt-3 max-w-[28rem] text-[17px] text-muted-foreground">
            Pact is invite-only during the preview. Sign in with a passkey in seconds.
          </p>
          <a
            href="/app"
            className={cn(pill, "mt-8 bg-primary text-primary-foreground hover:opacity-90")}
          >
            Open Pact <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

const FOOTER = [
  [
    "Product",
    [
      ["How it works", "#how"],
      ["Price watch", "#how"],
      ["Group buys", "#how"],
      ["Open Pact", "/app"],
    ],
  ],
  [
    "Trust",
    [
      ["Security", "#security"],
      ["Built on PayPal", "#paypal"],
      ["FAQ", "#faq"],
    ],
  ],
] as const;

function Footer() {
  return (
    <footer className="mx-2 mt-28 rounded-t-[40px] bg-gradient-to-b from-background to-lav-100 px-5 pt-16 pb-10 sm:mx-4">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid gap-10 sm:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Mark />
            <p className="mt-3 max-w-[22rem] text-[15px] text-muted-foreground">
              Group money agents in chat. Built for the PayPal AI Hackathon.
            </p>
          </div>
          {FOOTER.map(([title, links]) => (
            <div key={title}>
              <p className="text-[13px] font-medium text-accent">{title}</p>
              <ul className="mt-4 space-y-3">
                {links.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="inline-flex items-center gap-1 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {label}
                      {href.startsWith("/") && <ArrowUpRight className="size-3.5" />}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-16 text-[12px] leading-relaxed text-subtle-foreground">
          Pact is a hackathon preview. Payments in the preview use test money. PayPal is a trademark
          of PayPal, Inc.
        </p>
      </div>
    </footer>
  );
}

export function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Facts />
        <Groups />
        <PayPal />
        <Security />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
