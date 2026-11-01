import type { Money } from "@pact/protocol";
import {
  PayPalOneTimePaymentButton,
  PayPalProvider,
  PayPalSavePaymentButton,
} from "@paypal/react-paypal-js/sdk-v6";
import { Check, Fingerprint, Lock, ShieldCheck, Timer } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { useRuntime } from "@/app/runtime";
import { Sheet } from "@/components/ui/sheet";
import { Amount, Row, Well } from "@/genui/primitives";
import type { PactData } from "@/genui/refs";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { SPRING_LAYOUT, SPRING_POP } from "@/lib/motion";
import { cn, shortDate } from "@/lib/utils";

type Mode = "vault" | "once";
type Phase = "idle" | "working" | "done" | "error";

/**
 * Host commit flow for `openCommit`. "Save PayPal" runs the v6 save-payment (vault
 * without purchase) session: the worker mints a setup token, the member approves in
 * PayPal, and the worker exchanges it for a vault id it keeps server-side and issues
 * a mandate. "Pay now" runs a one-time payment session for the member's share.
 */
export function CommitSheet({
  open,
  onOpenChange,
  threadId,
  data,
  viewerId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  threadId: string;
  data: PactData | undefined;
  viewerId: string;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("vault");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const pact = data?.pact;
  const me = pact?.members.find((m) => m.userId === viewerId);
  const share = data?.shares?.find((s) => s.userId === viewerId)?.share;

  const finish = (msg: string) => {
    setPhase("done");
    setTimeout(() => {
      onOpenChange(false);
      onDone(msg);
      setPhase("idle");
    }, 1100);
  };
  const fail = (e: unknown) => {
    setPhase("error");
    setError((e as Error)?.message ?? "PayPal didn't complete. Nothing was saved or charged.");
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => phase !== "working" && onOpenChange(o)}
      title={pact ? `Commit to “${pact.title}”` : "Commit"}
      description="Your PayPal stays with PayPal. Pact only gets a revocable, capped permission."
      dismissible={phase !== "working"}
    >
      {!pact || !me ? (
        <p className="text-sm text-muted-foreground">This pact isn't available right now.</p>
      ) : (
        <div className="relative">
          <AnimatePresence>{phase === "done" && <DoneOverlay />}</AnimatePresence>
          <Well>
            {share && (
              <Row label="Your share" strong>
                <Amount value={share} />
              </Row>
            )}
            <Row label="Your cap">
              <Amount value={me.cap} />
            </Row>
            {pact.trigger.kind === "price" && (
              <Row label="Charged when">
                ≤ {formatMoney(pact.trigger.maxPrice, { compact: true })} by{" "}
                {shortDate(pact.trigger.deadline)}
              </Row>
            )}
          </Well>

          <ul className="mt-4 space-y-2 text-[13px] text-muted-foreground">
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-success" /> One charge, only for this pact, never
              above your cap
            </li>
            <li className="flex items-center gap-2">
              <Fingerprint className="size-4 text-accent" /> Passkey required for larger charges
            </li>
            <li className="flex items-center gap-2">
              <Timer className="size-4" /> Expires with the pact; revoke any time
            </li>
          </ul>

          <Segmented mode={mode} onChange={setMode} />

          <div className="mt-3 min-h-[52px]">
            <PayPalArea
              mode={mode}
              threadId={threadId}
              pactId={pact.id}
              cap={me.cap}
              disabled={phase === "working" || phase === "done"}
              onStart={() => {
                setPhase("working");
                setError(null);
              }}
              onSaved={() => finish("PayPal saved. You're committed.")}
              onPaid={() => finish("Share paid. You're committed.")}
              onCancel={() => setPhase("idle")}
              onError={fail}
            />
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          )}
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-subtle-foreground">
            <Lock className="size-3" /> PayPal sandbox · vault IDs never reach this browser
          </p>
        </div>
      )}
    </Sheet>
  );
}

