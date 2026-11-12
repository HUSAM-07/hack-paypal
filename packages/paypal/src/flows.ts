/**
 * Money flows composed from client calls. Pure orchestration: none of these run policy.
 * **Callers must get `allow` from `authorize()` (`@pact/policy`) before calling any flow
 * that moves or reserves money**, and pass a deterministic `requestId` so a retried
 * workflow step replays instead of double-charging. Sub-step keys derive from it.
 */
import type { Money } from "@pact/protocol";
import type { PayPalClient } from "./client";
import { PayPalError } from "./errors";
import { invoicePayerUrl } from "./invoicing";
import type { StoredCredential } from "./orders";
import type { Authorization, Capture, Order } from "./schemas";
import { setupTokenApproveUrl } from "./vault";

const REQUEST_ID_MAX = 108;

/**
 * Deterministic `PayPal-Request-Id` from parts (`pactId`, `runId`, `userId`, step…).
 * Joined with `:`; when that exceeds PayPal's 108-char limit, the SHA-256 hex of it is used.
 */
export async function idempotencyKey(...parts: string[]): Promise<string> {
  const joined = parts.join(":");
  if (joined.length > 0 && joined.length <= REQUEST_ID_MAX) return joined;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joined));
  return `h:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ── Mandates ─────────────────────────────────────────────────────────────────

export interface StartMandateSetupInput {
  returnUrl: string;
  cancelUrl: string;
  description?: string;
  brandName?: string;
  /** Existing PayPal vault customer id for this user, if they already have one. */
  customerId?: string;
  usagePattern?: "IMMEDIATE" | "DEFERRED" | "UNSCHEDULED_POSTPAID" | "RECURRING_POSTPAID";
  requestId: string;
}

export interface MandateSetupStarted {
  setupTokenId: string;
  status: string;
  /** Redirect-flow fallback; the v6 save session uses `setupTokenId` instead. */
  approveUrl: string | undefined;
}

/**
 * Step 1 of a member's commit: a Vault setup token (save PayPal without a purchase).
 * Reserves nothing, but callers should still have an `authorize()`-approved mandate draft.
 */
export async function startMandateSetup(
  pp: PayPalClient,
  input: StartMandateSetupInput,
): Promise<MandateSetupStarted> {
  const token = await pp.vault.setupTokens.create(
    {
      payment_source: {
        paypal: {
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          usage_pattern: input.usagePattern ?? "IMMEDIATE",
          permit_multiple_payment_tokens: false,
          description: input.description ?? "Pact mandate",
          experience_context: {
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
            vault_instruction: "ON_PAYER_APPROVAL",
            shipping_preference: "NO_SHIPPING",
            ...(input.brandName ? { brand_name: input.brandName } : {}),
          },
        },
      },
      ...(input.customerId ? { customer: { id: input.customerId } } : {}),
    },
    { requestId: input.requestId },
  );
  return { setupTokenId: token.id, status: token.status, approveUrl: setupTokenApproveUrl(token) };
}

export interface MandateFunding {
  /** The vault id. Store server-side only (behind `Mandate.fundingRef`); never send to a client. */
  vaultId: string;
  customerId: string;
  payerEmail: string | undefined;
  payerId: string | undefined;
}

/** Step 2: after the buyer approves, turn the setup token into a reusable vault token. */
export async function completeMandateSetup(
  pp: PayPalClient,
  input: { setupTokenId: string; requestId: string },
): Promise<MandateFunding> {
  const token = await pp.vault.paymentTokens.create(input.setupTokenId, {
    requestId: input.requestId,
  });
  const customerId = token.customer?.id;
  if (!customerId) throw new Error("vault payment token returned without customer.id");
  return {
    vaultId: token.id,
    customerId,
    payerEmail: token.payment_source?.paypal?.email_address,
    payerId: token.payment_source?.paypal?.payer_id,
  };
}

// ── Off-session charge ───────────────────────────────────────────────────────

export const MIT_UNSCHEDULED: StoredCredential = {
  payment_initiator: "MERCHANT",
  usage: "SUBSEQUENT",
  usage_pattern: "UNSCHEDULED_POSTPAID",
};

export interface ChargeMandateInput {
  vaultId: string;
  amount: Money;
  /** Lands in `custom_id`; use the pact id so captures reconcile to pacts. */
  customId: string;
  description?: string;
  invoiceId?: string;
  payee?: { email_address?: string; merchant_id?: string };
  /** Defaults to MERCHANT / SUBSEQUENT / UNSCHEDULED_POSTPAID. `false` omits it. */
  storedCredential?: StoredCredential | false;
  intent?: "CAPTURE" | "AUTHORIZE";
  requestId: string;
  mock?: string;
  clientMetadataId?: string;
}

export type ChargeOutcome = "succeeded" | "pending" | "failed" | "payer_action_required";

export interface ChargeResult {
  outcome: ChargeOutcome;
  orderId: string;
  orderStatus: Order["status"];
  capture: Capture | undefined;
  authorization: Authorization | undefined;
}

/**
 * Off-session merchant-initiated charge against a vaulted wallet. Handles both shapes PayPal
 * may return: an order already COMPLETED on create, or APPROVED needing capture/authorize.
 * Decline mocks (`mock: "INSTRUMENT_DECLINED"`) surface as a thrown `PayPalError`.
 * **Run `authorize()` first and only call this on `allow`.**
 */
export async function chargeMandate(
  pp: PayPalClient,
  input: ChargeMandateInput,
): Promise<ChargeResult> {
  const intent = input.intent ?? "CAPTURE";
  const storedCredential =
    input.storedCredential === false ? undefined : (input.storedCredential ?? MIT_UNSCHEDULED);
  const call = {
    ...(input.mock ? { mock: input.mock } : {}),
    ...(input.clientMetadataId ? { clientMetadataId: input.clientMetadataId } : {}),
  };
  let order = await pp.orders.create(
    {
      intent,
      purchase_units: [
        {
          amount: input.amount,
          custom_id: input.customId,
          ...(input.description ? { description: input.description } : {}),
          ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
          ...(input.payee ? { payee: input.payee } : {}),
        },
      ],
      payment_source: {
        paypal: {
          vault_id: input.vaultId,
          ...(storedCredential ? { stored_credential: storedCredential } : {}),
        },
      },
    },
    { ...call, requestId: input.requestId },
  );
  if (order.status === "APPROVED") {
    const step = intent === "CAPTURE" ? "capture" : "authorize";
    const requestId = await idempotencyKey(input.requestId, step);
    order =
      intent === "CAPTURE"
        ? await pp.orders.capture(order.id, { ...call, requestId })
        : await pp.orders.authorize(order.id, { ...call, requestId });
  }
  return summarizeOrder(order);
}

function summarizeOrder(order: Order): ChargeResult {
  const payments = order.purchase_units?.[0]?.payments;
  const capture = payments?.captures?.[0];
  const authorization = payments?.authorizations?.[0];
  let outcome: ChargeOutcome = "failed";
  if (order.status === "PAYER_ACTION_REQUIRED") outcome = "payer_action_required";
  else if (capture)
    outcome =
      capture.status === "COMPLETED"
        ? "succeeded"
        : capture.status === "PENDING"
          ? "pending"
          : "failed";
  else if (authorization) {
    outcome =
      authorization.status === "CREATED"
        ? "succeeded"
        : authorization.status === "PENDING"
          ? "pending"
          : "failed";
  }
  return { outcome, orderId: order.id, orderStatus: order.status, capture, authorization };
}

// ── Group split (all-or-nothing) ─────────────────────────────────────────────

export interface GroupMember {
  memberId: string;
  amount: Money;
  source:
    | { kind: "vault"; vaultId: string; storedCredential?: StoredCredential | false }
    /** An AUTHORIZE-intent order the member approved in the browser (v6). */
    | { kind: "approved_order"; orderId: string };
}

export interface Hold {
  memberId: string;
  orderId: string;
  authorizationId: string;
  amount: Money;
  /** Capture inside the 3-day honor period; reauthorize after that is possible but avoid it. */
  expirationTime: string | undefined;
}

export interface MemberFailure {
  memberId: string;
  /** PayPal's error name or our reason; safe to show and log (no ids, no bodies). */
  reason: string;
  issues: string[];
  debugId: string | undefined;
}

export type GroupAuthorizeResult =
  | { ok: true; holds: Hold[] }
  | { ok: false; failures: MemberFailure[]; released: VoidAllResult };

function toFailure(memberId: string, e: unknown): MemberFailure {
  if (e instanceof PayPalError)
    return { memberId, reason: e.code, issues: e.issues, debugId: e.debugId };
  return {
    memberId,
    reason: e instanceof Error ? e.message : "unknown",
    issues: [],
    debugId: undefined,
  };
}

/**
 * Places one authorization hold per member. If any member fails, every hold that did
 * succeed is voided and nothing is captured. **Run `authorize()` for every member first.**
 */
export async function groupAuthorizeAll(
  pp: PayPalClient,
  input: {
    customId: string;
    members: GroupMember[];
    requestIdPrefix: string;
    description?: string;
  },
): Promise<GroupAuthorizeResult> {
  const settled = await Promise.allSettled(
    input.members.map(async (m): Promise<Hold> => {
      const requestId = await idempotencyKey(input.requestIdPrefix, m.memberId, "authorize");
      if (m.source.kind === "vault") {
        const res = await chargeMandate(pp, {
          vaultId: m.source.vaultId,
          amount: m.amount,
          customId: input.customId,
          intent: "AUTHORIZE",
          requestId,
          ...(m.source.storedCredential !== undefined
            ? { storedCredential: m.source.storedCredential }
            : {}),
          ...(input.description ? { description: input.description } : {}),
        });
        if (res.outcome !== "succeeded" || !res.authorization)
          throw new Error(`authorization ${res.outcome}`);
        return {
          memberId: m.memberId,
          orderId: res.orderId,
          authorizationId: res.authorization.id,
          amount: res.authorization.amount ?? m.amount,
          expirationTime: res.authorization.expiration_time,
        };
      }
      const order = await pp.orders.authorize(m.source.orderId, { requestId });
      const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (auth?.status !== "CREATED") throw new Error(`authorization ${auth?.status ?? "missing"}`);
      return {
        memberId: m.memberId,
        orderId: order.id,
        authorizationId: auth.id,
        amount: auth.amount ?? m.amount,
        expirationTime: auth.expiration_time,
      };
    }),
  );

  const holds: Hold[] = [];
  const failures: MemberFailure[] = [];
  settled.forEach((r, i) => {
    const memberId = input.members[i]?.memberId ?? String(i);
    if (r.status === "fulfilled") holds.push(r.value);
    else failures.push(toFailure(memberId, r.reason));
  });
  if (failures.length === 0) return { ok: true, holds };
  const released = await voidAll(pp, { holds, requestIdPrefix: input.requestIdPrefix });
  return { ok: false, failures, released };
}

export interface CaptureAllResult {
  ok: boolean;
  captured: {
    memberId: string;
    captureId: string;
    status: Capture["status"];
    amount: Money | undefined;
  }[];
  failed: MemberFailure[];
}

/**
 * Captures every hold (full amount unless `amount` is given, e.g. the price dropped).
 * Captures can't be undone atomically: on partial failure the caller decides between
 * retrying (same keys replay safely) and refunding `captured` via `captures.refund`.
 * **Run `authorize()` before capturing.**
 */
export async function captureAll(
  pp: PayPalClient,
  input: {
    holds: (Pick<Hold, "memberId" | "authorizationId"> & { amount?: Money })[];
    requestIdPrefix: string;
  },
): Promise<CaptureAllResult> {
  const settled = await Promise.allSettled(
    input.holds.map(async (h) => {
      const requestId = await idempotencyKey(input.requestIdPrefix, h.memberId, "capture");
      const cap = await pp.authorizations.capture(
        h.authorizationId,
        { final_capture: true, ...(h.amount ? { amount: h.amount } : {}) },
        { requestId },
      );
      if (cap.status !== "COMPLETED" && cap.status !== "PENDING")
        throw new Error(`capture ${cap.status}`);
      return { memberId: h.memberId, captureId: cap.id, status: cap.status, amount: cap.amount };
    }),
  );
  const out: CaptureAllResult = { ok: true, captured: [], failed: [] };
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") out.captured.push(r.value);
    else out.failed.push(toFailure(input.holds[i]?.memberId ?? String(i), r.reason));
  });
  out.ok = out.failed.length === 0;
  return out;
}

/** Void issues meaning "nothing is held any more", which is what voiding wants. */
const ALREADY_RELEASED = new Set([
  "PREVIOUSLY_VOIDED",
  "AUTHORIZATION_VOIDED",
  "AUTHORIZATION_EXPIRED",
]);

export interface VoidAllResult {
  ok: boolean;
  voided: string[];
  failed: MemberFailure[];
}

/** Releases every hold. Already-voided or expired authorizations count as released. */
export async function voidAll(
  pp: PayPalClient,
  input: { holds: Pick<Hold, "memberId" | "authorizationId">[]; requestIdPrefix: string },
): Promise<VoidAllResult> {
  const settled = await Promise.allSettled(
    input.holds.map(async (h) => {
      const requestId = await idempotencyKey(input.requestIdPrefix, h.memberId, "void");
      try {
        await pp.authorizations.void(h.authorizationId, { requestId });
      } catch (e) {
        if (!(e instanceof PayPalError && e.issues.some((i) => ALREADY_RELEASED.has(i)))) throw e;
      }
      return h.memberId;
    }),
  );
  const out: VoidAllResult = { ok: true, voided: [], failed: [] };
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") out.voided.push(r.value);
    else out.failed.push(toFailure(input.holds[i]?.memberId ?? String(i), r.reason));
  });
  out.ok = out.failed.length === 0;
  return out;
}

// ── P2P (platform-mediated) ──────────────────────────────────────────────────

export interface SendP2PInput {
  receiver: string;
  recipientType?: "EMAIL" | "PHONE" | "PAYPAL_ID" | "USER_HANDLE";
  wallet?: "PAYPAL" | "VENMO";
  amount: Money;
  /** Unique for 30 days. Derive it from the pact/run so a replay is rejected, not re-paid. */
  senderBatchId: string;
  senderItemId?: string;
  note?: string;
  emailSubject?: string;
  emailMessage?: string;
  requestId: string;
}

/**
 * Pays a person from the platform balance via Payouts. The sender must already have been
 * charged (e.g. `chargeMandate`). Async: the batch starts PENDING; track it by webhook or
 * `payouts.getBatch`. **Run `authorize()` first.**
 */
export async function sendP2P(
  pp: PayPalClient,
  input: SendP2PInput,
): Promise<{ payoutBatchId: string; batchStatus: string }> {
  const res = await pp.payouts.createBatch(
    {
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        ...(input.emailSubject ? { email_subject: input.emailSubject } : {}),
        ...(input.emailMessage ? { email_message: input.emailMessage } : {}),
      },
      items: [
        {
          recipient_type: input.recipientType ?? "EMAIL",
          receiver: input.receiver,
          amount: input.amount,
          recipient_wallet: input.wallet ?? "PAYPAL",
          ...(input.note ? { note: input.note } : {}),
          ...(input.senderItemId ? { sender_item_id: input.senderItemId } : {}),
        },
      ],
    },
    { requestId: input.requestId },
  );
  return {
    payoutBatchId: res.batch_header.payout_batch_id,
    batchStatus: res.batch_header.batch_status,
  };
}

export interface RequestP2PInput {
  payerEmail: string;
  payerName?: { given_name?: string; surname?: string };
  amount: Money;
  itemName: string;
  note?: string;
  invoiceNumber?: string;
  /** ISO date (YYYY-MM-DD). */
  dueDate?: string;
  allowPartial?: boolean;
  minimumDue?: Money;
  requestId: string;
}

/**
 * Requests money from someone outside the app: creates an invoice and emails it.
 * Doesn't move money by itself, but it's still a payee-facing action: **run `authorize()` first.**
 */
export async function requestP2P(
  pp: PayPalClient,
  input: RequestP2PInput,
): Promise<{ invoiceId: string; status: string; payerUrl: string | undefined }> {
  const inv = await pp.invoicing.create(
    {
      detail: {
        currency_code: input.amount.currency,
        ...(input.invoiceNumber ? { invoice_number: input.invoiceNumber } : {}),
        ...(input.note ? { note: input.note } : {}),
        ...(input.dueDate ? { payment_term: { due_date: input.dueDate } } : {}),
      },
      primary_recipients: [
        {
          billing_info: {
            email_address: input.payerEmail,
            ...(input.payerName ? { name: input.payerName } : {}),
          },
        },
      ],
      items: [{ name: input.itemName, quantity: "1", unit_amount: input.amount }],
      ...(input.allowPartial
        ? {
            configuration: {
              partial_payment: {
                allow_partial_payment: true,
                ...(input.minimumDue ? { minimum_amount_due: input.minimumDue } : {}),
              },
            },
          }
        : {}),
    },
    { requestId: input.requestId },
  );
  const sent = await pp.invoicing.send(
    inv.id,
    { send_to_recipient: true, send_to_invoicer: false },
    { requestId: await idempotencyKey(input.requestId, "send") },
  );
  return { invoiceId: inv.id, status: "SENT", payerUrl: sent?.payerUrl ?? invoicePayerUrl(inv) };
}
