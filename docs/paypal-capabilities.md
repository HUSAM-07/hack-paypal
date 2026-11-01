# PayPal capability map (researched 2026-11-01)

Sources:
- The official OpenAPI specs: `paypal/paypal-rest-api-specifications`
- The v6 samples: `paypal-examples/v6-web-sdk-sample-integration`
- `paypal/agent-toolkit`
- developer.paypal.com

Base URL (sandbox): `https://api-m.sandbox.paypal.com`

Everything marked **VERIFY** must be checked hands-on with real sandbox credentials. That's Phase 0 in [tasks/todo.md](../tasks/todo.md).

## Verdicts

| Capability | Verdict | Use in Pact |
|---|---|---|
| Orders v2 (create / authorize / capture) | Works | Every charge |
| `purchase_units[].payee` (pay another account) | **VERIFY**: may fail with `PAYEE_NOT_CONSENTED`. Multiparty needs partner approval. | "Retailer" sandbox accounts; direct P2P |
| Vault v3, save without purchase, then off-session (MIT) charge | Works with caveats. **VERIFY**: the app must tick *Vault*, and `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE` has been reported | Member mandates; standing orders |
| Consumer-to-consumer send/request API | **Not available** | P2P is platform-mediated (below) |
| Payouts (platform → email/phone/Venmo) | Works. **VERIFY** the app has *Payouts* ticked (`AUTHORIZATION_ERROR` otherwise) | P2P "send", pact payouts |
| Invoicing (request money, partial payments) | Works | P2P "request" for people not in the app |
| Authorize → capture/void/reauthorize | Works. Auth valid 29 days, **3-day honor period** | All-or-nothing group split |
| Webhooks + verification | Works. Self-verify is possible on Workers | Settlement reconciliation |
| JS SDK v6 (one-time, save-payment, Venmo, Pay Later) | Works. Venmo eligibility in sandbox **VERIFY** | In-chat approval cards |
| Log in with PayPal (userinfo: email, payer_id) | Works, no review needed in sandbox | Link each member's PayPal identity as a payout target |
| `@paypal/agent-toolkit` on Workers | **Uncertain**: uses axios, Node `os`/`Buffer`; has no vault/payouts/webhooks | Don't depend on it. Write fetch-based tools, borrow its zod schemas |
| Sandbox account creation API | Not available | Create accounts in the dashboard |

## Flows

### Member commit → mandate (vault without purchase)
1. Worker calls `POST /v3/vault/setup-tokens`:
   ```json
   {"payment_source":{"paypal":{"usage_type":"MERCHANT","customer_type":"CONSUMER","usage_pattern":"IMMEDIATE","permit_multiple_payment_tokens":false,"description":"Pact mandate","experience_context":{"return_url":"…","cancel_url":"…","vault_instruction":"ON_PAYER_APPROVAL"}}}}
   ```
   The response is `PAYER_ACTION_REQUIRED` with an approve link. Setup tokens expire in 3 days.
2. The client runs the v6 `createPayPalSavePaymentSession` (with `findEligibleMethods({paymentFlow:"VAULT_WITHOUT_PAYMENT"})`). `start()` takes a promise of `{vaultSetupToken}`, and `onApprove` gets `data.vaultSetupToken`.
3. Worker calls `POST /v3/vault/payment-tokens` with `{"payment_source":{"token":{"id":"<setupTokenId>","type":"SETUP_TOKEN"}}}`, which returns `id` (= `vault_id`) and `customer.id`.
4. Store `{userId, customerId, vaultId}` server-side only. The mandate keeps an opaque `fundingRef`.

### Off-session charge (standing order / price trigger)
`authorize()` must return `allow` first. Then `POST /v2/checkout/orders` with header `PayPal-Request-Id: <pactId>:<runId>:<userId>`:
```json
{"intent":"CAPTURE","purchase_units":[{"amount":{"currency_code":"USD","value":"25.00"},"custom_id":"<pactId>"}],
 "payment_source":{"paypal":{"vault_id":"<id>","stored_credential":{"payment_initiator":"MERCHANT","usage":"SUBSEQUENT","usage_pattern":"UNSCHEDULED_POSTPAID"}}}}
```
**VERIFY:**
- Does the order come back COMPLETED, or does it need a separate capture?
- Is `stored_credential` needed?
- Does MIT need `PayPal-Client-Metadata-Id`?

