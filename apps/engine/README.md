# CITED engine

Worker (Hono + D1). Intake of PayPal webhooks, the arm-checkout join, the credit ledger,
batch payouts, deposit refunds and the read API for AG Studio. `PAYPAL_MODE=simulated`
(default) runs everything against the in-memory PayPal mock with no keys.

All money is integer minor units (`amountMinor`) with a currency. Times are ISO 8601.

## Auth

Everything under `/api` needs `Authorization: Bearer $ENGINE_API_TOKEN`. With no token set
it is open in `PAYPAL_MODE=simulated` and answers `503` otherwise. `/webhooks/paypal` is
authenticated by PayPal's signature instead.

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
5. `POST /api/clock/advance` `{days}` or `{to}` — moves the demo clock forward and sends ONE
   batch `POST /v1/payments/payouts` (`PAYPAL_ID` recipients, one item per creator) for every
   credit whose hold ended. `sender_batch_id` = `cited-` + hash of the credit ids, also the
   `PayPal-Request-Id`, so a retry cannot double-pay. `POST /api/payouts/run` does the same
   at the current clock; `POST /api/payouts/refresh` polls batch status.
6. `POST /api/cycle/close` `{brandIds?}` — refunds each brand's unspent deposit through
   `captures/{id}/refund` (deposited − paid − still-pending − returned). A brand with no lift
   gets everything back.

Setup: `POST /api/brands {brandId,name,category,upc,currency?}`,
`POST /api/creators {creatorId,name,paypalId?}`,
`POST /api/listings {listings:[{shopId,upc,priceMinor,currency}]}`,
`POST /api/sessions {sessionId,model,arm,category,creatorsSeen,storesViewed}` (the
catalogue reports every session it assigns an arm; lift needs the non-buyers).

## Read API (AG Studio)

| Endpoint | Response |
| --- | --- |
| `GET /api/clock` | `{now}` |
| `GET /api/lift`, `/api/lift/:brandId` | `{brands: Lift[]}` / `Lift` |
| `GET /api/caused-units` | `{skus: [{brandId, upc, exposedSales, attributableFraction, causedUnits, lowerBound}]}` |
| `GET /api/deposits` | `{brands: [{brandId, name, category, currency, deposited, reserved, spent, returned, available, deposits[], refunds[]}]}` |
| `GET /api/credits?creatorId=` | `{creators: [{creatorId, name, paypalLinked, totals:{pending,voided,paid,frozen}, credits[]}], reviewFlags[]}` (`frozen` is the part of `pending` held by an open dispute) |
| `GET /api/journeys?limit=` | `{journeys: Journey[]}` |
| `GET /api/journeys?source=mcp` | Sales made through the public `/mcp` endpoint, each with `verdict: {creditable, reason}`. They are kept out of lift, credits and every other number. |
| `GET /api/shapley` | `{sales: [{captureId, brandId, upc, totalMinor, shares:[{creatorId, amountMinor, state, payoutBatchId}]}]}` |
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
