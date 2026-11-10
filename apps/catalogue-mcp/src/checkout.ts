import { MIT_UNSCHEDULED, type PayPalClient, PayPalError } from "@pact/paypal";
import { CUSTOM_ID_MAX, type Money, verifyPassport } from "@pact/protocol";
import type { Catalogue } from "./catalogue";
import type { Payee, SellerId } from "./sellers";

/**
 * The agent platform pays for the agent: it creates the Orders v2 order itself, with the
 * seller's PayPal account as `payee`, the signed passport in `custom_id`, the UPC on the item,
 * and the buyer's vaulted PayPal wallet as the payment source. No storefront, no redirect.
 *
 * Which call goes where (cited/spec/AGENT-CHECKOUT.md): order creation uses our Orders v2
 * client, because the PayPal Agent Toolkit's `create_order` cannot carry `payee`, `custom_id`,
 * `items[].upc` or a vaulted `payment_source`; the capture, the order read-back and the seller's
 * refund run through the toolkit's `pay_order`, `get_order` and `create_refund` tools.
 */
export interface CheckoutInput {
  offerId: string;
  /** Signed Agent Affiliate Passport. Omitted for agents that never searched the catalogue. */
  passport?: string | undefined;
  quantity?: number | undefined;
  /** Caller-chosen attempt id: the same value always maps to the same PayPal order. */
  clientRef?: string | undefined;
}

export interface CheckoutResult {
  orderId: string;
  captureId: string | null;
  status: string;
  offerId: string;
  upc: string;
  seller: { id: SellerId; name: string; payee: Payee };
  quantity: number;
  total: Money;
  /** What rode in `custom_id`. */
  customId: string | null;
}

export class CheckoutError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CheckoutDeps {
  catalogue: Catalogue;
  paypal: PayPalClient;
  /** `vault_id` of the buyer's PayPal wallet, linked to the agent once. */
  buyerVaultId: string | undefined;
}

async function shortHash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Deterministic `PayPal-Request-Id` (rule 6): a retried checkout cannot pay twice. */
export async function checkoutRequestId(i: CheckoutInput): Promise<string> {
  const h = await shortHash(
    [i.clientRef ?? "", i.offerId, i.quantity ?? 1, i.passport ?? ""].join("\n"),
  );
  return `cited-checkout-${h}`;
}

export async function checkout(deps: CheckoutDeps, input: CheckoutInput): Promise<CheckoutResult> {
  const offer = deps.catalogue.offer(input.offerId);
  if (!offer) throw new CheckoutError(404, "unknown_offer", `no offer ${input.offerId}`);
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new CheckoutError(400, "bad_quantity", "quantity must be an integer from 1 to 10");
  }
  const { passport } = input;
  if (passport !== undefined) {
    if (passport.length > CUSTOM_ID_MAX) {
      throw new CheckoutError(400, "bad_passport", "passport does not fit custom_id");
    }
    const v = await verifyPassport(passport, deps.catalogue.passportKey);
    if (!v.ok) throw new CheckoutError(400, "bad_passport", `passport rejected: ${v.reason}`);
  }
  if (!deps.buyerVaultId) {
    throw new CheckoutError(
      409,
      "buyer_not_linked",
      "the buyer has not linked a PayPal wallet to this agent (CITED_BUYER_VAULT_ID)",
    );
  }

  const total = { amountMinor: offer.price.amountMinor * quantity, currency: offer.price.currency };
  try {
    let order = await deps.paypal.orders.create(
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: offer.seller.id,
            payee: offer.seller.payee,
            amount: total,
            items: [
              {
                name: `${offer.brand} ${offer.name}`,
                quantity,
                unit_amount: offer.price,
                upc: offer.upc,
                category: "PHYSICAL_GOODS",
              },
            ],
            // The signed passport is what joins this sale to the test the agent saw (rule 4).
            ...(passport ? { custom_id: passport } : {}),
          },
        ],
        payment_source: {
          paypal: {
            vault_id: deps.buyerVaultId,
            // The buyer agreed once, when linking the wallet; the agent pays on their behalf.
            stored_credential: MIT_UNSCHEDULED,
          },
        },
      },
      { requestId: await checkoutRequestId(input) },
    );
    // A vaulted wallet normally comes back COMPLETED; capture if PayPal stopped at APPROVED,
    // with the PayPal Agent Toolkit's `pay_order` tool.
    if (order.status === "APPROVED") {
      order = await deps.paypal.agentToolkit.payOrder(order.id, {
        requestId: `cited-capture-${order.id}`.slice(0, 108),
      });
    }
    // Read back what PayPal holds (toolkit `get_order`): the status, the capture and the
    // custom_id the engine will join on. The payment has already happened, so a failed read
    // falls back to the create/capture response instead of failing the checkout.
    const paid = order;
    order = await deps.paypal.agentToolkit.getOrder(paid.id).catch((e: unknown) => {
      console.warn(`checkout: toolkit get_order read-back failed: ${(e as Error).message}`);
      return paid;
    });
    const unit = order.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    return {
      orderId: order.id,
      captureId: capture?.id ?? null,
      status: order.status,
      offerId: offer.offerId,
      upc: offer.upc,
      seller: offer.seller,
      quantity,
      total,
      customId: capture?.custom_id ?? unit?.custom_id ?? passport ?? null,
    };
  } catch (e) {
    if (e instanceof PayPalError) throw new CheckoutError(502, "paypal_error", e.message);
    throw e;
  }
}

export interface OrderStatus {
  orderId: string;
  status: string;
  sellerId: string | null;
  payee: { email_address?: string | undefined; merchant_id?: string | undefined } | null;
  /** The signed passport PayPal holds for this sale, the engine's join key. */
  customId: string | null;
  captureId: string | null;
  captureStatus: string | null;
}

/** An order as PayPal holds it, read with the PayPal Agent Toolkit's `get_order` tool. */
export async function orderStatus(paypal: PayPalClient, orderId: string): Promise<OrderStatus> {
  try {
    const order = await paypal.agentToolkit.getOrder(orderId);
    const unit = order.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    return {
      orderId: order.id,
      status: order.status,
      sellerId: unit?.reference_id ?? null,
      payee: unit?.payee ?? null,
      customId: capture?.custom_id ?? unit?.custom_id ?? null,
      captureId: capture?.id ?? null,
      captureStatus: capture?.status ?? null,
    };
  } catch (e) {
    if (e instanceof PayPalError) {
      throw new CheckoutError(e.status === 404 ? 404 : 502, "paypal_error", e.message);
    }
    throw e;
  }
}
