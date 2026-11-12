import type { Money } from "@pact/protocol";
import type { CallOptions, MutatingOptions, Transport } from "./http";
import { PayoutBatch, PayoutBatchCreated, PayoutItem, toPayoutAmount } from "./schemas";

const enc = encodeURIComponent;

export type RecipientType = "EMAIL" | "PHONE" | "PAYPAL_ID" | "USER_HANDLE";

export interface PayoutItemInput {
  recipient_type?: RecipientType;
  receiver: string;
  amount: Money;
  note?: string;
  sender_item_id?: string;
  recipient_wallet?: "PAYPAL" | "VENMO" | "RECIPIENT_SELECTED";
  purpose?: string;
}

export interface CreatePayoutBatchInput {
  sender_batch_header: {
    /** Unique for 30 days; PayPal rejects a reused id, which makes the batch idempotent. */
    sender_batch_id: string;
    email_subject?: string;
    email_message?: string;
    recipient_type?: RecipientType;
  };
  items: PayoutItemInput[];
}

export function payoutsApi(t: Transport) {
  return {
    /** Async: the batch starts PENDING. Poll `getBatch` or listen for `PAYMENT.PAYOUTSBATCH.*`. */
    async createBatch(
      input: CreatePayoutBatchInput,
      opts: MutatingOptions,
    ): Promise<PayoutBatchCreated> {
      return t.request({
        method: "POST",
        route: "/v1/payments/payouts",
        path: "/v1/payments/payouts",
        json: {
          sender_batch_header: input.sender_batch_header,
          items: input.items.map(({ amount, ...rest }) => ({
            ...rest,
            amount: toPayoutAmount(amount),
          })),
        },
        schema: PayoutBatchCreated,
        idempotent: true,
        options: opts,
      });
    },
    async getBatch(
      id: string,
      query?: { page?: number; page_size?: number; total_required?: boolean },
      opts?: CallOptions,
    ): Promise<PayoutBatch> {
      return t.request({
        method: "GET",
        route: "/v1/payments/payouts/:id",
        path: `/v1/payments/payouts/${enc(id)}`,
        ...(query ? { query } : {}),
        schema: PayoutBatch,
        idempotent: true,
        ...(opts ? { options: opts } : {}),
      });
    },
    async getItem(id: string, opts?: CallOptions): Promise<PayoutItem> {
      return t.request({
        method: "GET",
        route: "/v1/payments/payouts-item/:id",
        path: `/v1/payments/payouts-item/${enc(id)}`,
        schema: PayoutItem,
        idempotent: true,
        ...(opts ? { options: opts } : {}),
      });
    },
  };
}
