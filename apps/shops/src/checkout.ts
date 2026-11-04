import { type PayPalClient, PayPalError } from "@pact/paypal";
import { CUSTOM_ID_MAX, type Money, verifyPassport } from "@pact/protocol";
import { priceAt, productByUpc, type ShopId } from "./catalogue";

export interface CheckoutInput {
  upc: string;
  quantity?: number;
  /** Signed Agent Affiliate Passport. Omitted for shoppers who arrived without one. */
  passport?: string;
  /** Caller-chosen cart/attempt id: the same value always maps to the same PayPal order. */
  clientRef?: string;
}

export class CheckoutError extends Error {
  constructor(
    readonly status: 400 | 404 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function shortHash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Deterministic `PayPal-Request-Id` (rule 6): same shop + cart + product + quantity + passport gives
 * the same key, so a retried request cannot create a second order.
 */
export async function createRequestId(shop: ShopId, i: CheckoutInput): Promise<string> {
  const h = await shortHash(
    [shop, i.clientRef ?? "", i.upc, i.quantity ?? 1, i.passport ?? ""].join("\n"),
  );
  return `cited-${shop}-create-${h}`;
}

export const captureRequestId = (orderId: string) => `cited-capture-${orderId}`.slice(0, 108);

export interface CheckoutDeps {
  paypal: PayPalClient;
  /** When set, a passport that does not verify is rejected instead of being passed along. */
  passportSecret?: string | undefined;
}

export interface CreatedOrder {
  orderId: string;
  shopId: ShopId;
  upc: string;
  quantity: number;
  total: Money;
  customId: string | null;
  approveUrl: string | undefined;
}

export async function createOrder(
  deps: CheckoutDeps,
  shop: ShopId,
  input: CheckoutInput,
): Promise<CreatedOrder> {
  const product = productByUpc(input.upc);
  const price = priceAt(shop, input.upc);
  if (!product || !price) {
    throw new CheckoutError(404, "unknown_product", `no ${input.upc} at ${shop}`);
  }
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new CheckoutError(400, "bad_quantity", "quantity must be an integer from 1 to 10");
  }
  const { passport } = input;
  if (passport !== undefined) {
    if (passport.length > CUSTOM_ID_MAX) {
      throw new CheckoutError(400, "bad_passport", "passport does not fit custom_id");
    }
    if (deps.passportSecret) {
      const v = await verifyPassport(passport, deps.passportSecret);
      if (!v.ok) throw new CheckoutError(400, "bad_passport", `passport rejected: ${v.reason}`);
    }
  }

  const total = { amountMinor: price.amountMinor * quantity, currency: price.currency };
  try {
    const order = await deps.paypal.orders.create(
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: shop,
            amount: total,
            items: [
              {
                name: product.name,
                quantity,
                unit_amount: price,
                upc: product.upc,
                category: "PHYSICAL_GOODS",
              },
            ],
            // The signed passport is what joins this sale to the test the agent saw (rule 4).
            ...(passport ? { custom_id: passport } : {}),
          },
        ],
      },
      { requestId: await createRequestId(shop, input) },
    );
    const link = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
    return {
      orderId: order.id,
      shopId: shop,
      upc: product.upc,
      quantity,
      total,
      customId: order.purchase_units?.[0]?.custom_id ?? passport ?? null,
      approveUrl: link?.href,
    };
  } catch (e) {
    if (e instanceof PayPalError) throw new CheckoutError(502, "paypal_error", e.message);
    throw e;
  }
}

export async function captureOrder(deps: CheckoutDeps, orderId: string) {
  try {
    const order = await deps.paypal.orders.capture(orderId, {
      requestId: captureRequestId(orderId),
    });
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    return {
      orderId: order.id,
      status: order.status,
      captureId: capture?.id ?? null,
      customId: capture?.custom_id ?? order.purchase_units?.[0]?.custom_id ?? null,
    };
  } catch (e) {
    if (e instanceof PayPalError) throw new CheckoutError(502, "paypal_error", e.message);
    throw e;
  }
}
