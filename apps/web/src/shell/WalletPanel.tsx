import { Ban, CreditCard, ShieldCheck, Wallet as WalletIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useRuntime, useWallet } from "@/app/runtime";
import { Button } from "@/components/ui/button";
import { ActivityRows } from "@/genui/components/money";
import { Amount, Skeleton } from "@/genui/primitives";
import type { MandateData } from "@/genui/refs";
import { percentOf } from "@/lib/money";
import { EASE_OUT } from "@/lib/motion";
import { cn, shortDate } from "@/lib/utils";

function MandateRow({ m, onRevoke }: { m: MandateData; onRevoke: (id: string) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const spent = m.spent ?? { amountMinor: 0, currency: m.mandate.maxTotal.currency };
  const pct = percentOf(spent, m.mandate.maxTotal);
  const active = m.mandate.status === "active";
  return (
    <motion.li layout="position" className="rounded-2xl bg-surface p-3.5 shadow-card">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-7 items-center justify-center rounded-[9px]",
            active ? "bg-success-soft text-success" : "bg-surface-2 text-muted-foreground",
          )}
        >
          <ShieldCheck className="size-[15px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{m.label ?? "Mandate"}</div>
          <div className="text-xs text-muted-foreground">
            up to <Amount value={m.mandate.maxPerCharge} compact /> per charge · until{" "}
            {shortDate(m.mandate.validUntil)}
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
            active ? "bg-success-soft text-success" : "bg-surface-2 text-muted-foreground",
          )}
        >
          {m.mandate.status}
        </span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className="h-full rounded-full bg-success"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          <Amount value={spent} /> used of <Amount value={m.mandate.maxTotal} compact />
        </span>
        {active && (
          <AnimatePresence mode="popLayout" initial={false}>
            {confirm ? (
              <motion.span
                key="c"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex gap-1"
              >
                <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>
                  Keep
                </Button>
                <Button
                  size="xs"
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onRevoke(m.mandate.id).finally(() => setBusy(false));
                    setConfirm(false);
                  }}
                >
                  Revoke
                </Button>
              </motion.span>
            ) : (
              <motion.button
                key="r"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setConfirm(true)}
                className="flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:bg-surface-2 hover:text-foreground"
              >
                <Ban className="size-3" /> Revoke
              </motion.button>
            )}
          </AnimatePresence>
        )}
      </div>
    </motion.li>
  );
}

/** Host UI (not generated): funding source, mandates with a direct kill switch, activity. */
export function WalletPanel({ embedded = false }: { embedded?: boolean }) {
  const { api } = useRuntime();
  const { wallet, error, refresh } = useWallet();
  const revoke = async (id: string) => {
    await api.revokeMandate(id);
    refresh();
  };
  return (
    <aside aria-label="Wallet" className="flex h-full flex-col">
      {!embedded && (
        <div className="flex h-14 shrink-0 items-center gap-2 px-5">
          <WalletIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Wallet</h2>
        </div>
      )}
      <div
        className={cn(
          "space-y-6",
          !embedded && "scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6",
        )}
      >
        <section>
          <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#0b2a6b] via-[#0d3a8f] to-[#1757c2] p-4 text-white shadow-card">
            <div
              aria-hidden
              className="absolute -right-10 -top-10 size-36 rounded-full bg-white/10 blur-2xl"
            />
            <div className="flex items-center justify-between text-xs text-white/70">
              <span className="flex items-center gap-1.5">
                <CreditCard className="size-3.5" /> Funding source
              </span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium">
                Sandbox
              </span>
            </div>
            <div className="mt-6 text-lg font-extrabold italic tracking-tight">
              Pay<span className="text-[#7fc0ff]">Pal</span>
            </div>
            <div className="mt-0.5 text-sm text-white/80">
              {wallet ? wallet.funding.label.replace(/^PayPal · /, "") : "—"}
            </div>
          </div>
        </section>
        <section>
          <h3 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            Mandates
          </h3>
          {error && <p className="px-1 text-xs text-danger">{error}</p>}
          {!wallet ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : wallet.mandates.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">
              No mandates yet. Commit to a pact to create one.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="mandates">
              {wallet.mandates.map((m) => (
                <MandateRow key={m.mandate.id} m={m} onRevoke={revoke} />
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            Activity
          </h3>
          <div className="rounded-2xl bg-surface shadow-card">
            {wallet ? (
              <ActivityRows entries={wallet.activity} limit={8} />
            ) : (
              <Skeleton className="h-40 w-full rounded-2xl" />
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
