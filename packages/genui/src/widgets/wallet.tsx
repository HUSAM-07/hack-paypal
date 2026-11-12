import { Lock, Wallet as WalletIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useWidgetContext } from "../context";
import { Pill } from "../primitives";
import { PayPalMark } from "./products";
import { setupTokenOf } from "./wallet-token";

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "error"; message: string };

const RealPayPalSave = lazy(() => import("./wallet-paypal"));

/**
 * Connect PayPal once (vault without purchase). The vault id stays on the server; this card
 * only ever sees a masked label. Used inline in purchase approvals and in settings.
 */
export function WalletConnectCard({
  variant = "inline",
  onConnected,
}: {
  variant?: "inline" | "settings";
  onConnected?: () => void;
}) {
  const ctx = useWidgetContext();
  const wallet = ctx.state?.wallet;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fail = (e: unknown) =>
    setPhase({
      kind: "error",
      message: (e as Error)?.message || "PayPal didn't finish. Nothing was saved or charged.",
    });
  const done = () => {
    setPhase({ kind: "idle" });
    onConnected?.();
  };

  const standIn = async () => {
    try {
      setPhase({ kind: "working", step: "Opening PayPal…" });
      const token = setupTokenOf(await ctx.invoke("wallet.startConnect", {}));
      setPhase({ kind: "working", step: "Approve in PayPal…" });
      await new Promise((r) => setTimeout(r, 700));
      setPhase({ kind: "working", step: "Saving…" });
      await ctx.invoke("wallet.completeConnect", { setupTokenId: token });
      done();
    } catch (e) {
      fail(e);
    }
  };

  if (wallet?.connected) {
    return (
      <div className="genui g-wallet" data-variant={variant} data-connected="">
        <span className="g-wallet__icon" aria-hidden>
          <WalletIcon />
        </span>
        <div className="g-wallet__text">
          <strong>
            <PayPalMark /> connected
          </strong>
          <span className="g-muted g-truncate">{wallet.label ?? "PayPal wallet"}</span>
        </div>
        {variant === "settings" ? (
          <button
            type="button"
            className="g-btn g-btn--ghost g-btn--sm"
            onClick={() => ctx.invoke("wallet.disconnect", {}).catch(fail)}
          >
            Disconnect
          </button>
        ) : (
          <Pill tone="good" dot>
            Ready
          </Pill>
        )}
      </div>
    );
  }

  return (
    <div className="genui g-wallet" data-variant={variant}>
      <span className="g-wallet__icon" aria-hidden>
        <WalletIcon />
      </span>
      <div className="g-wallet__text">
        <strong>Connect PayPal once</strong>
        <span className="g-muted">
          PayPal keeps your payment details. You give a revocable permission; nothing is charged
          now.
        </span>
      </div>
      <div className="g-wallet__action">
        {ctx.paypal ? (
          <Suspense fallback={<span className="g-muted">Loading PayPal…</span>}>
            <RealPayPalSave
              ctx={ctx}
              onStart={() => setPhase({ kind: "working", step: "Waiting for PayPal…" })}
              onDone={done}
              onError={fail}
            />
          </Suspense>
        ) : (
          <button
            type="button"
            className="g-btn g-btn--paypal"
            onClick={standIn}
            disabled={phase.kind === "working"}
            aria-label="Connect PayPal"
          >
            {phase.kind === "working" ? (
              <span className="g-btn__step" aria-live="polite">
                <span className="g-spin" aria-hidden />
                {phase.step}
              </span>
            ) : (
              <>
                Connect <PayPalMark />
              </>
            )}
          </button>
        )}
        <span className="g-wallet__fine">
          <Lock aria-hidden className="g-ico" /> Vault ids never reach this browser
        </span>
      </div>
      {phase.kind === "error" && (
        <p className="g-error" role="alert">
          {phase.message}
        </p>
      )}
    </div>
  );
}
