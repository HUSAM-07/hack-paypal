/**
 * Response bodies shaped like PayPal's documented sandbox responses (trimmed). Ids are
 * fake. Replace with redacted recordings from `spikes/` once sandbox runs exist.
 */

export const tokenResponse = {
  scope: "https://uri.paypal.com/services/payments/payment",
  access_token: "A21AAtest-app-token",
  token_type: "Bearer",
  app_id: "APP-80W284485P519543T",
  expires_in: 32400,
  nonce: "2026-11-01T00:00:00ZnonceXYZ",
};

export const clientTokenResponse = {
  access_token: "eyJraWQiOi-client-token",
  token_type: "Bearer",
  expires_in: 900,
  scope: "https://uri.paypal.com/services/payments/payment",
};

const link = (rel: string, href: string, method = "GET") => ({ rel, href, method });

export const orderPayerActionRequired = {
  id: "5O190127TN364715T",
  status: "PAYER_ACTION_REQUIRED",
  payment_source: { paypal: {} },
  links: [
    link("self", "https://api.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T"),
    link("payer-action", "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T"),
  ],
};

export const orderCreated = {
  id: "5O190127TN364715T",
  status: "CREATED",
  intent: "CAPTURE",
  purchase_units: [
    {
      reference_id: "default",
      custom_id: "pact_1",
      amount: { currency_code: "USD", value: "25.00" },
    },
  ],
  links: [
    link("self", "https://api.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T"),
    link("approve", "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T"),
  ],
};

export const capture = {
  id: "3C679366HH908993F",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "25.00" },
  final_capture: true,
  custom_id: "pact_1",
  seller_receivable_breakdown: {
    gross_amount: { currency_code: "USD", value: "25.00" },
    paypal_fee: { currency_code: "USD", value: "1.22" },
    net_amount: { currency_code: "USD", value: "23.78" },
  },
  create_time: "2026-11-01T10:00:00Z",
  links: [
    link(
      "refund",
      "https://api.sandbox.paypal.com/v2/payments/captures/3C679366HH908993F/refund",
      "POST",
    ),
  ],
};

export const orderCompletedVault = {
  id: "8AB12345CD678901E",
  status: "COMPLETED",
  intent: "CAPTURE",
  payment_source: {
    paypal: {
      email_address: "buyer@example.com",
      account_id: "QYR5Z8XDVJNXQ",
      attributes: { vault: { id: "8kk8451t", status: "VAULTED", customer: { id: "wxj1234" } } },
    },
  },
  purchase_units: [
    {
      reference_id: "default",
      custom_id: "pact_1",
      amount: { currency_code: "USD", value: "25.00" },
      payments: { captures: [capture] },
    },
  ],
  links: [link("self", "https://api.sandbox.paypal.com/v2/checkout/orders/8AB12345CD678901E")],
};

export const orderApproved = {
  ...orderCompletedVault,
  status: "APPROVED",
  purchase_units: [
    {
      reference_id: "default",
      custom_id: "pact_1",
      amount: { currency_code: "USD", value: "25.00" },
    },
  ],
};

export const authorization = {
  id: "0VF52814937998046",
  status: "CREATED",
  amount: { currency_code: "USD", value: "10.00" },
  custom_id: "pact_1",
  expiration_time: "2026-11-30T10:00:00Z",
  create_time: "2026-11-01T10:00:00Z",
  links: [
    link(
      "capture",
      "https://api.sandbox.paypal.com/v2/payments/authorizations/0VF52814937998046/capture",
      "POST",
    ),
    link(
      "void",
      "https://api.sandbox.paypal.com/v2/payments/authorizations/0VF52814937998046/void",
      "POST",
    ),
  ],
};

export function orderAuthorized(id: string, authId: string, value = "10.00") {
  return {
    id,
    status: "COMPLETED",
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: "default",
        custom_id: "pact_1",
        amount: { currency_code: "USD", value },
        payments: {
          authorizations: [
            { ...authorization, id: authId, amount: { currency_code: "USD", value } },
          ],
        },
      },
    ],
  };
}

export const refund = {
  id: "1JU08902781691411",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "5.00" },
  links: [link("self", "https://api.sandbox.paypal.com/v2/payments/refunds/1JU08902781691411")],
};

export const setupToken = {
  id: "5C991763VB2781612",
  status: "PAYER_ACTION_REQUIRED",
  customer: { id: "customer_4029352050" },
  payment_source: { paypal: { usage_type: "MERCHANT", customer_type: "CONSUMER" } },
  links: [
    link(
      "approve",
      "https://www.sandbox.paypal.com/agreements/approve?approval_session_id=5C991763VB2781612",
    ),
    link("confirm", "https://api.sandbox.paypal.com/v3/vault/payment-tokens", "POST"),
    link("self", "https://api.sandbox.paypal.com/v3/vault/setup-tokens/5C991763VB2781612"),
  ],
};

