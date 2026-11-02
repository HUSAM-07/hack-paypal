import type { ApprovalRequestItem } from "@pact/protocol";
import { Check, Clock, Fingerprint, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { useRuntime } from "@/app/runtime";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { formatMoney } from "@/lib/money";
import { blockEnter, EASE_OUT, SPRING_POP } from "@/lib/motion";
import { getAssertion } from "@/lib/passkey";
import { cn } from "@/lib/utils";

type Approval = z.infer<typeof ApprovalRequestItem>;

const KIND_LABEL: Record<Approval["kind"], string> = {
  spend: "Approve a charge",
  mandate: "Approve a mandate",
  payout: "Approve a transfer",
  pactCommit: "Commit to a pact",
  pactCancel: "Cancel a pact",
};

function useCountdown(iso: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  return { left: s, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
}

/**
 * Host-rendered from `approvalRequest` items only; the model can't emit this. The
 * gesture is a deliberate press-and-hold, and step-up approvals add a passkey
 * assertion bound to the server's challenge before `approval/respond` is sent.
 */
export function ApprovalSheet({
  item,
  viewerId,
  approverName,
}: {
  item: Approval;
  viewerId: string;
  approverName: string;
}) {
  const { client } = useRuntime();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "passkey" | "sending" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [localDecision, setLocalDecision] = useState<"approved" | "denied" | null>(null);
  // Remounts the hold button so it un-fills after a cancelled passkey or an error.
  const [holdKey, setHoldKey] = useState(0);
  const resetHold = () => {
    setPhase("idle");
    setHoldKey((k) => k + 1);
  };
  const { left, label } = useCountdown(item.expiresAt);
  const decision = item.decision ?? localDecision ?? (left === 0 ? "expired" : null);
  const mine = item.approverId === viewerId;
  const canAct = mine && !decision && phase !== "sending";

  const respond = async (d: "approve" | "deny", assertion?: unknown) => {
    setPhase("sending");
    setError(null);
    try {
      const r = await client.request("approval/respond", {
        threadId: item.threadId,
        approvalId: item.approvalId,
        decision: d,
        ...(assertion ? { assertion } : {}),
      });
      if (!r.accepted) throw new Error("This approval is no longer valid.");
      setLocalDecision(d === "approve" ? "approved" : "denied");
      setPhase("idle");
    } catch (e) {
      setPhase("error");
      setError((e as Error).message || "Couldn't reach the server.");
    }
  };

  const onHold = () => {
    if (item.stepUp) setPhase("passkey");
    else void respond("approve");
  };

  const runPasskey = async () => {
    try {
      const assertion = await getAssertion(item.challenge ?? "", {
        threadId: item.threadId,
        approvalId: item.approvalId,
      });
      await respond("approve", assertion);
    } catch (e) {
      setPhase("error");
      setError((e as Error).message || "Passkey failed.");
    }
  };

  const Icon =
    decision === "approved"
      ? ShieldCheck
      : decision === "denied" || decision === "expired"
        ? ShieldX
        : ShieldAlert;

  return (
    <motion.section
      {...(reduce ? {} : blockEnter)}
      aria-label={KIND_LABEL[item.kind]}
      data-testid="approval-sheet"
      className={cn(
        "relative w-full overflow-hidden rounded-[24px] bg-surface p-4 shadow-card sm:p-5",
        !decision && "ring-1 ring-warning/30",
      )}
    >
      {!decision && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-warning-soft to-transparent"
        />
      )}
      <header className="relative flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-[9px]",
            decision === "approved"
              ? "bg-success-soft text-success"
              : decision
                ? "bg-surface-2 text-muted-foreground"
                : "bg-warning-soft text-warning",
          )}
        >
          <Icon className="size-[15px]" strokeWidth={2.2} />
        </span>
        <h3 className="flex-1 text-[15px] font-medium">{KIND_LABEL[item.kind]}</h3>
        {!decision ? (
          <span
            className={cn(
              "tabular flex items-center gap-1 text-xs",
              left < 60 ? "text-danger" : "text-muted-foreground",
            )}
          >
            <Clock className="size-3.5" /> {label}
          </span>
        ) : (
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={SPRING_POP}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium capitalize",
              decision === "approved"
                ? "bg-success-soft text-success"
                : "bg-surface-2 text-muted-foreground",
            )}
          >
            {decision}
          </motion.span>
        )}
      </header>

      <div className="relative mt-4">
        <p className="text-sm text-muted-foreground">{item.summary}</p>
        {item.amount && (
          <div className="mt-1 text-[34px] font-semibold leading-[42px] tracking-tight tabular">
            {formatMoney(item.amount)}
          </div>
        )}
        {item.stepUp && !decision && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Fingerprint className="size-3.5" /> Needs your passkey after you hold
          </p>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {!decision && mine && (
          <motion.div
            key="actions"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="relative mt-5 flex items-center justify-between gap-3"
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={!canAct}
              onClick={() => void respond("deny")}
            >
              Decline
            </Button>
            <HoldToConfirmButton
              key={holdKey}
              tone="positive"
              size="md"
              duration={1100}
              resetDelay={0}
              disabled={!canAct}
              label={item.stepUp ? "Hold, then passkey" : "Hold to approve"}
              confirmedLabel={
                phase === "sending" ? "Sending…" : item.stepUp ? "Passkey…" : "Approved"
              }
              icon={item.stepUp ? <Fingerprint size={14} /> : <Check size={14} />}
              onConfirm={onHold}
              className="pr-5"
            />
          </motion.div>
        )}
        {!decision && !mine && (
          <motion.p key="ro" className="relative mt-4 text-xs text-muted-foreground">
            Waiting for {approverName.split(" ")[0]} to approve.
          </motion.p>
        )}
      </AnimatePresence>
      {error && (
        <p role="alert" className="relative mt-3 text-xs text-danger">
          {error}{" "}
          <button type="button" className="underline" onClick={resetHold}>
            Try again
          </button>
        </p>
      )}

      <PasskeyPrompt
        open={phase === "passkey" || (phase === "sending" && item.stepUp)}
        amount={item.amount ? formatMoney(item.amount) : undefined}
        busy={phase === "sending"}
        onCancel={resetHold}
        onContinue={runPasskey}
      />
    </motion.section>
  );
}

