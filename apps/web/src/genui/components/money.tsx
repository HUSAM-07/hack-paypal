import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { PropsOf } from "@pact/catalog";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Handshake,
  History,
  ShieldCheck,
  ShoppingBag,
  Undo2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useContext, useState } from "react";
import { TransferFundsCard } from "@/components/spectrumui/transfer-funds-card";
import { Button } from "@/components/ui/button";
import { currencySymbol, formatMoney, percentOf } from "@/lib/money";
import { EASE_OUT } from "@/lib/motion";
import { cn, relativeTime, shortDate } from "@/lib/utils";
import { useHostActions } from "../actions";
import { Amount, CardSkeleton, GenCard, Row, Well } from "../primitives";
import { type ActivityEntry, RefsContext, resolveRef } from "../refs";

type R<P> = ComponentRenderProps<P>;

/** Host-provided data generated components may read (never write). */
export const HostDataContext = createContext<{ activity: ActivityEntry[] | null }>({
  activity: null,
});

const MANDATE_STATUS = {
  active: "bg-success-soft text-success-text",
  revoked: "bg-danger-soft text-danger",
  exhausted: "bg-surface-2 text-muted-foreground",
  expired: "bg-surface-2 text-muted-foreground",
} as const;

export function MandateCardView({ props }: R<PropsOf<"MandateCard">>) {
  const refs = useContext(RefsContext);
  const data = resolveRef(refs, props.mandateRef, "mandate");
  const { run, interactive } = useHostActions();
  const [confirming, setConfirming] = useState(false);
  if (!data) return <CardSkeleton lines={4} label="Loading mandate" />;
  const { mandate: m } = data;
  const spent = data.spent ?? { amountMinor: 0, currency: m.maxTotal.currency };
  const pct = percentOf(spent, m.maxTotal);
  const scope = m.pactId
    ? "This pact only"
    : m.merchantAllow?.length
      ? m.merchantAllow.join(", ")
      : "Any merchant";
  return (
    <GenCard
      icon={ShieldCheck}
      tone="success"
      title={data.label ?? "Spending mandate"}
      aside={
        <span
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-[0.04em]",
            MANDATE_STATUS[m.status],
          )}
        >
          {m.status}
        </span>
      }
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Up to, per charge</div>
          <div className="text-2xl font-semibold tracking-tight">
            <Amount value={m.maxPerCharge} />
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <Amount value={spent} /> of <Amount value={m.maxTotal} compact />
          {m.period !== "none" ? ` / ${m.period}` : ""}
        </div>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: <meter> can't carry the animated fill */}
      <div
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-label="Mandate used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <motion.div
          className="h-full rounded-full bg-success"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        />
      </div>
      <Well className="mt-4">
        <Row label="Scope">{scope}</Row>
        <Row label="Valid until">{shortDate(m.validUntil)}</Row>
        {m.stepUpAbove && (
          <Row label="Passkey above">
            <Amount value={m.stepUpAbove} compact />
          </Row>
        )}
        {m.maxCharges && (
          <Row label="Charges">{m.maxCharges === 1 ? "One" : `Up to ${m.maxCharges}`}</Row>
        )}
        <Row label="Funding">PayPal</Row>
      </Well>
      {m.status === "active" && interactive && (
        <div className="mt-3 flex justify-end">
          <AnimatePresence mode="popLayout" initial={false}>
            {confirming ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <span className="text-xs text-muted-foreground">Revoke this mandate?</span>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
                <Button
                  size="xs"
                  variant="danger"
                  onClick={() => run("issueTurn", { text: `Revoke mandate ${m.id}` })}
                >
                  Revoke
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>
                  <Ban className="size-3.5" /> Revoke
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </GenCard>
  );
}

export function TransferFundsCardView({ props }: R<PropsOf<"TransferFundsCard">>) {
  const refs = useContext(RefsContext);
  const t = resolveRef(refs, props.transferRef, "transfer");
  const { run, stageUiState, interactive } = useHostActions();
  const [confirmed, setConfirmed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (!t) return <CardSkeleton lines={5} label="Loading transfer" />;
  const fee = t.fee ?? { amountMinor: 0, currency: t.amount.currency };
  const total = {
    amountMinor: t.amount.amountMinor + fee.amountMinor,
    currency: t.amount.currency,
  };
  const who = t.counterpartyName ?? t.counterpartyEmail ?? "Recipient";
  const symbol = currencySymbol(t.amount.currency);
  const amountText = formatMoney(t.amount).replace(symbol, "").trim();
  const sending = t.direction === "send";

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(false)}
        className="rounded-lg bg-fill px-3 py-1.5 text-xs text-muted-foreground hover:bg-fill-strong hover:text-foreground"
      >
        Transfer draft hidden · show
      </button>
    );
  }

  const footer =
    t.status === "sent" ? (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mt-[25px] flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-success-soft text-sm font-medium text-success"
      >
        <CheckCircle2 className="size-4" /> Sent to {who.split(" ")[0]}
      </motion.div>
    ) : t.status === "cancelled" || t.status === "failed" ? (
      <div className="mt-[25px] flex h-[34px] items-center justify-center rounded-lg bg-fill text-sm text-muted-foreground">
        {t.status === "cancelled" ? "Cancelled" : "Failed"}
      </div>
    ) : undefined;

  return (
    <div className="w-full max-w-[380px]">
      <TransferFundsCard
        className="border border-dashed border-border bg-card"
        title={sending ? "Send money" : "Request money"}
        description={
          t.note ? t.note : sending ? `To ${who} via PayPal.` : `From ${who} via PayPal.`
        }
        amountLabel={sending ? "Amount to send" : "Amount to request"}
        currencySymbol={symbol}
        amount={amountText}
        fromLabel="From"
        fromAccount={sending ? `${t.fromName ?? "You"} · PayPal` : who}
        toLabel="To"
        toAccount={
          sending
            ? `${who}${t.counterpartyEmail ? ` · ${t.counterpartyEmail}` : ""}`
            : `${t.fromName ?? "You"} · PayPal`
        }
        fieldsReadOnly
        summary={[
          { label: "Arrives", value: t.eta ?? "Within minutes" },
          { label: "Fee", value: formatMoney(fee) },
          { label: "Total", value: formatMoney(total), emphasized: true },
        ]}
        buttonLabel={
          confirmed ? "Waiting for approval…" : sending ? "Confirm transfer" : "Send request"
        }
        confirmDisabled={!interactive || confirmed}
        onConfirm={() => {
          setConfirmed(true);
          stageUiState({ confirmTransfer: props.transferRef });
          run("issueTurn", {
            text: sending ? `Confirm sending to ${who}` : `Send the request to ${who}`,
          });
        }}
        {...(t.status === "draft" && interactive ? { onClose: () => setDismissed(true) } : {})}
        {...(footer ? { footer } : {})}
      />
    </div>
  );
}

