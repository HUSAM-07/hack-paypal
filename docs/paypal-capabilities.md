# PayPal capability map (researched 2026-11-01)

Sources:
- The official OpenAPI specs: `paypal/paypal-rest-api-specifications`
- The v6 samples: `paypal-examples/v6-web-sdk-sample-integration`
- `paypal/agent-toolkit`
- developer.paypal.com

Base URL (sandbox): `https://api-m.sandbox.paypal.com`

The spikes in `packages/paypal/spikes/` ran against the sandbox on 2026-11-02 (see [Verification status](#verification-status-2026-11-02)). **VERIFIED** marks an observed outcome. **UNVERIFIED** marks what still needs a run: `payee` routing (spike `05`, which needs a second business account and a second personal account) and webhooks (spike `09`, which needs a deployed worker URL). That's Phase 0 in [tasks/todo.md](../tasks/todo.md).

## Verdicts

| Capability | Verdict | Use in Pact |
|---|---|---|
| Orders v2 (create / authorize / capture) | Works | Every charge |
| `purchase_units[].payee` (pay another account) | **UNVERIFIED** (spike `05`, which needs `PAYPAL_SANDBOX_BUSINESS2_EMAIL` and `PAYPAL_SANDBOX_RECIPIENT_EMAIL`): may fail with `PAYEE_NOT_CONSENTED`. Multiparty needs partner approval. | "Retailer" sandbox accounts; direct P2P |
| Vault v3, save without purchase, then off-session (MIT) charge | **VERIFIED** (spikes `02`–`04`) on a Merchant app with *Save payment methods* ticked. Setup token, then buyer approval, then payment token, then an off-session order that comes back `COMPLETED` on create. | Member mandates; standing orders |
| Consumer-to-consumer send/request API | **Not available** | P2P is platform-mediated (below) |
| Payouts (platform → email/phone/Venmo) | **VERIFIED** for the PayPal wallet (spike `06`): a batch to a personal email went `PENDING` → `SUCCESS`. **The Venmo wallet is rejected in sandbox** with `400 VALIDATION_ERROR` "Recipient wallet not supported in sandbox." | P2P "send", pact payouts |
| Invoicing (request money, partial payments) | Works | P2P "request" for people not in the app |
| Authorize → capture/void/reauthorize | **VERIFIED** (spike `07`): an off-session AUTHORIZE via vault, then a partial capture (`PARTIALLY_CAPTURED`), then a void of the remainder (`VOIDED`). Auth valid 29 days, **3-day honor period** | All-or-nothing group split |
| Webhooks + verification | Works. Self-verify is possible on Workers | Settlement reconciliation |
| JS SDK v6 (one-time, save-payment, Venmo, Pay Later) | Works. The client token is **VERIFIED** (spike `08`). Venmo and Pay Later eligibility are **UNVERIFIED** and need a browser check in the web app. | In-chat approval cards |
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
**VERIFIED** (spike `04-off-session.ts`, 2026-11-02):
- **The order comes back `COMPLETED` on create**, with the capture `COMPLETED` inside it, so no separate capture call is needed. Orders `3MR35233P1895802F` and `0MU285635J788590P`. `chargeMandate` still captures (or authorizes) when create returns `APPROVED`, using the derived key `<requestId>:capture`, to cover other accounts.
- **`stored_credential` is not required.** The orders with and without it both completed. `chargeMandate` keeps sending MERCHANT/SUBSEQUENT/UNSCHEDULED_POSTPAID by default, because that's the correct MIT signal; `storedCredential: false` omits it.
- **`PayPal-Client-Metadata-Id` is not needed for MIT.** It was never sent and charges still succeeded. It's available as `clientMetadataId`.

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
- **v6 client token:** `POST /v1/oauth2/token` with `grant_type=client_credentials&response_type=client_token&domains[]=…` (15 min). `clientId` alone is enough for one-time payments; the save flow samples use `clientToken`. **VERIFIED** server-side (spike `08`): with no params it returns a JWT valid for 900s, and with `target_customer_id` it also returns 900s. **`domains[]=localhost&domains[]=example.com` is rejected with `401 invalid_domain`**, so omit `domains[]` locally and pass only the deployed web origin. The browser half is still **UNVERIFIED**. The v6 sample server (`server/node/src/routes/authRouteHandler.ts`) sends `response_type=client_token` plus optional `domains[]`, `target_customer_id` and `claims[]=vault_id:<id>`, with no `intent`; `clientToken()` mirrors that.
- **SDK script:** `https://www.sandbox.paypal.com/web-sdk/v6/core`. Or `loadCoreSdkScript` from `@paypal/paypal-js/sdk-v6`. React: `@paypal/react-paypal-js` `/sdk-v6`.
- **Headers on every mutating call:** `PayPal-Request-Id` (idempotency). Add `PayPal-Mock-Response: {"mock_application_codes":"<CODE>"}` for negative tests. Observed in spike `10`:
  - **Order create:** `INSTRUMENT_DECLINED` gives `422 UNPROCESSABLE_ENTITY` with issue `INSTRUMENT_DECLINED`.
  - **Authorization capture:** `INSTRUMENT_DECLINED` gives a **bare `403` with an empty body**, so use `TRANSACTION_REFUSED` there (`422` with issue `TRANSACTION_REFUSED`).
  - **debug_id:** mocked error bodies carry a fixed `debug_id` (`70c28ae654da`). The `PayPal-Debug-Id` header is the real one.
- **Payouts:** `sender_batch_id` must be unique for 30 days, and the rate limit is 400 POST/min. Mock failures go through `items[0].note` (e.g. `ERRPYO002`).
- **Test cards:** Visa `4012888888881881`. Decline triggers go in the name field (`CCREJECT-REFUSED`, …).

## Hands-on verification order

| # | Step | Spike | Status (2026-11-02) |
|---|---|---|---|
| 1 | **App setup:** create the sandbox app, tick **Vault** + **Payouts** + **Log in with PayPal**, and get a token. | `01-token.ts` (token + feature scopes) | **VERIFIED** on "Default Application" (`APP-4LR40444F62452827`). Token returns 200 with `expires_in` 32400, and 29 scopes including vault, payouts, identity and invoicing. |
| 2 | **Setup token:** `POST /v3/vault/setup-tokens`. Expect 201, not `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`. If it fails, retry with a "Platform" app. | `02-setup-token.ts` | **VERIFIED**: 201 `PAYER_ACTION_REQUIRED` with an approve link (debug `f70462559c46e`). A Merchant app is enough. |
| 3 | **Payment token:** approve with a sandbox personal account, then call `POST /v3/vault/payment-tokens`. | `03-payment-token.ts` (the buyer approves in a browser first) | **VERIFIED**: after approval the setup token is `APPROVED`, and creating the payment token returns 201 (debug `f8010115340d3`) with `customer.id`, payer email and payer id. Before consent it returns `422 PAYER_ACTION_REQUIRED`. |
| 4 | **Off-session order:** with `vault_id`, both with and without `stored_credential`. Record the resulting status. | `04-off-session.ts` | **VERIFIED**: `COMPLETED` on create in both cases (`3MR35233P1895802F`, `0MU285635J788590P`) |
| 5 | **`payee` routing:** set `payee.email_address` to a second sandbox business account, then to a personal account, then try several payees in one order. | `05-payee.ts` (paid off-session with the vault token, so no browser needed) | **UNVERIFIED**: needs a second business account and a second personal account (`PAYPAL_SANDBOX_BUSINESS2_EMAIL`, `PAYPAL_SANDBOX_RECIPIENT_EMAIL`) |
| 6 | **Payouts:** pay a sandbox personal email, then test the Venmo wallet. | `06-payouts.ts` (polls the batch to a final state) | **VERIFIED** for PayPal: batch `7K5FQMHM6M66U` went `PENDING` → `SUCCESS` with the item `SUCCESS`. **Venmo: `400 VALIDATION_ERROR` "Recipient wallet not supported in sandbox."** |
| 7 | **Authorizations:** AUTHORIZE, then partial capture with `final_capture:false`, then void. | `07-authorizations.ts` (also re-voids to record the "already voided" issue name) | **VERIFIED**: auth `98R12328AV423302P` is `CREATED` (expires +29d), a $2 capture leaves it `PARTIALLY_CAPTURED`, the void gives `VOIDED`, and a second void gives `422 PREVIOUSLY_VOIDED` (debug `f9144497c11c9`) |
| 8 | **v6 save session:** compare `clientId` vs `clientToken`. Check Venmo and Pay Later eligibility. | `08-client-token.ts` (server half only) | **VERIFIED** server half: a JWT valid for 900s, with or without `target_customer_id`. `domains[]` with `localhost`/`example.com` gives `401 invalid_domain`. The browser half (`apps/web`) is **UNVERIFIED**. |
| 9 | **Webhooks:** postback verification on real events, and self-verification on Workers with simulator events. | `09-webhooks.ts` (lists subscriptions; with `PAYPAL_WEBHOOK_URL` it subscribes and simulates) | **UNVERIFIED**: needs a deployed worker URL. The crypto is unit-tested. |
| 10 | **Mock declines:** send `PayPal-Mock-Response` on a capture and on a vault MIT order. | `10-mock-declines.ts` | **VERIFIED**: on a vault MIT order `INSTRUMENT_DECLINED` gives `422 INSTRUMENT_DECLINED`. On an auth capture, `INSTRUMENT_DECLINED` gives a bare `403` (debug `ca543c3136d93`), while `TRANSACTION_REFUSED` gives `422 TRANSACTION_REFUSED`. |

## Verification status (2026-11-02)

**Setup used:**
- **App:** the sandbox "Default Application" (Merchant), with *Save payment methods*, *Invoicing* and *Payouts* ticked.
- **Accounts:** the default business account (the merchant) and the default personal account (the buyer). **Both are registered in AE.** USD charges, authorizations and payouts all worked regardless.
- **Approval:** the buyer approved the vault agreement in a browser, logging in themselves.
- **Spikes:** run from `packages/paypal` with `npx tsx spikes/0N-*.ts`. Observations go to the gitignored `spikes/results.json`, which holds no tokens, and vault and customer ids are masked.

**Confirmed for the package:**
- **`chargeMandate`:** its "capture only if `APPROVED`" branch didn't trigger on this account. The order completes on create, and the flow returns `outcome: "succeeded"` either way.
- **`voidAll`:** its "already released" set includes `PREVIOUSLY_VOIDED`, the issue PayPal actually returns. `AUTHORIZATION_VOIDED` and `AUTHORIZATION_EXPIRED` stay in the set as defensive cases.
- **Errors:** `PayPalError` already reads the issue codes. A bare 403 surfaces as `code: "HTTP_403"` with no issues.

**Still open:**
- **Spike `05`, `payee` routing:** create a second sandbox Business account and a second Personal account, preferably US. Set `PAYPAL_SANDBOX_BUSINESS2_EMAIL` and `PAYPAL_SANDBOX_RECIPIENT_EMAIL` in `.env`.
- **Spike `09`, webhooks:** set `PAYPAL_WEBHOOK_URL` once the worker is deployed. It prints the `PAYPAL_WEBHOOK_ID` the worker needs.
- **v6 browser flows:** check Venmo and Pay Later eligibility in `apps/web`. Payouts to Venmo can't be tested in sandbox at all.
- **Log in with PayPal:** the identity scope is on the token, but no spike drives the OAuth redirect. It belongs to the worker's auth route.

Already verified offline by unit tests (`npm test -w @pact/paypal`, 82 tests):
- Request shapes and headers for every endpoint.
- Money in and out.
- Token caching, the margin, and refresh on 401.
- Retry bounds.
- Error parsing, which drops echoed `details[].value`.
- Webhook self-verify, including tamper, wrong-key, expired-cert and bad-host cases.
- Event typing and dedupe.
- All flows, including the all-or-nothing void path.
