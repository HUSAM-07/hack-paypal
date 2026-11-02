import { Fingerprint } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cx as cn } from "./cx";

/**
 * Product shots built from markup instead of screenshots: sharp at any DPR, no image
 * bytes, and they restyle with the theme tokens.
 */
function Phone({
  children,
  className,
  dark,
  style,
}: {
  children: ReactNode;
  className?: string | undefined;
  dark?: boolean;
  style?: CSSProperties | undefined;
}) {
  return (
    <div
      className={cn(
        "phone-rise w-[264px] shrink-0 rounded-[46px] bg-[#16141a] p-[9px] shadow-[0_40px_80px_-30px_oklch(0.3_0.08_290/0.45),0_0_0_1px_oklch(0_0_0/0.08)] sm:w-[288px]",
        dark && "dark",
        className,
      )}
      style={style}
      aria-hidden
    >
      <div className="relative flex h-[540px] flex-col overflow-hidden rounded-[38px] bg-background text-foreground sm:h-[590px]">
        <div className="flex h-12 shrink-0 items-center justify-between px-7 text-[13px] font-semibold">
          <span>9:41</span>
          <span className="absolute left-1/2 top-2 h-7 w-24 -translate-x-1/2 rounded-full bg-[#16141a]" />
          <span className="flex gap-1">
            <i className="h-2.5 w-4 rounded-[3px] bg-current opacity-80" />
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Bubble({ who, children, me }: { who: string; children: ReactNode; me?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", me ? "items-end" : "items-start")}>
      {!me && <span className="px-1 text-[11px] text-subtle-foreground">{who}</span>}
      <p
        className={cn(
          "max-w-[85%] rounded-[18px] px-3.5 py-2 text-[13px] leading-snug",
          me ? "rounded-br-md bg-accent text-accent-foreground" : "rounded-bl-md bg-surface-2",
        )}
      >
        {children}
      </p>
    </div>
  );
}

function Row({ name, amount, note }: { name: string; amount: string; note?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="flex size-7 items-center justify-center rounded-full bg-lav-100 text-[11px] font-semibold text-accent-soft-foreground">
        {name[0]}
      </span>
      <span className="flex-1 text-[13px]">
        {name}
        {note && <span className="ml-1.5 text-[11px] text-subtle-foreground">{note}</span>}
      </span>
      <span className="font-mono text-[13px] tabular">{amount}</span>
    </div>
  );
}

export function SplitPhone({ style }: { style?: CSSProperties | undefined }) {
  return (
    <Phone className="relative z-10" style={style}>
      <div className="px-5 pt-2 pb-3">
        <p className="text-[12px] text-subtle-foreground">Flat 4B · 3 members</p>
        <p className="text-[17px] font-semibold tracking-tight">PS6 for the living room</p>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-4">
        <Bubble who="Priya">Split it three ways? Cap me at $150, I'm saving.</Bubble>
        <Bubble who="Pact">
          Done. Priya pays her cap and the rest splits evenly. Nobody is charged until all three
          commit.
        </Bubble>
        <div className="rounded-[22px] bg-surface p-4 shadow-card">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-muted-foreground">Total</span>
            <span className="font-mono text-[22px] font-medium tracking-tight tabular">
              $549.99
            </span>
          </div>
          <div className="mt-2 divide-y divide-border">
            <Row name="Priya" note="cap" amount="$150.00" />
            <Row name="Sam" amount="$200.00" />
            <Row name="You" amount="$199.99" />
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-2/3 rounded-full bg-lav-500" />
          </div>
          <p className="mt-2 text-[11px] text-subtle-foreground">2 of 3 committed</p>
        </div>
      </div>
      <div className="m-4 flex h-11 items-center rounded-full bg-surface-2 px-4 text-[13px] text-subtle-foreground">
        Ask Pact to buy, split or send…
      </div>
    </Phone>
  );
}

export function WatchPhone({
  className,
  style,
}: {
  className?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  const bars = [62, 70, 66, 74, 71, 80, 77, 72, 69, 64, 60, 57];
  return (
    <Phone className={className} style={style}>
      <div className="px-5 pt-3">
        <p className="text-[12px] text-subtle-foreground">Price watch</p>
        <p className="text-[17px] font-semibold tracking-tight">Sony WH-1000XM6</p>
      </div>
      <div className="px-5 pt-6">
        <p className="text-[12px] text-muted-foreground">Now</p>
        <p className="font-mono text-[40px] leading-none font-medium tracking-tighter tabular">
          $399<span className="text-[24px] text-subtle-foreground">.99</span>
        </p>
        <p className="mt-3 inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent-soft-foreground">
          Buys at $280.00 or less
        </p>
      </div>
      <div className="mt-auto flex h-40 items-end gap-1.5 px-5">
        {bars.map((h, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative bars
            key={i}
            className="flex-1 rounded-t-[6px] bg-lav-200"
            style={{ height: `${h}%`, opacity: 0.5 + i / 24 }}
          />
        ))}
      </div>
      <div className="flex justify-between px-5 pt-2 pb-6 text-[11px] text-subtle-foreground">
        <span>Oct 28</span>
        <span>18 days left</span>
      </div>
    </Phone>
  );
}

export function ApprovePhone({
  className,
  style,
}: {
  className?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  return (
    <Phone dark className={className} style={style}>
      <div className="px-5 pt-3">
        <p className="text-[12px] text-subtle-foreground">Approval</p>
        <p className="text-[17px] font-semibold tracking-tight">Your share of the PS6</p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <p className="font-mono text-[44px] leading-none font-medium tracking-tighter text-glow tabular">
          $199.99
        </p>
        <p className="text-[13px] text-muted-foreground">To Flat 4B pact · via PayPal</p>
        <div className="relative mt-4 flex size-28 items-center justify-center">
          <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--surface-3)" strokeWidth="6" />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="var(--lav-400)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="339"
              strokeDashoffset="110"
            />
          </svg>
          <Fingerprint className="size-10 text-lav-200" strokeWidth={1.5} />
        </div>
        <p className="text-[13px] font-medium">Hold to approve</p>
      </div>
      <p className="px-6 pb-7 text-center text-[11px] text-subtle-foreground">
        Signed with your passkey. Pact can't move money without it.
      </p>
    </Phone>
  );
}
