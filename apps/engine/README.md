# CITED engine

Worker (Hono + D1). Intake of PayPal webhooks, the arm-checkout join, the credit ledger,
batch payouts, deposit refunds and the read API for AG Studio. `PAYPAL_MODE=simulated`
(default) runs everything against the in-memory PayPal mock with no keys.

All money is integer minor units (`amountMinor`) with a currency. Times are ISO 8601.

## Auth

Reads under `/api` (`GET`) are public. Writes need `Authorization: Bearer $ENGINE_API_TOKEN`
(`401` without it). With no token set, writes answer `503` in every PayPal mode unless
`ENGINE_OPEN_API=1` opts in to keyless writes (`npm run dev`, tests and the demo stack set it;
the worker sets it only for its own in-process callers). A token always wins over the opt-in.
`/webhooks/paypal` is authenticated by PayPal's signature instead. In simulated mode, unsigned
events are trusted (the demo's own), but any request carrying PayPal signature headers is
verified for real (our webhook id, then the simulator's `WEBHOOK_ID`), recorded in
`webhook_proofs` and not dispatched. Outside simulated mode, only events signed for our
subscription are dispatched; simulator-signed ones are recorded only.

## Money flow

1. `POST /api/brands/:brandId/deposits` — Orders v2 `CAPTURE` order funds the programme.
   Simulated: approved and captured at once (`201`). Sandbox: `202` with the order; after the
   brand approves at PayPal call `POST /api/deposits/:orderId/capture`.
   Idempotent on `key` (default `initial`).
2. `POST /api/approvals/:approvalId/approve` `{brandId, amountMinor}` — an approved Analyst
   recommendation adds a top-up deposit (own capture). Approving twice charges once.
3. `POST /api/credits/recompute` — per brand: model-stratified lift at the 80% lower bound →
   attributable fraction → whole caused units → 8% commission, capped by the deposit and
   Shapley-split across co-exposed creators. Each brand pays only its own SKU's units.
   Idempotent (credit id = `captureId:creatorId`). Credits start `pending`, held 30 days.
4. Refund webhooks void pending credits at once (partial refunds proportionally). A
   `CUSTOMER.DISPUTE.CREATED` freezes the sale's pending credits: payouts skip them until
   `CUSTOMER.DISPUTE.RESOLVED`, which voids them if the buyer won (`RESOLVED_BUYER_FAVOUR`,
   `RESOLVED_WITH_PAYOUT`, `ACCEPTED`) and releases them to the next payout otherwise.
   Credits already paid are never clawed back; they appear in `reviewFlags`.
4a. The abuse guard (`@pact/attribution` `guard.ts`, run after every recompute and before every
   payout) holds pending credits for a person: `self_purchase` (the buyer's PayPal payer id, from
   `CHECKOUT.ORDER.*`, is the creator's linked PayPal, or the creator owns the agent session),
   `repeat_buyer` (a buyer's 3rd+ caused purchase of one UPC in 30 days), `velocity` (a creator's
   caused sales in an hour above max(100, 10× their 7-day baseline)) and `refund_ring` (a buyer
   who refunded at least half of 3+ credited sales). Held credits stay pending and are never paid
   until `POST /api/review-flags/:id/release` (paid at the next payout) or `/void` (voided, reason
   `review`); both need the write token. Self-dealt sessions never enter the lift; their sales are
   credited apart so the hold is visible.
5. `POST /api/clock/advance` `{days}` or `{to}` — moves the demo clock forward and sends ONE
   batch `POST /v1/payments/payouts` (`PAYPAL_ID` recipients, one item per creator) for every
   credit whose hold ended. `sender_batch_id` = `cited-` + hash of the credit ids, also the
   `PayPal-Request-Id`, so a retry cannot double-pay. `POST /api/payouts/run` does the same
   at the current clock; `POST /api/payouts/refresh` polls batch status.
6. `POST /api/cycle/close` `{brandIds?}` — refunds each brand's unspent deposit through
   `captures/{id}/refund` (deposited − paid − still-pending − returned). A brand with no lift
   gets everything back. It then states the cycle to each brand through PayPal Invoicing v2
   (`src/statements.ts`): one line per creator for the commission credited, credits voided by
   refunds or lost disputes as item discounts, so the invoice total is exactly what Payouts paid.
   The brand prepaid, so the invoice is sent without notifying anyone and marked paid against the
   deposit capture (`invoices/{id}/payments`, method OTHER): `MARKED_AS_PAID`, $0 due. A brand
   with nothing paid gets a `NO_CHARGE` statement and no invoice. Ids, the invoice number and
   every request id derive from the credits and refunds covered, so a retried close issues
   nothing twice. The response adds `statements[]`.

Setup: `POST /api/brands {brandId,name,category,upc,currency?}`,
`POST /api/creators {creatorId,name,paypalId?}`,
`POST /api/listings {listings:[{shopId,upc,priceMinor,currency}]}`,
`POST /api/sessions {sessionId,model,arm,category,creatorsSeen,storesViewed,ownerId?}` (the
catalogue reports every session it assigns an arm; lift needs the non-buyers).

## Read API (AG Studio)

| Endpoint | Response |
| --- | --- |
| `GET /api/clock` | `{now}` |
| `GET /api/lift`, `/api/lift/:brandId` | `{brands: Lift[]}` / `Lift` |
| `GET /api/caused-units` | `{skus: [{brandId, upc, exposedSales, attributableFraction, causedUnits, lowerBound}]}` |
| `GET /api/deposits` | `{brands: [{brandId, name, category, currency, deposited, reserved, spent, returned, available, deposits[], refunds[]}]}` |
| `GET /api/credits?creatorId=` | `{creators: [{creatorId, name, paypalLinked, totals:{pending,voided,paid,frozen,held}, credits[]}], reviewFlags[]}` (`frozen` is the part of `pending` held by an open dispute; `held`, the part the abuse guard holds for review) |
| `GET /api/review-flags?status=` | `{flags: [{id, creditId, captureId, reason, detail, status, hold, credit}]}`: guard holds (`hold: true`; `open`, `released` or `voided`) and notes on paid credits whose sale came back |
| `GET /api/journeys?limit=` | `{journeys: Journey[]}` |
| `GET /api/journeys?source=mcp` | Sales made through the public `/mcp` endpoint, each with `verdict: {creditable, reason}`. They are kept out of lift, credits and every other number. |
| `GET /api/shapley` | `{sales: [{captureId, brandId, upc, totalMinor, shares:[{creatorId, amountMinor, state, payoutBatchId}]}]}` |
| `GET /api/invoices?brandId=` | `{statements: [{id, brandId, invoiceNumber, invoiceId, status, currency, creditedMinor, voidedMinor, paidMinor, returnedMinor, depositedMinor, reservedMinor, invoiceTotalMinor, invoicePaidMinor, invoiceDueMinor, lines[], payoutBatchIds[], refundIds[], creditIds[], recipientViewUrl, invoicerViewUrl, error, createdAt}]}` |
| `GET /api/webhook-proof` | `{subscriptionId, paypalMode, proofs: [{transmissionId, eventId, eventType, source, signedFor: subscription\|simulator, verified, transmissionTime, certUrl, resourceId, dispatched, receivedAt}]}` |
| `GET /api/payouts` | `{batches: [{senderBatchId, paypalBatchId, status, items[], createdAt}]}` |

`Lift`: `{brandId, name, category, upc, arms:{test|placebo|none:{sessions,purchases}},
exposedRate, placeboRate, lift, stdError, lowerBound, attributableFraction, exposedSales,
causedUnits, perModel:[{model, exposed:{sessions,purchases}, placebo:{…}, exposedRate,
placeboRate, lift, weight}]}` (`stdError`/`lowerBound` are `null` when there is no data).

`credits[]`: `{id, captureId, brandId, upc, amountMinor, currency, state: pending|voided|paid,
voidReason, holdUntil, payoutBatchId, payoutStatus, frozen}`.

`Journey`: `{orderId, sessionId, model, arm, storesViewed[], storeChosen, items:[{upc,
amountMinor, currency}], priceSavedMinor|null, commission:{pending,paid,voided}, holdStatus:
none|held|paid|voided, holdUntil, shapley:[{captureId, shares:[{creatorId, amountMinor,
state}]}], capturedAt}`. `priceSavedMinor` = highest listed price among viewed stores minus the
chosen store's price (from `/api/listings`).
