import type {
  PactUpdateItem,
  PaymentEventItem,
  SystemNoticeItem,
  ToolCallItem,
} from "@pact/protocol";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Info,
  OctagonAlert,
  Receipt as ReceiptIcon,
  Undo2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { z } from "zod";
import { StateBadge } from "@/genui/primitives";
import { formatMoney } from "@/lib/money";
import { blockEnter, EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Payment = z.infer<typeof PaymentEventItem>;
type PactUpdate = z.infer<typeof PactUpdateItem>;
type Notice = z.infer<typeof SystemNoticeItem>;
type Tool = z.infer<typeof ToolCallItem>;

const PAYMENT_LABEL: Record<Payment["kind"], string> = {
  charged: "Charged",
  refunded: "Refunded",
  payoutSent: "Paid out",
  payoutFailed: "Payout failed",
  chargeFailed: "Charge failed",
  purchased: "Purchased",
};

function CopyRef({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md px-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      aria-label={`Copy PayPal reference ${value}`}
    >
      {value}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? "y" : "n"}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
        >
          {done ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/**
 * Host-only receipt for a settlement: the purchase plus the share charges that funded
 * it. Built from `paymentEvent` items, so every figure is server data.
 */
export function Receipt({
  purchase,
  charges,
  nameFor,
}: {
  purchase: Payment;
  charges: Payment[];
  nameFor: (userId: string) => string;
}) {
  const reduce = useReducedMotion();
  const at = new Date(purchase.createdAt);
  return (
    <motion.section
      {...(reduce ? {} : blockEnter)}
      aria-label="Receipt"
      data-testid="receipt"
      className="relative w-full max-w-[420px] overflow-hidden rounded-lg border border-dashed border-border bg-card"
    >
      <div className="p-4 sm:p-5">
        <header className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-success-soft text-success-text">
            <ReceiptIcon className="size-[15px]" strokeWidth={2.2} />
          </span>
          <h3 className="flex-1 text-[15px] font-medium">Receipt</h3>
          <span className="text-xs text-muted-foreground">
            {at.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
            {at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
        </header>
        <div className="mt-4 text-xs text-muted-foreground">Total paid</div>
        <div className="text-[30px] font-semibold leading-10 tracking-tight tabular">
          {formatMoney(purchase.amount)}
        </div>
      </div>
      {/* perforation */}
      <div aria-hidden className="relative h-4">
        <div className="absolute inset-x-5 top-1/2 border-t border-dashed border-input" />
        <div className="absolute -left-2 top-0 size-4 rounded-full bg-background" />
        <div className="absolute -right-2 top-0 size-4 rounded-full bg-background" />
      </div>
      <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
        <ul className="space-y-2">
          {charges.map((c, i) => (
            <motion.li
              key={c.id}
              initial={reduce ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.05, duration: 0.3, ease: EASE_OUT }}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted-foreground">
                {c.userId ? nameFor(c.userId) : "Share"}
              </span>
              <span className="tabular font-medium">{formatMoney(c.amount)}</span>
            </motion.li>
          ))}
        </ul>
        {purchase.paypalRef && (
          <div className="mt-3 flex items-center justify-between border-t border-dashed border-border pt-3 text-xs text-muted-foreground">
            <span>PayPal ref</span>
            <CopyRef value={purchase.paypalRef} />
          </div>
        )}
      </div>
    </motion.section>
  );
}

/** One ledger line for a payment event that isn't part of a receipt. */
export function LedgerRow({
  item,
  nameFor,
}: {
  item: Payment;
  nameFor: (userId: string) => string;
}) {
  const failed = item.kind === "chargeFailed" || item.kind === "payoutFailed";
  const Icon = failed ? OctagonAlert : item.kind === "refunded" ? Undo2 : ArrowUpRight;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="flex items-center gap-2.5 rounded-md bg-band px-3 py-2 text-sm"
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full",
          failed ? "bg-danger-soft text-danger" : "bg-surface-3 text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {PAYMENT_LABEL[item.kind]}
        {item.userId ? (
          <span className="text-muted-foreground"> · {nameFor(item.userId)}</span>
        ) : null}
      </span>
      <span className={cn("tabular font-medium", failed && "text-danger line-through")}>
        {formatMoney(item.amount)}
      </span>
    </motion.div>
  );
}

/** Consecutive pact state changes collapse into one vertical timeline. */
export function PactTimeline({ updates }: { updates: PactUpdate[] }) {
  const last = updates[updates.length - 1];
  if (!last) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      aria-label={`${last.pact.title} timeline`}
      data-testid="pact-timeline"
      className="w-full rounded-md px-1 py-1"
    >
      <ol className="relative ml-2.5 border-l border-dashed border-input pl-4">
        {updates.map((u, i) => (
          <motion.li
            key={u.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className={cn(
              "relative flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5",
              i === updates.length - 1 ? "" : "opacity-70",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute -left-[21px] top-1/2 size-2.5 -translate-y-1/2 rounded-full ring-4 ring-background",
                i === updates.length - 1 ? "bg-primary" : "bg-border-strong",
              )}
            />
            <span className="text-[13px] text-muted-foreground">{u.note ?? `${u.pact.title}`}</span>
            {(u.from !== u.to || i === 0) && <StateBadge state={u.to} />}
          </motion.li>
        ))}
      </ol>
    </motion.section>
  );
}

const NOTICE = {
  info: { icon: Info, cls: "text-muted-foreground" },
  warning: { icon: AlertTriangle, cls: "text-warning" },
  error: { icon: OctagonAlert, cls: "text-danger" },
} as const;

export function SystemNotice({ item }: { item: Notice }) {
  const n = NOTICE[item.level];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      role={item.level === "info" ? "status" : "alert"}
      className="mx-auto flex max-w-[92%] items-start justify-center gap-2 rounded-md bg-band px-3.5 py-2 text-center text-[13px] leading-5"
    >
      <n.icon className={cn("mt-0.5 size-3.5 shrink-0", n.cls)} />
      <span className="text-muted-foreground">{item.text}</span>
    </motion.div>
  );
}

/** Kobra-style reasoning line: shimmering while running, a quiet check when done. */
export function ToolSteps({ tools }: { tools: Tool[] }) {
  return (
    <div className="flex flex-col gap-1" data-testid="tool-steps">
      <AnimatePresence initial={false}>
        {tools.map((t) => {
          const running = t.status === "inProgress";
          const failed = t.status === "failed";
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="flex items-center gap-2 text-[13px]"
            >
              <span className="flex size-4 items-center justify-center">
                {running ? (
                  <span className="size-3 animate-spin rounded-full border-[1.5px] border-subtle-foreground border-t-transparent" />
                ) : failed ? (
                  <OctagonAlert className="size-3.5 text-danger" />
                ) : (
                  <motion.span
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  >
                    <Check className="size-3.5 text-subtle-foreground" strokeWidth={2.4} />
                  </motion.span>
                )}
              </span>
              <span className={running ? "text-shimmer" : "text-subtle-foreground"}>
                {t.summary}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
