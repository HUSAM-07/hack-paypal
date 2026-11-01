/**
 * Mode-aware money movements. Callers own policy: each function here is reached only
 * after `authorize()` allowed the spend (or the addressed member approved it).
 */
import { chargeMandate, PayPalError, sendP2P } from "@pact/paypal";
import type { Money } from "@pact/protocol";
import type { Env } from "../env";
import { failureReason, PayPalNotConfigured, paypalFor } from "./paypal";

export interface ChargeOutcome {
  status: "charged" | "pending" | "failed";
  /** Capture id when captured, else the order id. */
  paypalRef?: string;
  orderId?: string;
  captureId?: string;
  reason?: string;
  simulated: boolean;
}

/**
 * 5xx, 429 and network errors that survived the client's retries leave the outcome
 * unknown, so the reservation stays and a replay with the same request id resolves it.
 */
function unknownOutcome(e: unknown): boolean {
  return e instanceof PayPalError && (e.status === 0 || e.status === 429 || e.status >= 500);
}

export async function chargeVault(
  env: Env,
  input: {
    vaultId: string | null;
    amount: Money;
    customId: string;
    description: string;
    requestId: string;
  },
): Promise<ChargeOutcome> {
  const pp = tryPayPal(env);
  if (pp === "unavailable")
    return { status: "failed", reason: "paypal_unavailable", simulated: false };
  if (!pp) {
    const ref = `SIMULATED-${input.requestId.replace(/^spend:/, "")}`;
    return { status: "charged", paypalRef: ref, simulated: true };
  }
  if (!input.vaultId) return { status: "failed", reason: "no_funding", simulated: false };
  try {
    const res = await chargeMandate(pp, {
      vaultId: input.vaultId,
      amount: input.amount,
      customId: input.customId.slice(0, 127),
      description: input.description.slice(0, 127),
      requestId: input.requestId,
    });
    const captureId = res.capture?.id;
    const base = {
      orderId: res.orderId,
      paypalRef: captureId ?? res.orderId,
      ...(captureId ? { captureId } : {}),
      simulated: false,
    };
    if (res.outcome === "succeeded") return { status: "charged", ...base };
    if (res.outcome === "pending") return { status: "pending", ...base };
    return { status: "failed", reason: res.outcome, ...base };
  } catch (e) {
    const reason = failureReason(e);
    return { status: unknownOutcome(e) ? "pending" : "failed", reason, simulated: false };
  }
}

export interface PayoutOutcome {
  status: "sent" | "failed";
  paypalRef?: string;
  reason?: string;
  simulated: boolean;
}

/** Platform-mediated P2P: the sender was already charged; this pays the recipient. */
export async function payout(
  env: Env,
  input: { receiver: string; amount: Money; note: string; batchId: string },
): Promise<PayoutOutcome> {
  const pp = tryPayPal(env);
  if (pp === "unavailable")
    return { status: "failed", reason: "paypal_unavailable", simulated: false };
  if (!pp) return { status: "sent", paypalRef: `SIMULATED-${input.batchId}`, simulated: true };
  try {
    const res = await sendP2P(pp, {
      receiver: input.receiver,
      amount: input.amount,
      note: input.note.slice(0, 4000),
      senderBatchId: input.batchId.slice(0, 127),
      senderItemId: input.batchId.slice(0, 63),
      requestId: input.batchId,
    });
    return { status: "sent", paypalRef: res.payoutBatchId, simulated: false };
  } catch (e) {
    return { status: "failed", reason: failureReason(e), simulated: false };
  }
}

/** Misconfiguration becomes a clean failure so callers release what they reserved. */
function tryPayPal(env: Env) {
  try {
    return paypalFor(env);
  } catch (e) {
    if (e instanceof PayPalNotConfigured) return "unavailable" as const;
    throw e;
  }
}
