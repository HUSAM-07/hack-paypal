import { z } from "zod";
import type { CallOptions, MutatingOptions, Transport } from "./http";
import { findLink, PaymentToken, PaymentTokenList, SetupToken } from "./schemas";

const enc = encodeURIComponent;

export interface CreateSetupTokenInput {
  payment_source: {
    paypal: {
      usage_type: "MERCHANT" | "PLATFORM";
      customer_type?: "CONSUMER" | "BUSINESS";
      usage_pattern?:
        | "IMMEDIATE"
        | "DEFERRED"
        | "RECURRING_PREPAID"
        | "RECURRING_POSTPAID"
        | "THRESHOLD_PREPAID"
        | "THRESHOLD_POSTPAID"
        | "UNSCHEDULED_PREPAID"
        | "UNSCHEDULED_POSTPAID";
      permit_multiple_payment_tokens?: boolean;
      description?: string;
      experience_context: {
        return_url: string;
        cancel_url: string;
        brand_name?: string;
        locale?: string;
        shipping_preference?: "GET_FROM_FILE" | "NO_SHIPPING" | "SET_PROVIDED_ADDRESS";
        vault_instruction?: "ON_CREATE_PAYMENT_TOKENS" | "ON_PAYER_APPROVAL";
      };
    };
  };
  /** Reuse an existing PayPal vault customer so all of a user's tokens group together. */
  customer?: { id: string };
}

export function vaultApi(t: Transport) {
  return {
    setupTokens: {
      /** `POST /v3/vault/setup-tokens`. Expect `PAYER_ACTION_REQUIRED` + an approve link. Expires in 3 days. */
      async create(input: CreateSetupTokenInput, opts: MutatingOptions): Promise<SetupToken> {
        return t.request({
          method: "POST",
          route: "/v3/vault/setup-tokens",
          path: "/v3/vault/setup-tokens",
          json: input,
          schema: SetupToken,
          idempotent: true,
          options: opts,
        });
      },
      async get(id: string, opts?: CallOptions): Promise<SetupToken> {
        return t.request({
          method: "GET",
          route: "/v3/vault/setup-tokens/:id",
          path: `/v3/vault/setup-tokens/${enc(id)}`,
          schema: SetupToken,
          idempotent: true,
          ...(opts ? { options: opts } : {}),
        });
      },
    },
    paymentTokens: {
      /** Exchange an approved setup token for a payment token. Its `id` is the vault id: server-side only. */
      async create(setupTokenId: string, opts: MutatingOptions): Promise<PaymentToken> {
        return t.request({
          method: "POST",
          route: "/v3/vault/payment-tokens",
          path: "/v3/vault/payment-tokens",
          json: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
          schema: PaymentToken,
          idempotent: true,
          options: opts,
        });
      },
      async get(id: string, opts?: CallOptions): Promise<PaymentToken> {
        return t.request({
          method: "GET",
          route: "/v3/vault/payment-tokens/:id",
          path: `/v3/vault/payment-tokens/${enc(id)}`,
          schema: PaymentToken,
          idempotent: true,
          ...(opts ? { options: opts } : {}),
        });
      },
      async list(
        query: { customer_id: string; page_size?: number; page?: number; total_required?: boolean },
        opts?: CallOptions,
      ): Promise<PaymentTokenList> {
        return t.request({
          method: "GET",
          route: "/v3/vault/payment-tokens",
          path: "/v3/vault/payment-tokens",
          query,
          schema: PaymentTokenList,
          idempotent: true,
          ...(opts ? { options: opts } : {}),
        });
      },
      /** Revoke a mandate's funding at the source (kill switch). */
      async delete(id: string, opts: MutatingOptions): Promise<void> {
        await t.request({
          method: "DELETE",
          route: "/v3/vault/payment-tokens/:id",
          path: `/v3/vault/payment-tokens/${enc(id)}`,
          schema: z.unknown(),
          allowEmpty: true,
          idempotent: true,
          options: opts,
        });
      },
    },
  };
}

export function setupTokenApproveUrl(token: SetupToken): string | undefined {
  return findLink(token.links, "approve", "payer-action");
}