export const paymentToken = {
  id: "8kk8451t",
  customer: { id: "customer_4029352050" },
  payment_source: {
    paypal: {
      email_address: "buyer@example.com",
      payer_id: "QYR5Z8XDVJNXQ",
      usage_type: "MERCHANT",
      customer_type: "CONSUMER",
    },
  },
  links: [link("self", "https://api.sandbox.paypal.com/v3/vault/payment-tokens/8kk8451t")],
};

export const paymentTokenList = {
  customer: { id: "customer_4029352050" },
  payment_tokens: [paymentToken],
  total_items: 1,
  total_pages: 1,
  links: [],
};

export const payoutBatchCreated = {
  batch_header: {
    sender_batch_header: { sender_batch_id: "pact_1:run_1", email_subject: "You have a payout!" },
    payout_batch_id: "5UXD2E8A7EBQJ",
    batch_status: "PENDING",
  },
  links: [link("self", "https://api.sandbox.paypal.com/v1/payments/payouts/5UXD2E8A7EBQJ")],
};

export const payoutItem = {
  payout_item_id: "8AELMXH8UB2P8",
  transaction_id: "0C413693MN970190K",
  transaction_status: "SUCCESS",
  payout_batch_id: "5UXD2E8A7EBQJ",
  payout_item_fee: { currency: "USD", value: "0.25" },
  payout_item: {
    recipient_type: "EMAIL",
    amount: { currency: "USD", value: "12.50" },
    note: "Dinner split",
    receiver: "friend@example.com",
    sender_item_id: "item_1",
    recipient_wallet: "PAYPAL",
  },
  time_processed: "2026-11-01T10:05:00Z",
  links: [],
};

export const payoutBatch = {
  batch_header: {
    payout_batch_id: "5UXD2E8A7EBQJ",
    batch_status: "SUCCESS",
    time_created: "2026-11-01T10:00:00Z",
    time_completed: "2026-11-01T10:05:00Z",
    sender_batch_header: { sender_batch_id: "pact_1:run_1" },
    amount: { currency: "USD", value: "12.50" },
    fees: { currency: "USD", value: "0.25" },
  },
  items: [payoutItem],
  links: [],
};

export const invoiceDraft = {
  id: "INV2-Z56S-5LLA-Q52L-CPZ5",
  status: "DRAFT",
  detail: {
    invoice_number: "PACT-0001",
    currency_code: "USD",
    metadata: {
      invoicer_view_url: "https://www.sandbox.paypal.com/invoice/details/INV2-Z56S-5LLA-Q52L-CPZ5",
      recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#Z56S5LLAQ52LCPZ5",
    },
  },
  amount: { currency_code: "USD", value: "30.00" },
  due_amount: { currency_code: "USD", value: "30.00" },
  links: [
    link("self", "https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5"),
  ],
};

export const invoicePaid = {
  ...invoiceDraft,
  status: "PAID",
  due_amount: { currency_code: "USD", value: "0.00" },
  payments: {
    paid_amount: { currency_code: "USD", value: "30.00" },
    transactions: [
      { payment_id: "9XK1234", amount: { currency_code: "USD", value: "30.00" }, method: "PAYPAL" },
    ],
  },
};

export const invoiceSendResponse = {
  href: "https://www.sandbox.paypal.com/invoice/p/#Z56S5LLAQ52LCPZ5",
  rel: "payer-view",
  method: "GET",
};

export const userTokens = {
  token_type: "Bearer",
  expires_in: 28800,
  refresh_token: "R23AAtest-refresh",
  id_token: "eyJ-id-token",
  access_token: "A23AAtest-user-access",
  scope: "openid email https://uri.paypal.com/services/paypalattributes",
  nonce: "nonce",
};

export const userInfo = {
  user_id: "https://www.paypal.com/webapps/auth/identity/user/abc123",
  sub: "https://www.paypal.com/webapps/auth/identity/user/abc123",
  name: "Sandbox Buyer",
  payer_id: "QYR5Z8XDVJNXQ",
  verified_account: "true",
  emails: [{ value: "buyer@example.com", primary: true, confirmed: true }],
};

/** 422 as PayPal sends it, including a detail `value` echoing a vault id. */
export const error422 = {
  name: "UNPROCESSABLE_ENTITY",
  message:
    "The requested action could not be performed, semantically incorrect, or failed business validation.",
  debug_id: "f2b3c4d5e6f7a",
  details: [
    {
      issue: "INSTRUMENT_DECLINED",
      description: "The instrument presented was either declined by the processor or bank.",
      field: "/payment_source/paypal/vault_id",
      value: "8kk8451t",
      location: "body",
    },
  ],
  links: [
    {
      href: "https://developer.paypal.com/docs/api/orders/v2/#error-INSTRUMENT_DECLINED",
      rel: "information_link",
    },
  ],
};

export const errorOAuth = {
  error: "invalid_client",
  error_description: "Client Authentication failed",
};

export const errorVoided = {
  name: "UNPROCESSABLE_ENTITY",
  message: "The requested action could not be performed.",
  debug_id: "aa11bb22",
  details: [
    { issue: "PREVIOUSLY_VOIDED", description: "Authorization has been previously voided." },
  ],
};
