/**
 * Zod schemas for the response fields we use. Unknown fields are stripped; amounts are
 * parsed straight into `Money` so no PayPal decimal string escapes this package.
 */
import { fromPayPalValue, Money, toPayPalValue } from "@pact/protocol";
import { z } from "zod";

function moneyFrom(value: string, currency: string, ctx: z.RefinementCtx): Money {
  try {
    return fromPayPalValue(value, currency);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: (e as Error).message });
    return z.NEVER;
  }
}

/** `{currency_code, value}`: Orders, Payments, Vault, Invoicing. */
export const PayPalAmount = z
  .object({ currency_code: z.string(), value: z.string() })
  .transform((a, ctx) => moneyFrom(a.value, a.currency_code, ctx));

/** `{currency, value}`: Payouts uses a different key. */
export const PayoutAmount = z
  .object({ currency: z.string(), value: z.string() })
  .transform((a, ctx) => moneyFrom(a.value, a.currency, ctx));

export function toAmount(m: Money): { currency_code: string; value: string } {
  const v = Money.parse(m);
  return { currency_code: v.currency, value: toPayPalValue(v) };
}

export function toPayoutAmount(m: Money): { currency: string; value: string } {
  const v = Money.parse(m);
  return { currency: v.currency, value: toPayPalValue(v) };
}

export const Link = z.object({
  href: z.string(),
  rel: z.string(),
  method: z.string().optional(),
});
export type Link = z.infer<typeof Link>;
export const Links = z.array(Link).optional();

export function findLink(links: Link[] | undefined, ...rels: string[]): string | undefined {
  return links?.find((l) => rels.includes(l.rel))?.href;
}

const StatusDetails = z.object({ reason: z.string().optional() }).optional();

export const Authorization = z.object({
  id: z.string(),
  status: z.enum(["CREATED", "CAPTURED", "DENIED", "PARTIALLY_CAPTURED", "VOIDED", "PENDING"]),
  status_details: StatusDetails,
  amount: PayPalAmount.optional(),
  invoice_id: z.string().optional(),
  custom_id: z.string().optional(),
  expiration_time: z.string().optional(),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
  links: Links,
});
export type Authorization = z.infer<typeof Authorization>;

export const Capture = z.object({
  id: z.string(),
  status: z.enum(["COMPLETED", "DECLINED", "PARTIALLY_REFUNDED", "PENDING", "REFUNDED", "FAILED"]),
  status_details: StatusDetails,
  amount: PayPalAmount.optional(),
  final_capture: z.boolean().optional(),
  invoice_id: z.string().optional(),
  custom_id: z.string().optional(),
  seller_receivable_breakdown: z
    .object({
      gross_amount: PayPalAmount.optional(),
      paypal_fee: PayPalAmount.optional(),
      net_amount: PayPalAmount.optional(),
    })
    .optional(),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
  links: Links,
});
export type Capture = z.infer<typeof Capture>;

export const Refund = z.object({
  id: z.string(),
  status: z.enum(["CANCELLED", "FAILED", "PENDING", "COMPLETED"]),
  status_details: StatusDetails,
  amount: PayPalAmount.optional(),
  invoice_id: z.string().optional(),
  custom_id: z.string().optional(),
  create_time: z.string().optional(),
  links: Links,
});
export type Refund = z.infer<typeof Refund>;

export const Payee = z.object({
  email_address: z.string().optional(),
  merchant_id: z.string().optional(),
});

