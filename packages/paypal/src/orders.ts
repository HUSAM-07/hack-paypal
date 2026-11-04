import type { Money } from "@pact/protocol";
import type { CallOptions, MutatingOptions, Transport } from "./http";
import { Authorization, Capture, findLink, Order, Refund, toAmount } from "./schemas";

const enc = encodeURIComponent;

export interface StoredCredential {
  payment_initiator: "MERCHANT" | "CUSTOMER";
  usage: "FIRST" | "SUBSEQUENT" | "DERIVED";
  usage_pattern?:
    | "IMMEDIATE"
    | "DEFERRED"
    | "RECURRING_PREPAID"
    | "RECURRING_POSTPAID"
    | "THRESHOLD_PREPAID"
    | "THRESHOLD_POSTPAID"
    | "SUBSCRIPTION_PREPAID"
    | "SUBSCRIPTION_POSTPAID"
    | "UNSCHEDULED_PREPAID"
    | "UNSCHEDULED_POSTPAID"
    | "INSTALLMENT_PREPAID"
    | "INSTALLMENT_POSTPAID";
  previous_network_transaction_reference?: { id: string; network?: string };
}

export interface ExperienceContext {
  return_url?: string;
  cancel_url?: string;
  brand_name?: string;
  user_action?: "CONTINUE" | "PAY_NOW";
  shipping_preference?: "GET_FROM_FILE" | "NO_SHIPPING" | "SET_PROVIDED_ADDRESS";
  locale?: string;
}

export interface OrderItemInput {
  name: string;
  quantity: number;
  unit_amount: Money;
  sku?: string;
  /** 12-digit UPC-A, sent as `upc: {type: "UPC-A", code}`. Lets the sale join to a product. */
  upc?: string;
  category?: "PHYSICAL_GOODS" | "DIGITAL_GOODS" | "DONATION";
}

export interface PurchaseUnitInput {
  amount: Money;
  /** When present, the amount's `breakdown.item_total` is derived from these. */
  items?: OrderItemInput[];
  reference_id?: string;
  custom_id?: string;
  invoice_id?: string;
  description?: string;
  soft_descriptor?: string;
  /** Route funds to another PayPal account. May fail with `PAYEE_NOT_CONSENTED`. */
  payee?: { email_address?: string; merchant_id?: string };
}

export type OrderPaymentSource =
  /** Off-session (MIT) charge against a vaulted PayPal wallet. */
  | { paypal: { vault_id: string; stored_credential?: StoredCredential } }
  /** Buyer-present checkout; optionally save the wallet on approval. */
  | {
      paypal: {
        experience_context?: ExperienceContext;
        attributes?: {
          vault?: {
            store_in_vault: "ON_SUCCESS";
            usage_type: "MERCHANT" | "PLATFORM";
            customer_type?: "CONSUMER" | "BUSINESS";
          };
          customer?: { id: string };
        };
      };
    };

export interface CreateOrderInput {
  intent: "CAPTURE" | "AUTHORIZE";
  purchase_units: PurchaseUnitInput[];
  payment_source?: OrderPaymentSource;
}

function serializeItem(i: OrderItemInput) {
  const { unit_amount, upc, ...rest } = i;
  return {
    ...rest,
    unit_amount: toAmount(unit_amount),
    ...(upc ? { upc: { type: "UPC-A", code: upc } } : {}),
  };
}

function serializeUnit(u: PurchaseUnitInput) {
  const { amount, items, ...rest } = u;
  if (!items?.length) return { ...rest, amount: toAmount(amount) };
  const itemTotal = items.reduce((sum, i) => sum + i.unit_amount.amountMinor * i.quantity, 0);
  return {
    ...rest,
    items: items.map((i) => ({ ...serializeItem(i), quantity: String(i.quantity) })),
    amount: {
      ...toAmount(amount),
      breakdown: { item_total: toAmount({ amountMinor: itemTotal, currency: amount.currency }) },
    },
  };
}

