# PayPal capability map (researched 2026-11-01)

Sources:
- The official OpenAPI specs: `paypal/paypal-rest-api-specifications`
- The v6 samples: `paypal-examples/v6-web-sdk-sample-integration`
- `paypal/agent-toolkit`
- developer.paypal.com

Base URL (sandbox): `https://api-m.sandbox.paypal.com`

Everything marked **UNVERIFIED** still needs a hands-on sandbox run. The spikes in `packages/paypal/spikes/` do exactly that (see [Verification status](#verification-status-2026-11-01)); they could not run on 2026-11-01 because no sandbox credentials were in `.env`. That's Phase 0 in [tasks/todo.md](../tasks/todo.md).

## Verdicts

| Capability | Verdict | Use in Pact |
|---|---|---|
| Orders v2 (create / authorize / capture) | Works | Every charge |
| `purchase_units[].payee` (pay another account) | **UNVERIFIED** (spike `05`, blocked on sandbox credentials): may fail with `PAYEE_NOT_CONSENTED`. Multiparty needs partner approval. | "Retailer" sandbox accounts; direct P2P |
| Vault v3, save without purchase, then off-session (MIT) charge | Works with caveats. **UNVERIFIED** (spikes `02`–`04`, blocked on sandbox credentials): the app must tick *Vault*, and `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE` has been reported | Member mandates; standing orders |
| Consumer-to-consumer send/request API | **Not available** | P2P is platform-mediated (below) |
| Payouts (platform → email/phone/Venmo) | Works. **UNVERIFIED** (spike `01` checks token scopes, `06` sends; blocked on sandbox credentials): the app needs *Payouts* ticked (`AUTHORIZATION_ERROR` otherwise) | P2P "send", pact payouts |
| Invoicing (request money, partial payments) | Works | P2P "request" for people not in the app |
| Authorize → capture/void/reauthorize | Works. Auth valid 29 days, **3-day honor period** | All-or-nothing group split |
| Webhooks + verification | Works. Self-verify is possible on Workers | Settlement reconciliation |
| JS SDK v6 (one-time, save-payment, Venmo, Pay Later) | Works. Venmo eligibility in sandbox **UNVERIFIED**: needs a browser check in the web app; spike `08` only mints client tokens | In-chat approval cards |
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
**UNVERIFIED** (spike `04-off-session.ts`, blocked on sandbox credentials):
- Does the order come back COMPLETED, or does it need a separate capture? `chargeMandate` handles both: it captures (or authorizes) only when create returns `APPROVED`, with the derived key `<requestId>:capture`.
- Is `stored_credential` needed? `chargeMandate` sends MERCHANT/SUBSEQUENT/UNSCHEDULED_POSTPAID by default; `storedCredential: false` omits it. The spike tries both.
- Does MIT need `PayPal-Client-Metadata-Id`? Supported as `clientMetadataId` on every call, not sent by default.

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
  - Implementation (done, `verifyWebhookSelf`): a minimal DER parser extracts the SPKI and validity window, then WebCrypto `RSASSA-PKCS1-v1_5`/SHA-256 verifies. No `nodejs_compat` needed. The cert is fetched with `redirect: "manual"` and cached by URL. Allowed cert URLs: https, no port or userinfo, host `api(-m).sandbox.paypal.com` (sandbox) or `api(-m).paypal.com` (live), path under `/v1/notifications/certs/`. Unit tests sign with a generated key and cert, and cross-check the parser against `node:crypto`'s `X509Certificate`.

## Plumbing
- **App token:** `POST /v1/oauth2/token` (client_credentials) gives `expires_in` of about 9h. Cache it with a margin.
- **v6 client token:** `POST /v1/oauth2/token` with `grant_type=client_credentials&response_type=client_token&domains[]=…` (15 min). `clientId` alone is enough for one-time payments; the save flow samples use `clientToken`. **UNVERIFIED** in a browser. The v6 sample server (`server/node/src/routes/authRouteHandler.ts`) sends `response_type=client_token` plus optional `domains[]`, `target_customer_id` and `claims[]=vault_id:<id>`, with no `intent`; `clientToken()` mirrors that.
- **SDK script:** `https://www.sandbox.paypal.com/web-sdk/v6/core`. Or `loadCoreSdkScript` from `@paypal/paypal-js/sdk-v6`. React: `@paypal/react-paypal-js` `/sdk-v6`.
- **Headers on every mutating call:** `PayPal-Request-Id` (idempotency). Add `PayPal-Mock-Response: {"mock_application_codes":"INSTRUMENT_DECLINED"}` for negative tests on orders, authorizations, captures, and refunds.
- **Payouts:** `sender_batch_id` must be unique for 30 days, and the rate limit is 400 POST/min. Mock failures go through `items[0].note` (e.g. `ERRPYO002`).
- **Test cards:** Visa `4012888888881881`. Decline triggers go in the name field (`CCREJECT-REFUSED`, …).

## Hands-on verification order

| # | Step | Spike | Status (2026-11-01) |
|---|---|---|---|
| 1 | **App setup:** create the sandbox app, tick **Vault** + **Payouts** + **Log in with PayPal**, and get a token. | `01-token.ts` (token + feature scopes) | **UNVERIFIED**, blocked on sandbox credentials |
| 2 | **Setup token:** `POST /v3/vault/setup-tokens`. Expect 201, not `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`. If it fails, retry with a "Platform" app. | `02-setup-token.ts` | **UNVERIFIED**, blocked on sandbox credentials |
| 3 | **Payment token:** approve with a sandbox personal account, then call `POST /v3/vault/payment-tokens`. | `03-payment-token.ts` (the buyer approves in a browser first) | **UNVERIFIED**, blocked on sandbox credentials |
| 4 | **Off-session order:** with `vault_id`, both with and without `stored_credential`. Record the resulting status. | `04-off-session.ts` | **UNVERIFIED**, blocked on sandbox credentials |
| 5 | **`payee` routing:** set `payee.email_address` to a second sandbox business account, then to a personal account, then try several payees in one order. | `05-payee.ts` (paid off-session with the vault token, so no browser needed) | **UNVERIFIED**, blocked on sandbox credentials |
| 6 | **Payouts:** pay a sandbox personal email, then test the Venmo wallet. | `06-payouts.ts` (polls the batch to a final state) | **UNVERIFIED**, blocked on sandbox credentials |
| 7 | **Authorizations:** AUTHORIZE, then partial capture with `final_capture:false`, then void. | `07-authorizations.ts` (also re-voids to record the "already voided" issue name) | **UNVERIFIED**, blocked on sandbox credentials |
| 8 | **v6 save session:** compare `clientId` vs `clientToken`. Check Venmo and Pay Later eligibility. | `08-client-token.ts` (server half only) | **UNVERIFIED**: the token half is blocked on sandbox credentials; the browser half belongs to `apps/web` |
| 9 | **Webhooks:** postback verification on real events, and self-verification on Workers with simulator events. | `09-webhooks.ts` (lists subscriptions; with `PAYPAL_WEBHOOK_URL` it subscribes and simulates) | **UNVERIFIED**: blocked on sandbox credentials and a deployed worker URL. The crypto is unit-tested. |
| 10 | **Mock declines:** send `PayPal-Mock-Response` on a capture and on a vault MIT order. | `10-mock-declines.ts` | **UNVERIFIED**, blocked on sandbox credentials |

## Verification status (2026-11-01)

No sandbox step has run yet. `/Users/mohammedhusamuddin/codebase-core/hack-paypal/.env` had no `PAYPAL_CLIENT_ID` or `PAYPAL_CLIENT_SECRET`, and the spikes exit with code 2 and print the setup steps.

**To unblock:**
- Create a sandbox app (Merchant) with **Vault**, **Payouts** and **Log in with PayPal** ticked.
- Have one extra business account and two personal accounts.
- Add to `.env`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_SANDBOX_BUYER_EMAIL`, `PAYPAL_SANDBOX_RECIPIENT_EMAIL`, `PAYPAL_SANDBOX_BUSINESS2_EMAIL`. Optionally add `PAYPAL_SANDBOX_VENMO_PHONE` and `PAYPAL_WEBHOOK_URL`.

**Then run, from `packages/paypal`:**
- `npx tsx spikes/01-token.ts`
- `spikes/02-setup-token.ts`. Open the printed approve URL and log in as the buyer yourself.
- `spikes/03-payment-token.ts` through `10-mock-declines.ts`.

Observations append to `spikes/results.json`, which is gitignored. It holds statuses, debug ids, order and batch ids, and masked vault ids, never tokens. Copy them into the table above.

Also unverified, and recorded by `07`: the void error issue for an already-voided authorization. `voidAll` currently treats `PREVIOUSLY_VOIDED`, `AUTHORIZATION_VOIDED` and `AUTHORIZATION_EXPIRED` as "released".

Already verified offline by unit tests (`npm test -w @pact/paypal`, 82 tests):
- Request shapes and headers for every endpoint.
- Money in and out.
- Token caching, the margin, and refresh on 401.
- Retry bounds.
- Error parsing, which drops echoed `details[].value`.
- Webhook self-verify, including tamper, wrong-key, expired-cert and bad-host cases.
- Event typing and dedupe.
- All flows, including the all-or-nothing void path.