export const Order = z.object({
  id: z.string(),
  status: z.enum(["CREATED", "SAVED", "APPROVED", "VOIDED", "COMPLETED", "PAYER_ACTION_REQUIRED"]),
  intent: z.enum(["CAPTURE", "AUTHORIZE"]).optional(),
  payment_source: z
    .object({
      paypal: z
        .object({
          email_address: z.string().optional(),
          account_id: z.string().optional(),
          account_status: z.string().optional(),
          attributes: z
            .object({
              vault: z
                .object({
                  id: z.string().optional(),
                  status: z.string().optional(),
                  customer: z.object({ id: z.string() }).optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        invoice_id: z.string().optional(),
        description: z.string().optional(),
        amount: PayPalAmount.optional(),
        payee: Payee.optional(),
        payments: z
          .object({
            authorizations: z.array(Authorization).optional(),
            captures: z.array(Capture).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
  links: Links,
});
export type Order = z.infer<typeof Order>;

const VaultPayPalSource = z
  .object({
    email_address: z.string().optional(),
    payer_id: z.string().optional(),
    usage_type: z.string().optional(),
    customer_type: z.string().optional(),
  })
  .optional();

export const SetupToken = z.object({
  id: z.string(),
  status: z.enum(["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED", "VAULTED", "TOKENIZED"]),
  customer: z.object({ id: z.string() }).optional(),
  payment_source: z.object({ paypal: VaultPayPalSource }).optional(),
  links: Links,
});
export type SetupToken = z.infer<typeof SetupToken>;

export const PaymentToken = z.object({
  id: z.string(),
  customer: z.object({ id: z.string() }).optional(),
  payment_source: z.object({ paypal: VaultPayPalSource }).optional(),
  links: Links,
});
export type PaymentToken = z.infer<typeof PaymentToken>;

export const PaymentTokenList = z.object({
  customer: z.object({ id: z.string() }).optional(),
  payment_tokens: z.array(PaymentToken).default([]),
  total_items: z.number().optional(),
  total_pages: z.number().optional(),
  links: Links,
});
export type PaymentTokenList = z.infer<typeof PaymentTokenList>;

export const PayoutBatchStatus = z.enum(["DENIED", "PENDING", "PROCESSING", "SUCCESS", "CANCELED"]);
export const PayoutItemStatus = z.enum([
  "SUCCESS",
  "FAILED",
  "PENDING",
  "UNCLAIMED",
  "RETURNED",
  "ONHOLD",
  "BLOCKED",
  "REFUNDED",
  "REVERSED",
]);

const SenderBatchHeader = z.object({
  sender_batch_id: z.string().optional(),
  email_subject: z.string().optional(),
  recipient_type: z.string().optional(),
});

export const PayoutBatchHeader = z.object({
  payout_batch_id: z.string(),
  batch_status: PayoutBatchStatus,
  sender_batch_header: SenderBatchHeader.optional(),
  time_created: z.string().optional(),
  time_completed: z.string().optional(),
  amount: PayoutAmount.optional(),
  fees: PayoutAmount.optional(),
});

export const PayoutItem = z.object({
  payout_item_id: z.string(),
  transaction_id: z.string().optional(),
  transaction_status: PayoutItemStatus.optional(),
  payout_batch_id: z.string().optional(),
  payout_item_fee: PayoutAmount.optional(),
  payout_item: z.object({
    recipient_type: z.string().optional(),
    receiver: z.string().optional(),
    amount: PayoutAmount,
    note: z.string().optional(),
    sender_item_id: z.string().optional(),
    recipient_wallet: z.string().optional(),
  }),
  time_processed: z.string().optional(),
  errors: z.object({ name: z.string().optional(), message: z.string().optional() }).optional(),
  links: Links,
});
export type PayoutItem = z.infer<typeof PayoutItem>;

export const PayoutBatchCreated = z.object({
  batch_header: PayoutBatchHeader,
  links: Links,
});
export type PayoutBatchCreated = z.infer<typeof PayoutBatchCreated>;

export const PayoutBatch = z.object({
  batch_header: PayoutBatchHeader,
  items: z.array(PayoutItem).default([]),
  total_items: z.number().optional(),
  total_pages: z.number().optional(),
  links: Links,
});
export type PayoutBatch = z.infer<typeof PayoutBatch>;

export const InvoiceStatus = z.enum([
  "DRAFT",
  "SENT",
  "SCHEDULED",
  "PAID",
  "MARKED_AS_PAID",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_PAID",
  "PARTIALLY_REFUNDED",
  "MARKED_AS_REFUNDED",
  "UNPAID",
  "PAYMENT_PENDING",
]);

export const Invoice = z.object({
  id: z.string(),
  status: InvoiceStatus,
  detail: z
    .object({
      invoice_number: z.string().optional(),
      currency_code: z.string().optional(),
      note: z.string().optional(),
      metadata: z
        .object({
          recipient_view_url: z.string().optional(),
          invoicer_view_url: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  amount: PayPalAmount.optional(),
  due_amount: PayPalAmount.optional(),
  payments: z
    .object({
      paid_amount: PayPalAmount.optional(),
      transactions: z
        .array(
          z.object({
            payment_id: z.string().optional(),
            amount: PayPalAmount.optional(),
            method: z.string().optional(),
            payment_date: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  links: Links,
});
export type Invoice = z.infer<typeof Invoice>;

export const AccessToken = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
  app_id: z.string().optional(),
  nonce: z.string().optional(),
});

export const UserTokens = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
  nonce: z.string().optional(),
});
export type UserTokens = z.infer<typeof UserTokens>;

export const UserInfo = z.object({
  user_id: z.string(),
  sub: z.string().optional(),
  name: z.string().optional(),
  payer_id: z.string().optional(),
  email: z.string().optional(),
  verified_account: z.union([z.boolean(), z.string()]).optional(),
  emails: z
    .array(
      z.object({
        value: z.string(),
        primary: z.boolean().optional(),
        confirmed: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type UserInfo = z.infer<typeof UserInfo>;

export const VerifySignatureResponse = z.object({
  verification_status: z.enum(["SUCCESS", "FAILURE"]),
});