export function ordersApi(t: Transport) {
  return {
    /** `POST /v2/checkout/orders`. With a `vault_id` the order may come back COMPLETED directly. */
    async create(input: CreateOrderInput, opts: MutatingOptions): Promise<Order> {
      return t.request({
        method: "POST",
        route: "/v2/checkout/orders",
        path: "/v2/checkout/orders",
        json: { ...input, purchase_units: input.purchase_units.map(serializeUnit) },
        schema: Order,
        idempotent: true,
        options: opts,
      });
    },
    async get(id: string, opts?: CallOptions): Promise<Order> {
      return t.request({
        method: "GET",
        route: "/v2/checkout/orders/:id",
        path: `/v2/checkout/orders/${enc(id)}`,
        schema: Order,
        idempotent: true,
        ...(opts ? { options: opts } : {}),
      });
    },
    /** For `intent: AUTHORIZE` orders the buyer has approved. Auth ids are in `purchase_units[].payments.authorizations`. */
    async authorize(id: string, opts: MutatingOptions): Promise<Order> {
      return t.request({
        method: "POST",
        route: "/v2/checkout/orders/:id/authorize",
        path: `/v2/checkout/orders/${enc(id)}/authorize`,
        json: {},
        schema: Order,
        idempotent: true,
        options: opts,
      });
    },
    async capture(id: string, opts: MutatingOptions): Promise<Order> {
      return t.request({
        method: "POST",
        route: "/v2/checkout/orders/:id/capture",
        path: `/v2/checkout/orders/${enc(id)}/capture`,
        json: {},
        schema: Order,
        idempotent: true,
        options: opts,
      });
    },
  };
}

export interface CaptureAuthorizationInput {
  /** Omit to capture the full authorized amount. */
  amount?: Money;
  /** `false` leaves the remainder capturable (partial capture). Default true. */
  final_capture?: boolean;
  invoice_id?: string;
  note_to_payer?: string;
  soft_descriptor?: string;
}

export function authorizationsApi(t: Transport) {
  return {
    async get(id: string, opts?: CallOptions): Promise<Authorization> {
      return t.request({
        method: "GET",
        route: "/v2/payments/authorizations/:id",
        path: `/v2/payments/authorizations/${enc(id)}`,
        schema: Authorization,
        idempotent: true,
        ...(opts ? { options: opts } : {}),
      });
    },
    async capture(
      id: string,
      input: CaptureAuthorizationInput,
      opts: MutatingOptions,
    ): Promise<Capture> {
      const { amount, ...rest } = input;
      return t.request({
        method: "POST",
        route: "/v2/payments/authorizations/:id/capture",
        path: `/v2/payments/authorizations/${enc(id)}/capture`,
        json: { ...rest, ...(amount ? { amount: toAmount(amount) } : {}) },
        schema: Capture,
        idempotent: true,
        options: opts,
      });
    },
    /** Returns the voided authorization, or `null` if PayPal answers 204. */
    async void(id: string, opts: MutatingOptions): Promise<Authorization | null> {
      return t.request({
        method: "POST",
        route: "/v2/payments/authorizations/:id/void",
        path: `/v2/payments/authorizations/${enc(id)}/void`,
        schema: Authorization,
        allowEmpty: true,
        idempotent: true,
        options: opts,
      });
    },
    /** Allowed from day 4 to day 29 after the original authorization. Returns the new authorization. */
    async reauthorize(
      id: string,
      input: { amount?: Money },
      opts: MutatingOptions,
    ): Promise<Authorization> {
      return t.request({
        method: "POST",
        route: "/v2/payments/authorizations/:id/reauthorize",
        path: `/v2/payments/authorizations/${enc(id)}/reauthorize`,
        json: input.amount ? { amount: toAmount(input.amount) } : {},
        schema: Authorization,
        idempotent: true,
        options: opts,
      });
    },
  };
}

export function capturesApi(t: Transport) {
  return {
    async get(id: string, opts?: CallOptions): Promise<Capture> {
      return t.request({
        method: "GET",
        route: "/v2/payments/captures/:id",
        path: `/v2/payments/captures/${enc(id)}`,
        schema: Capture,
        idempotent: true,
        ...(opts ? { options: opts } : {}),
      });
    },
    /** Omit `amount` for a full refund. */
    async refund(
      id: string,
      input: { amount?: Money; invoice_id?: string; note_to_payer?: string },
      opts: MutatingOptions,
    ): Promise<Refund> {
      const { amount, ...rest } = input;
      return t.request({
        method: "POST",
        route: "/v2/payments/captures/:id/refund",
        path: `/v2/payments/captures/${enc(id)}/refund`,
        json: { ...rest, ...(amount ? { amount: toAmount(amount) } : {}) },
        schema: Refund,
        idempotent: true,
        options: opts,
      });
    },
  };
}

/** The buyer approval URL for an order (`approve` for v2 redirect, `payer-action` with payment_source). */
export function orderApproveUrl(order: Order): string | undefined {
  return findLink(order.links, "payer-action", "approve");
}