function Segmented({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      className="mt-5 grid grid-cols-2 rounded-full bg-surface-2 p-1 text-[13px] font-medium"
      role="tablist"
    >
      {(
        [
          ["vault", "Save PayPal"],
          ["once", "Pay share now"],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            "relative h-8 rounded-full transition-colors",
            mode === m ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {mode === m && (
            <motion.span
              layoutId="commit-seg"
              transition={SPRING_LAYOUT}
              className="absolute inset-0 rounded-full bg-surface-3 shadow-sm"
            />
          )}
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  );
}

function DoneOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface/95"
    >
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={SPRING_POP}
        className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success"
      >
        <Check className="size-7" strokeWidth={2.6} />
      </motion.span>
      <span className="text-sm font-medium">You're committed</span>
    </motion.div>
  );
}

interface AreaProps {
  mode: Mode;
  threadId: string;
  pactId: string;
  cap: Money;
  disabled: boolean;
  onStart: () => void;
  onSaved: () => void;
  onPaid: () => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}

function PayPalArea(p: AreaProps) {
  return env.paypalClientId ? <RealPayPal {...p} /> : <StandInPayPal {...p} />;
}

/** The real v6 SDK. Loads only when a public client id is configured. */
function RealPayPal({
  mode,
  threadId,
  pactId,
  cap,
  onStart,
  onSaved,
  onPaid,
  onCancel,
  onError,
}: AreaProps) {
  const { api } = useRuntime();
  // The provider needs a referentially stable promise.
  const clientToken = useMemo(() => api.paypalClientToken(), [api]);
  return (
    <PayPalProvider
      clientToken={clientToken}
      environment="sandbox"
      components={["paypal-payments"]}
      pageType="checkout"
    >
      {mode === "vault" ? (
        <PayPalSavePaymentButton
          presentationMode="auto"
          createVaultToken={async () => {
            onStart();
            return api.paypalSetupToken({ threadId, pactId, cap });
          }}
          onApprove={async ({ vaultSetupToken }) => {
            try {
              await api.paypalPaymentToken({ threadId, pactId, vaultSetupToken });
              onSaved();
            } catch (e) {
              onError(e);
            }
          }}
          onCancel={onCancel}
          onError={onError}
        />
      ) : (
        <PayPalOneTimePaymentButton
          presentationMode="auto"
          createOrder={async () => {
            onStart();
            return api.paypalCreateOrder({ threadId, pactId });
          }}
          onApprove={async ({ orderId }) => {
            try {
              await api.paypalCaptureOrder(orderId);
              onPaid();
            } catch (e) {
              onError(e);
            }
          }}
          onCancel={onCancel}
          onError={onError}
        />
      )}
    </PayPalProvider>
  );
}

/**
 * Stand-in used with the mock server (no client id): walks the same endpoint sequence
 * (setup token → approve → payment token, or order → approve → capture) without
 * loading PayPal, so the demo runs offline.
 */
function StandInPayPal({
  mode,
  threadId,
  pactId,
  cap,
  disabled,
  onStart,
  onSaved,
  onPaid,
  onError,
}: AreaProps) {
  const { api } = useRuntime();
  const reduce = useReducedMotion();
  const [step, setStep] = useState<string | null>(null);
  const run = async () => {
    onStart();
    try {
      if (mode === "vault") {
        setStep("Opening PayPal…");
        const { vaultSetupToken } = await api.paypalSetupToken({ threadId, pactId, cap });
        setStep("Approve in PayPal…");
        await new Promise((r) => setTimeout(r, 900));
        setStep("Saving…");
        await api.paypalPaymentToken({ threadId, pactId, vaultSetupToken });
        onSaved();
      } else {
        setStep("Opening PayPal…");
        const { orderId } = await api.paypalCreateOrder({ threadId, pactId });
        setStep("Approve in PayPal…");
        await new Promise((r) => setTimeout(r, 900));
        setStep("Capturing…");
        await api.paypalCaptureOrder(orderId);
        onPaid();
      }
    } catch (e) {
      onError(e);
    } finally {
      setStep(null);
    }
  };
  return (
    <motion.button
      type="button"
      onClick={run}
      disabled={disabled || step !== null}
      {...(reduce ? {} : { whileTap: { scale: 0.98 } })}
      data-testid="paypal-button"
      aria-label={mode === "vault" ? "Save PayPal for this pact" : "Pay with PayPal"}
      className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-full bg-[#ffc439] text-[#003087] transition-[filter] hover:brightness-[1.03] disabled:cursor-default"
    >
      <AnimatePresence mode="wait" initial={false}>
        {step ? (
          <motion.span
            key={step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <span className="size-3.5 animate-spin rounded-full border-2 border-[#003087] border-t-transparent" />
            {step}
          </motion.span>
        ) : (
          <motion.span
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-baseline gap-1.5"
          >
            <span className="text-sm font-medium">
              {mode === "vault" ? "Save with" : "Pay with"}
            </span>
            <span className="text-[19px] font-extrabold italic tracking-tight">
              Pay<span className="text-[#0070e0]">Pal</span>
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