const ACTIVITY_ICON = {
  charged: ArrowUpRight,
  payoutSent: ArrowUpRight,
  purchased: ShoppingBag,
  received: ArrowDownLeft,
  refunded: Undo2,
  payoutFailed: Ban,
  chargeFailed: Ban,
  pact: Handshake,
} as const;

export function ActivityRows({ entries, limit = 6 }: { entries: ActivityEntry[]; limit?: number }) {
  if (entries.length === 0)
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ul>
      {entries.slice(0, limit).map((e, i) => {
        const Icon = ACTIVITY_ICON[e.kind];
        const failed = e.kind === "chargeFailed" || e.kind === "payoutFailed";
        return (
          <motion.li
            key={e.id}
            layout="position"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT, delay: i * 0.03 }}
            className="flex min-h-14 items-center gap-3 border-t border-dashed border-border px-3.5 py-2.5 first:border-t-0"
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full",
                e.direction === "in"
                  ? "bg-success-soft text-success-text"
                  : failed
                    ? "bg-danger-soft text-danger"
                    : "bg-fill text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{e.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {e.subtitle ? `${e.subtitle} · ` : ""}
                {relativeTime(e.at)}
              </div>
            </div>
            {e.amount && (
              <span
                className={cn(
                  "tabular shrink-0 text-sm font-medium",
                  e.direction === "in" && "text-success",
                  failed && "text-danger line-through",
                )}
              >
                {e.direction === "in" ? "+" : e.direction === "out" ? "−" : ""}
                {formatMoney(e.amount)}
              </span>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}

export function ActivityListView({ props }: R<PropsOf<"ActivityList">>) {
  const refs = useContext(RefsContext);
  const host = useContext(HostDataContext);
  const scoped = props.scopeRef ? resolveRef(refs, props.scopeRef, "activity") : undefined;
  const entries = props.scopeRef ? scoped?.entries : (host.activity ?? undefined);
  if (!entries) return <CardSkeleton lines={4} label="Loading activity" />;
  return (
    <GenCard icon={History} title="Activity" tone="neutral">
      <Well className="-mx-1">
        <ActivityRows entries={entries} />
      </Well>
    </GenCard>
  );
}

export { Amount };