### Group split (all-or-nothing)
1. Create one order per member with `intent:"AUTHORIZE"` and `custom_id=<pactId>`. Members with a mandate are authorized off-session; the others approve through v6.
2. When every member is authorized, capture each one: `POST /v2/payments/authorizations/{id}/capture`.
3. If anyone fails or the deadline passes, void them all: `POST /v2/payments/authorizations/{id}/void`.
4. The deadline must sit inside the **3-day honor period**. Reauthorization is possible from day 4 to day 29, but avoid relying on it.

### P2P (platform-mediated; say so in the README)
- **Send:**
  - Option 1: the sender pays the platform (an order, or a vault charge under a mandate), then the platform pays the recipient with Payouts. Example: `POST /v1/payments/payouts` with `items[{recipient_type:"EMAIL", receiver, amount, recipient_wallet:"PAYPAL"|"VENMO"}]`. It's async, so poll or use webhooks.
  - Option 2, if `payee` routing verifies: a direct order with `payee` = the recipient.
- **Request:**
  - In-app members get an approval card that creates an order.
  - Outsiders get an invoice: `POST /v2/invoicing/invoices` then `/send`, with partial payments allowed.

### Webhooks to subscribe to
- Orders and payments:
  - `CHECKOUT.ORDER.APPROVED`
  - `PAYMENT.AUTHORIZATION.CREATED` and `.VOIDED`
  - `PAYMENT.CAPTURE.COMPLETED`, `.DECLINED`, `.DENIED`, `.PENDING`, `.REFUNDED`
- Vault: `VAULT.PAYMENT-TOKEN.CREATED` and `.DELETED`
- Payouts: `PAYMENT.PAYOUTSBATCH.*` and `PAYMENT.PAYOUTS-ITEM.*`
- Invoicing: `INVOICING.INVOICE.PAID` and `.CANCELLED`

**Verification on Workers:**
- Production path: postback `POST /v1/notifications/verify-webhook-signature`.
- Self-verify path, which also works with simulator events:
  - Message: `transmissionId|transmissionTime|webhookId|crc32(rawBody)`
  - Algorithm: SHA256withRSA against the cert at `paypal-cert-url`. Allowlist that cert's host.
  - Implementation: `node:crypto` X509Certificate under `nodejs_compat`, or parse the SPKI and use WebCrypto.

## Plumbing
- **App token:** `POST /v1/oauth2/token` (client_credentials) gives `expires_in` of about 9h. Cache it with a margin.
- **v6 client token:** `POST /v1/oauth2/token` with `grant_type=client_credentials&response_type=client_token&domains[]=…` (15 min). `clientId` alone is enough for one-time payments; the save flow samples use `clientToken`. **VERIFY** both.
- **SDK script:** `https://www.sandbox.paypal.com/web-sdk/v6/core`. Or `loadCoreSdkScript` from `@paypal/paypal-js/sdk-v6`. React: `@paypal/react-paypal-js` `/sdk-v6`.
- **Headers on every mutating call:** `PayPal-Request-Id` (idempotency). Add `PayPal-Mock-Response: {"mock_application_codes":"INSTRUMENT_DECLINED"}` for negative tests on orders, authorizations, captures, and refunds.
- **Payouts:** `sender_batch_id` must be unique for 30 days, and the rate limit is 400 POST/min. Mock failures go through `items[0].note` (e.g. `ERRPYO002`).
- **Test cards:** Visa `4012888888881881`. Decline triggers go in the name field (`CCREJECT-REFUSED`, …).

## Hands-on verification order
1. **App setup:** create the sandbox app, tick **Vault** + **Payouts** + **Log in with PayPal**, and get a token.
2. **Setup token:** `POST /v3/vault/setup-tokens`. Expect 201, not `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`. If it fails, retry with a "Platform" app.
3. **Payment token:** approve with a sandbox personal account, then call `POST /v3/vault/payment-tokens`.
4. **Off-session order:** with `vault_id`, both with and without `stored_credential`. Record the resulting status.
5. **`payee` routing:** set `payee.email_address` to a second sandbox business account, then to a personal account, then try several payees in one order.
6. **Payouts:** pay a sandbox personal email, then test the Venmo wallet.
7. **Authorizations:** AUTHORIZE, then partial capture with `final_capture:false`, then void.
8. **v6 save session:** compare `clientId` vs `clientToken`. Check Venmo and Pay Later eligibility.
9. **Webhooks:** postback verification on real events, and self-verification on Workers with simulator events.
10. **Mock declines:** send `PayPal-Mock-Response` on a capture and on a vault MIT order.