function PasskeyPrompt({
  open,
  amount,
  busy,
  onCancel,
  onContinue,
}: {
  open: boolean;
  amount: string | undefined;
  busy: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const reduce = useReducedMotion();
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    if (!open) setScanning(false);
  }, [open]);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && !busy && onCancel()}
      title="Confirm with your passkey"
      description={
        amount
          ? `Approving ${amount}. This proves it's really you.`
          : "This proves it's really you."
      }
      dismissible={!busy}
    >
      <div className="flex flex-col items-center py-4">
        <div className="relative flex size-24 items-center justify-center">
          <motion.span
            className="absolute inset-0 rounded-full bg-info-soft"
            animate={
              scanning && !reduce ? { scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] } : { scale: 1 }
            }
            transition={{
              duration: 1.4,
              repeat: scanning ? Number.POSITIVE_INFINITY : 0,
              ease: "easeInOut",
            }}
          />
          <Fingerprint className="relative size-11 text-accent" strokeWidth={1.6} />
          {scanning && !reduce && (
            <motion.span
              aria-hidden
              className="absolute inset-x-6 h-0.5 rounded-full bg-accent/70"
              initial={{ top: "25%" }}
              animate={{ top: ["25%", "75%", "25%"] }}
              transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
          )}
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {scanning
            ? "Waiting for your device…"
            : "Your browser will ask for Face ID, Touch ID or your security key."}
        </p>
        <div className="mt-6 flex w-full gap-2">
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={scanning}
            onClick={() => {
              setScanning(true);
              onContinue();
            }}
          >
            <Fingerprint /> Use passkey
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
