import { splitEqual } from "@pact/policy";
import { useId, useState } from "react";
import { formatMoney } from "@/lib/money";

const usd = (amountMinor: number) => formatMoney({ amountMinor, currency: "USD" });
const MAX_CAP = 30000;

/** The real policy split (water-filling under caps), live in the browser. */
export function SplitDemo() {
  const id = useId();
  const [total, setTotal] = useState(54999);
  const [caps, setCaps] = useState({ Priya: 15000, Sam: 25000, You: 25000 });
  const members = Object.entries(caps).map(([userId, capMinor]) => ({ userId, capMinor }));
  const shares = splitEqual(total, members);

  return (
    <div className="grid gap-8 rounded-[32px] bg-surface p-6 shadow-card sm:p-10 lg:grid-cols-[1fr_1.2fr] lg:gap-14">
      <div>
        <h3 className="heading text-[22px]">Try a split</h3>
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          Set the price and everyone's cap. Anyone who can't cover an even share pays their cap, and
          the rest is shared by everyone else.
        </p>
        <label htmlFor={`${id}-total`} className="mt-8 flex items-baseline justify-between">
          <span className="text-[13px] font-medium">Total</span>
          <span className="font-mono text-[28px] font-medium tracking-tight tabular">
            {usd(total)}
          </span>
        </label>
        <input
          id={`${id}-total`}
          type="range"
          className="range mt-2 w-full"
          min={3000}
          max={80000}
          step={500}
          value={total}
          onChange={(e) => setTotal(Number(e.target.value))}
        />
      </div>
      <div className="flex flex-col justify-center gap-5">
        {members.map((m) => {
          const share = shares?.get(m.userId) ?? 0;
          const capped = shares !== null && share === m.capMinor;
          return (
            <div key={m.userId}>
              <div className="flex items-baseline justify-between text-[14px]">
                <span className="font-medium">
                  {m.userId}
                  {capped && (
                    <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-soft-foreground">
                      at cap
                    </span>
                  )}
                </span>
                <span className="font-mono tabular">{shares ? usd(share) : "—"}</span>
              </div>
              <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="bar absolute inset-y-0 left-0 w-full rounded-full bg-gradient-to-r from-lav-400 to-lav-600"
                  style={{ transform: `scaleX(${share / MAX_CAP})` }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 bg-foreground/40"
                  style={{ left: `${(m.capMinor / MAX_CAP) * 100}%` }}
                />
              </div>
              <label className="mt-1.5 flex items-center gap-3 text-[12px] text-subtle-foreground">
                <span className="w-24 shrink-0">Cap {usd(m.capMinor)}</span>
                <input
                  type="range"
                  className="range w-full"
                  aria-label={`${m.userId}'s cap`}
                  min={0}
                  max={MAX_CAP}
                  step={500}
                  value={m.capMinor}
                  onChange={(e) => setCaps((c) => ({ ...c, [m.userId]: Number(e.target.value) }))}
                />
              </label>
            </div>
          );
        })}
        <p className="min-h-5 text-[13px] text-danger" aria-live="polite">
          {shares === null && "The caps don't cover the total, so Pact wouldn't buy this."}
        </p>
      </div>
    </div>
  );
}
