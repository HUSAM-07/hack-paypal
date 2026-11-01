/**
 * Typed webhook events for the types Pact subscribes to. Parse only *after* verification.
 * Unknown types come back as `{ known: false }` rather than throwing, so a new PayPal
 * event can't break the webhook endpoint. Vault events carry vault ids: don't log them.
 */
import { z } from "zod";
import {
  Authorization,
  Capture,
  Invoice,
  Order,
  PaymentToken,
  PayoutBatchHeader,
  PayoutItem,
  Refund,
} from "../schemas";

const envelope = <T extends string, R extends z.ZodType>(
  types: readonly [T, ...T[]],
  resource: R,
) =>
  z.object({
    id: z.string(),
    event_type: z.enum(types),
    resource_type: z.string().optional(),
    resource_version: z.string().optional(),
    summary: z.string().optional(),
    create_time: z.string().optional(),
    resource,
  });

export const OrderApprovedEvent = envelope(["CHECKOUT.ORDER.APPROVED"], Order);
export const AuthorizationEvent = envelope(
  ["PAYMENT.AUTHORIZATION.CREATED", "PAYMENT.AUTHORIZATION.VOIDED"],
  Authorization,
);
export const CaptureEvent = envelope(
  [
    "PAYMENT.CAPTURE.COMPLETED",
    "PAYMENT.CAPTURE.DECLINED",
    "PAYMENT.CAPTURE.DENIED",
    "PAYMENT.CAPTURE.PENDING",
  ],
  Capture,
);
/** The resource of `PAYMENT.CAPTURE.REFUNDED` is the refund, not the capture. */
export const CaptureRefundedEvent = envelope(["PAYMENT.CAPTURE.REFUNDED"], Refund);
export const VaultTokenEvent = envelope(
  ["VAULT.PAYMENT-TOKEN.CREATED", "VAULT.PAYMENT-TOKEN.DELETED"],
  // DELETED may carry only the id.
  PaymentToken.partial().required({ id: true }),
);
export const PayoutBatchEvent = envelope(
  [
    "PAYMENT.PAYOUTSBATCH.DENIED",
    "PAYMENT.PAYOUTSBATCH.PROCESSING",
    "PAYMENT.PAYOUTSBATCH.SUCCESS",
  ],
  z.object({ batch_header: PayoutBatchHeader }),
);
export const PayoutItemEvent = envelope(
  [
    "PAYMENT.PAYOUTS-ITEM.BLOCKED",
    "PAYMENT.PAYOUTS-ITEM.CANCELED",
    "PAYMENT.PAYOUTS-ITEM.DENIED",
    "PAYMENT.PAYOUTS-ITEM.FAILED",
    "PAYMENT.PAYOUTS-ITEM.HELD",
    "PAYMENT.PAYOUTS-ITEM.REFUNDED",
    "PAYMENT.PAYOUTS-ITEM.RETURNED",
    "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  ],
  PayoutItem,
);
export const InvoiceEvent = envelope(
  ["INVOICING.INVOICE.PAID", "INVOICING.INVOICE.CANCELLED"],
  z.object({ invoice: Invoice }),
);

export const WebhookEvent = z.union([
  OrderApprovedEvent,
  AuthorizationEvent,
  CaptureEvent,
  CaptureRefundedEvent,
  VaultTokenEvent,
  PayoutBatchEvent,
  PayoutItemEvent,
  InvoiceEvent,
]);
export type WebhookEvent = z.infer<typeof WebhookEvent>;
export type WebhookEventType = WebhookEvent["event_type"];

export type ParsedWebhook =
  | { known: true; event: WebhookEvent }
  | { known: false; id: string; eventType: string; resource: unknown };

const Envelope = z.object({ id: z.string(), event_type: z.string(), resource: z.unknown() });

/** Throws only if the body isn't a webhook envelope at all. */
export function parseWebhookEvent(rawBody: string): ParsedWebhook {
  const json: unknown = JSON.parse(rawBody);
  const base = Envelope.parse(json);
  const typed = WebhookEvent.safeParse(json);
  if (typed.success) return { known: true, event: typed.data };
  return { known: false, id: base.id, eventType: base.event_type, resource: base.resource };
}
