import type { Money, PactState } from "@pact/protocol";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import { blockEnter } from "@/lib/motion";
import { cn, initials } from "@/lib/utils";

/** Outer shell every generated card shares: card surface, dashed hairline, small radius. */
export function GenCard({
  icon: Icon,
  title,
  aside,
  children,
  className,
  tone = "accent",
  label,
}: {
  icon?: LucideIcon;
  title?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: "accent" | "success" | "warning" | "neutral";
  label?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      {...(reduce ? {} : blockEnter)}
      aria-label={label ?? (typeof title === "string" ? title : undefined)}
      className={cn(
        "w-full rounded-lg border border-dashed border-border bg-card p-4 sm:p-5",
        className,
      )}
    >
      {(title || Icon) && (
        <header className="mb-3.5 flex items-center gap-2.5">
          {Icon && (
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md",
                tone === "accent" && "bg-primary-soft text-primary",
                tone === "success" && "bg-success-soft text-success",
                tone === "warning" && "bg-warning-soft text-warning",
                tone === "neutral" && "bg-fill text-muted-foreground",
              )}
            >
              <Icon className="size-[15px]" strokeWidth={2.2} />
            </span>
          )}
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-medium leading-6">{title}</h3>
          {aside}
        </header>
      )}
      {children}
    </motion.section>
  );
}

export function Well({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border border-dashed border-border bg-band", className)}>
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-lg", className)} />;
}

/** Shown wherever a ref hasn't resolved. Never displays a number. */
export function CardSkeleton({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      data-testid="ref-skeleton"
      className="w-full rounded-lg border border-dashed border-border bg-card p-4 sm:p-5"
    >
      <div className="mb-4 flex items-center gap-2.5">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
          <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

/** Each person gets a tint from the chart palette, so avatars stay on the theme's tokens. */
const TINTS = ["--chart-1", "--chart-4", "--chart-2", "--chart-5", "--chart-3"];
function tintFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

export function Avatar({
  name,
  id,
  size = 28,
  className,
  ring = false,
}: {
  name: string;
  id?: string;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const tint = tintFor(id ?? name);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        ring && "ring-2 ring-background",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        background: `color-mix(in oklab, var(${tint}) 22%, var(--background))`,
        color: "var(--foreground)",
      }}
    >
      {initials(name)}
    </span>
  );
}

const STATE_STYLE: Record<PactState, { label: string; cls: string; live?: boolean }> = {
  draft: { label: "Draft", cls: "bg-fill text-muted-foreground" },
  collecting: { label: "Collecting", cls: "bg-fill-strong text-foreground", live: true },
  armed: { label: "Armed", cls: "bg-success-soft text-success", live: true },
  triggered: { label: "Triggered", cls: "bg-warning-soft text-warning", live: true },
  settling: { label: "Settling", cls: "bg-warning-soft text-warning", live: true },
  done: { label: "Done", cls: "bg-success-soft text-success" },
  cancelled: { label: "Cancelled", cls: "bg-fill text-muted-foreground" },
  failed: { label: "Failed", cls: "bg-danger-soft text-danger" },
};

export function StateBadge({ state }: { state: PactState }) {
  const s = STATE_STYLE[state];
  return (
    <motion.span
      key={state}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] uppercase tracking-[0.04em]",
        s.cls,
      )}
    >
      {s.live && (
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-50" />
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      {s.label}
    </motion.span>
  );
}

export function Amount({
  value,
  className,
  compact,
}: {
  value: Money;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("tabular", className)}>
      {formatMoney(value, { compact: compact ?? false })}
    </span>
  );
}

export function Row({
  label,
  children,
  strong,
}: {
  label: ReactNode;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-t border-dashed border-border px-4 py-2 first:border-t-0">
      <span
        className={cn("text-sm", strong ? "font-medium text-foreground" : "text-muted-foreground")}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-right text-sm text-foreground",
          strong ? "font-semibold" : "font-medium",
        )}
      >
        {children}
      </span>
    </div>
  );
}
