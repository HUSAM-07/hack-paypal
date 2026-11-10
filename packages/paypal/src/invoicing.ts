import type { Money } from "@pact/protocol";
import { z } from "zod";
import type { CallOptions, MutatingOptions, Transport } from "./http";
import { findLink, Invoice, toAmount } from "./schemas";

const enc = encodeURIComponent;

export interface InvoiceItemInput {
  name: string;
  /** PayPal takes a decimal string; whole units are typical ("1"). */
  quantity: string;
  unit_amount: Money;
  description?: string;
  /** Item-level discount, taken off this line's total (never more than it). */
  discount?: { amount: Money };
  /** yyyy-MM-dd */
  item_date?: string;
}

export interface CreateInvoiceInput {
  detail: {
    currency_code: string;
    invoice_number?: string;
    /** yyyy-MM-dd */
    invoice_date?: string;
    reference?: string;
    note?: string;
    memo?: string;
    term?: string;
    payment_term?: { term_type?: string; due_date?: string };
  };
  invoicer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  primary_recipients?: {
    billing_info: { email_address: string; name?: { given_name?: string; surname?: string } };
  }[];
  items: InvoiceItemInput[];
  configuration?: {
    allow_tip?: boolean;
    partial_payment?: { allow_partial_payment: boolean; minimum_amount_due?: Money };
  };
}

export interface NotifyInput {
  subject?: string;
  note?: string;
  send_to_invoicer?: boolean;
  send_to_recipient?: boolean;
}

/** An external payment recorded against an invoice (cash, bank transfer, a prior capture…). */
export interface RecordPaymentInput {
  method:
    | "BANK_TRANSFER"
    | "CASH"
    | "CHECK"
    | "CREDIT_CARD"
    | "DEBIT_CARD"
    | "PAYPAL"
    | "WIRE_TRANSFER"
    | "OTHER";
  /** yyyy-MM-dd */
  payment_date?: string;
  note?: string;
  /** Omit to mark the whole amount due as paid. */
  amount?: Money;
}

const PaymentReference = z.object({ payment_id: z.string() });

const SendResult = z.object({
  href: z.string().optional(),
  rel: z.string().optional(),
  method: z.string().optional(),
});

export function invoicingApi(t: Transport) {
  return {
    /** Creates a DRAFT. Call `send` to email it to the recipient. */
    async create(input: CreateInvoiceInput, opts: MutatingOptions): Promise<Invoice> {
      const pp = input.configuration?.partial_payment;
      return t.request({
        method: "POST",
        route: "/v2/invoicing/invoices",
        path: "/v2/invoicing/invoices",
        json: {
          ...input,
          items: input.items.map(({ unit_amount, discount, ...rest }) => ({
            ...rest,
            unit_amount: toAmount(unit_amount),
            ...(discount ? { discount: { amount: toAmount(discount.amount) } } : {}),
          })),
          ...(input.configuration
            ? {
                configuration: {
                  ...input.configuration,
                  ...(pp
                    ? {
                        partial_payment: {
                          allow_partial_payment: pp.allow_partial_payment,
                          ...(pp.minimum_amount_due
                            ? { minimum_amount_due: toAmount(pp.minimum_amount_due) }
                            : {}),
                        },
                      }
                    : {}),
                },
              }
            : {}),
        },
        schema: Invoice,
        idempotent: true,
        options: opts,
      });
    },
    /** Returns the payer-facing link when PayPal includes one (200), or `null` on 202. */
    async send(
      id: string,
      input: NotifyInput,
      opts: MutatingOptions,
    ): Promise<{ payerUrl?: string } | null> {
      const res = await t.request({
        method: "POST",
        route: "/v2/invoicing/invoices/:id/send",
        path: `/v2/invoicing/invoices/${enc(id)}/send`,
        json: input,
        schema: SendResult,
        allowEmpty: true,
        idempotent: true,
        options: opts,
      });
      return res?.href ? { payerUrl: res.href } : null;
    },
    async get(id: string, opts?: CallOptions): Promise<Invoice> {
      return t.request({
        method: "GET",
        route: "/v2/invoicing/invoices/:id",
        path: `/v2/invoicing/invoices/${enc(id)}`,
        schema: Invoice,
        idempotent: true,
        ...(opts ? { options: opts } : {}),
      });
    },
    /**
     * Record a payment made outside the invoice (PayPal `invoices/{id}/payments`). A SENT
     * invoice paid in full becomes MARKED_AS_PAID with nothing due.
     */
    async recordPayment(
      id: string,
      input: RecordPaymentInput,
      opts: MutatingOptions,
    ): Promise<{ paymentId: string }> {
      const { amount, ...rest } = input;
      const res = await t.request({
        method: "POST",
        route: "/v2/invoicing/invoices/:id/payments",
        path: `/v2/invoicing/invoices/${enc(id)}/payments`,
        json: { ...rest, ...(amount ? { amount: toAmount(amount) } : {}) },
        schema: PaymentReference,
        idempotent: true,
        options: opts,
      });
      return { paymentId: res.payment_id };
    },
    /** Only SENT/UNPAID invoices can be cancelled; PayPal answers 204. */
    async cancel(id: string, input: NotifyInput, opts: MutatingOptions): Promise<void> {
      await t.request({
        method: "POST",
        route: "/v2/invoicing/invoices/:id/cancel",
        path: `/v2/invoicing/invoices/${enc(id)}/cancel`,
        json: input,
        schema: z.unknown(),
        allowEmpty: true,
        idempotent: true,
        options: opts,
      });
    },
  };
}

export function invoicePayerUrl(inv: Invoice): string | undefined {
  return inv.detail?.metadata?.recipient_view_url ?? findLink(inv.links, "payer-view");
}
