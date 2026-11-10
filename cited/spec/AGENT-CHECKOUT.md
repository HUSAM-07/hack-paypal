# Agent checkout through PayPal (no storefronts)

Merchants never integrate CITED, and agents never visit a merchant's website. The merchants' catalogues are synced to PayPal (our mock of Store Sync, `apps/catalogue-mcp`), and the agent platform pays through PayPal on the buyer's behalf, with the merchant as payee.

## Flow

1. **The buyer links PayPal to their shopping agent, once.** PayPal Vault: a setup token with `payment_source.paypal` (`usage_type: MERCHANT`), which the buyer approves at PayPal, exchanged for a payment token. Its id is the `vault_id` every later checkout charges. Simulated mode vaults a mock wallet by itself; sandbox reads `CITED_BUYER_VAULT_ID`.
2. **The agent searches.** MCP tool `search_product` returns **offers**: the product (UPC, brand, name, specs), the seller (id, display name, PayPal payee from config) and the price, plus the creator content for the session's arm (test, placebo or nothing) and a signed Agent Affiliate Passport. Ranking is price, then seller, then UPC, identical in every arm. Passing `sellerId` records that seller's offer as viewed in the passport.
3. **The agent checks out.** MCP tool `checkout({offerId, passport})`. The platform creates the Orders v2 order itself (`apps/catalogue-mcp/src/checkout.ts`):

   ```json
   {
     "intent": "CAPTURE",
     "purchase_units": [{
       "reference_id": "lumen",
       "payee": { "merchant_id": "<Lumen's PayPal merchant id>" },
       "custom_id": "<signed passport, ≤127 chars>",
       "amount": { "currency_code": "USD", "value": "95.99", "breakdown": { "item_total": { "currency_code": "USD", "value": "95.99" } } },
       "items": [{ "name": "Winix A230", "quantity": "1", "unit_amount": { "currency_code": "USD", "value": "95.99" },
                   "upc": { "type": "UPC-A", "code": "<UPC>" }, "category": "PHYSICAL_GOODS" }]
     }],
     "payment_source": { "paypal": { "vault_id": "<buyer's vault id>",
       "stored_credential": { "payment_initiator": "MERCHANT", "usage": "SUBSEQUENT", "usage_pattern": "UNSCHEDULED_POSTPAID" } } }
   }
   ```

   With a vaulted wallet PayPal creates and captures in one call (status `COMPLETED`); if it stops at `APPROVED` the platform captures. `PayPal-Request-Id` is derived from the session, offer and passport, so a retry never pays twice. The passport is verified before it goes into `custom_id`; a forged one is refused.
4. **The engine joins the sale to its arm.** PayPal sends `CHECKOUT.ORDER.COMPLETED` (line items, payee, `custom_id`) and `PAYMENT.CAPTURE.COMPLETED`. The engine stores the order, then joins the capture through the verified passport. If the capture arrives first, the engine reads the order with `GET /v2/checkout/orders/{id}`. The seller id (`reference_id`) is what the engine records as the store chosen, so cross-seller attribution still shows: the demo's exposed agent reads Northwind's offer and pays Lumen.
5. **A return.** The seller refunds the capture (`POST /v2/payments/captures/{id}/refund`, catalogue route `POST /sellers/:sellerId/refunds`). `PAYMENT.CAPTURE.REFUNDED` voids the pending credit. Payout and deposit-return beats are unchanged.

## Sellers

Configured in `apps/catalogue-mcp/src/sellers.ts`. Prices are the price-matched demo table (`DEMO_SHOP_PRICES`): Northwind $99.99, Lumen $95.99, MegaMart $102.99, the same for both purifiers. The payee comes from `CITED_SELLER_<ID>_PAYEE` (a merchant id, or an email if it contains `@`); unset, a mock merchant id is used.

## What sandbox needs

Verified on the sandbox app: OAuth works, the app token has the vault scope, and `POST /v3/vault/setup-tokens` with `payment_source.paypal` returns `PAYER_ACTION_REQUIRED`. Card payments are refused (`PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`), so the vaulted PayPal wallet is the only headless way to pay. The webhook `8042373202922840X` is registered for `<workers.dev>/api/cited/webhooks/paypal`.

Still to do, in order:

1. **Vault the buyer once.** With the sandbox credentials in `.env`, run `npx tsx packages/paypal/spikes/02-setup-token.ts`, open the printed approve link and log in as the sandbox **personal** (buyer) account, then run `npx tsx packages/paypal/spikes/03-payment-token.ts`. The vault id lands in `packages/paypal/spikes/.state.json` (`vaultId`). Set it as `CITED_BUYER_VAULT_ID` (worker: `npx wrangler secret put CITED_BUYER_VAULT_ID`).
2. **Three seller accounts.** Create three sandbox **business** accounts (Northwind, Lumen, MegaMart) in the developer dashboard and set `CITED_SELLER_NORTHWIND_PAYEE`, `CITED_SELLER_LUMEN_PAYEE`, `CITED_SELLER_MEGAMART_PAYEE` to their merchant ids (or emails).
3. **Check payee routing with the vaulted wallet.** `npx tsx packages/paypal/spikes/05-payee.ts` charges the vault with another business account as payee. A `PAYEE_NOT_CONSENTED` or permission error means the sellers must be onboarded to the app (or the app's own business account must be the payee); this is unverified.
4. **Check the seller refund.** Refunding a capture whose payee is another account may need that seller's permission for the app. If the platform cannot refund, the seller refunds in its own sandbox dashboard, and the refund webhook must then reach our subscription; unverified.
5. **Webhook events.** Add `CHECKOUT.ORDER.COMPLETED` to the subscription. Without it the engine still joins sales by reading each order from PayPal, one extra call per sale.
6. **Switch the worker.** `CITED_PAYPAL_MODE=sandbox`, plus secrets `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `CITED_PASSPORT_KEY` (a fresh random key, not the dev key) and `CITED_API_TOKEN`.

The simulated mock (`packages/paypal/src/mock`) mirrors this: `payee` is kept per purchase unit and capture, `payment_source.paypal.vault_id` must name a wallet the mock vaulted (`mock.vaultWallet()`), and such an order is captured on creation with `CHECKOUT.ORDER.COMPLETED` then `PAYMENT.CAPTURE.COMPLETED`, signed like PayPal's.
