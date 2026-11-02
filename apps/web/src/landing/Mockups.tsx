import { cx } from "./cx";

export function Mark({ className }: { className?: string }) {
  return (
    <span className={cx("flex items-center gap-2", className)}>
      <span className="flex size-6 items-center justify-center rounded-[7px] bg-white text-[#090909]">
        <svg viewBox="0 0 32 32" className="size-4" aria-hidden>
          <path
            d="M10 22V10h7a4 4 0 0 1 0 8h-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="22.5" cy="22.5" r="2.5" fill="var(--lav-500)" />
        </svg>
      </span>
      <span className="text-[14px] font-medium">Pact</span>
    </span>
  );
}

/** The app in a browser window, drawn in markup so it stays sharp and themable. */
export function BrowserMock() {
  const threads = ["Flat 4B", "Ski trip", "Coffee club", "Mum's birthday"];
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface text-left" aria-hidden>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr] max-sm:grid-cols-1">
        <aside className="border-r border-border p-4 max-sm:hidden">
          <Mark className="mb-6" />
          <p className="mb-2 text-[11px] uppercase tracking-wider text-subtle-foreground">
            Threads
          </p>
          {threads.map((t, i) => (
            <p
              key={t}
              className={cx(
                "rounded-[10px] px-3 py-2 text-[13px]",
                i === 0 ? "bg-surface-2 text-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </p>
          ))}
        </aside>
        <div className="flex flex-col justify-center gap-4 p-5 sm:p-8">
          <p className="ml-auto max-w-[70%] rounded-[18px] rounded-br-md bg-accent px-4 py-2.5 text-[14px] text-accent-foreground">
            Get the PS6 when it's under $500 before Friday, split three ways
          </p>
          <p className="max-w-[80%] text-[14px] text-muted-foreground">
            I'll watch it until Friday and buy at $500 or less. Commit your shares below. Nobody is
            charged until everyone has.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[18px] bg-surface-2 p-5">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-medium">PS6 Digital · price watch</span>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-soft-foreground">
                  Watching
                </span>
              </div>
              <p className="mt-4 font-mono text-[28px] font-medium tracking-tight tabular">
                $549.99
              </p>
              <p className="text-[12px] text-subtle-foreground">Target $500.00 · 3 days left</p>
            </div>
            <div className="rounded-[18px] bg-surface-2 p-5">
              <span className="text-[14px] font-medium">Shares</span>
              {(
                [
                  ["You", "$166.67", true],
                  ["Sam", "$166.67", true],
                  ["Priya", "$166.66", false],
                ] as const
              ).map(([n, a, ok]) => (
                <div key={n} className="mt-2.5 flex items-center justify-between">
                  <span className="text-[13px]">{n}</span>
                  <span className="flex items-center gap-2 font-mono text-[13px] tabular">
                    {a}
                    <span
                      className={cx("size-2 rounded-full", ok ? "bg-success" : "bg-surface-3")}
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
