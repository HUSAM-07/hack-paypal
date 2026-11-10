# Sandbox evidence

The hosted demo runs on a simulated PayPal, so no money moves there. The money at the end of the demo was also run once against the real PayPal sandbox, with the demo's numbers. This page lists those runs by PayPal id only: no credentials, no account emails.

Both runs are recorded in [HUSAM-07/hack-paypal#84](https://github.com/HUSAM-07/hack-paypal/issues/84).

## Payouts: the creator's $383.96

The day-30 payout to the creator (a sandbox personal account standing in for HouseFresh): 51 caused units × $95.99 × 8% = $391.64, minus the $7.68 credit voided by the refunded sale.

| Field | Value |
|---|---|
| API | Payouts v1, `POST /v1/payments/payouts` |
| `payout_batch_id` | `ME2KV57B7KYNS` |
| `sender_batch_id` | `cited-proof-20261110-1` |
| `batch_status` | `SUCCESS` |
| Created / completed | 2026-11-10T12:39:38Z / 2026-11-10T12:40:02Z |
| `payout_item_id` | `QDYB5AWRUSUJU` |
| `transaction_id` | `0P673371YB554783J` |
| `transaction_status` | `SUCCESS` |
| Amount | 383.96 USD |

## Invoicing: the brand's statement

Winix's first-cycle statement, issued through Invoicing v2 by the engine's own statement code and settled against the prepaid deposit, so no money moves twice. Reproduce with `npx tsx apps/engine/scripts/sandbox-statement.ts <env file>` ([script](../apps/engine/scripts/sandbox-statement.ts)).

| Field | Value |
|---|---|
| API | Invoicing v2 |
| `invoice_id` | `INV2-TNXC-9GA6-W36V-WTF6` |
| `invoice_number` | `CITED-WINIX-CYCLE1` |
| Status | `MARKED_AS_PAID`, $0.00 due |
| Line | Commission credited, HouseFresh: $391.64 (51 credits), less $7.68 voided by the refund |
| Invoiced | $383.96, the same as Payouts batch `ME2KV57B7KYNS` |
| Payment recorded | $383.96 against the prepaid deposit (`invoices/{id}/payments`, method `OTHER`); $616.04 of the $1,000.00 deposit returned |

## Webhooks: PayPal-signed events, verified on the hosted engine

The hosted engine runs simulated PayPal, so its demo webhooks carry no signature. A delivery that does carry PayPal's signature headers (`paypal-transmission-sig`, `paypal-cert-url`, …) is verified for real anyway: SHA256withRSA over `transmissionId|transmissionTime|webhookId|crc32(body)`, with the key from the cert at `paypal-cert-url`, which must be on `api.sandbox.paypal.com` or `api-m.sandbox.paypal.com` under `/v1/notifications/certs/`. Verified deliveries are recorded in D1 (`webhook_proofs`) and listed at [`/api/cited/api/webhook-proof`](https://pact-worker.vincent-wesley-liem.workers.dev/api/cited/api/webhook-proof). They are never dispatched into the simulated demo, so sales, lift, credits and payouts don't change. A delivery with PayPal headers that does not verify is rejected `400`.

Each proof row says what the signature binds to:

| `signedFor` | Meaning |
|---|---|
| `subscription` | Signed over our subscription id `8042373202922840X`: PayPal sent this event to CITED's webhook. |
| `simulator` | Signed by PayPal's cert over the literal id `WEBHOOK_ID`. The simulator deliveries captured below were signed this way, and PayPal's `verify-webhook-signature` API answered `FAILURE` for them. The run against the subscription will show which id it signs those with. It proves PayPal signed these exact bytes, not that they were sent to our subscription. |

What was verified on 2026-11-10, before deploy: two deliveries from PayPal's sandbox simulator (`POST /v1/notifications/simulate-event`), sent through a tunnel to a local `pact-worker` in simulated mode (the hosted configuration). Both were recorded `verified=1`, `signedFor=simulator`, with 0 sales and 0 ledger events. The captured headers and bodies, with PayPal's sandbox cert, are test fixtures that verify offline ([simulator.test.ts](../packages/paypal/src/webhooks/simulator.test.ts)).

After deploy, on 2026-11-11, `scripts/webhook-proof.mjs` ran against the hosted site. Both simulator deliveries reached subscription `8042373202922840X` and were recorded `verified=true`, `signedFor=subscription`: PayPal signed them for our webhook id, not only for the simulator.

| Event | Event id | Transmission id |
|---|---|---|
| `PAYMENT.CAPTURE.COMPLETED` | `WH-58D329510W468432D-8HN650336L201105X` | `ef0da7ce-dd1f-11f1-98c7-4f63a0ac1ba3` |
| `PAYMENT.CAPTURE.REFUNDED` | `WH-1GE84257G0350133W-6RW800890C634293G` | `ef99e1a9-dd1f-11f1-9e97-094a4f799862` |

Live record: [/api/cited/api/webhook-proof](https://pact-worker.vincent-wesley-liem.workers.dev/api/cited/api/webhook-proof).

| Event | `event_id` (fixed by the simulator) | `paypal-transmission-id` |
|---|---|---|
| `PAYMENT.CAPTURE.COMPLETED` | `WH-58D329510W468432D-8HN650336L201105X` | `6692b44f-dd18-11f1-9e97-111303fc7a16` |
| `PAYMENT.CAPTURE.REFUNDED` | `WH-1GE84257G0350133W-6RW800890C634293G` | `67aed2b4-dd18-11f1-84a3-03f739a3e2c9` |

Cert: `https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-9eaebfdf` (CN `messageverificationcerts.sandbox.paypal.com`, valid to 2027-05-07).

To prove it on the hosted engine once this is deployed, with the sandbox app's credentials in an env file:

```bash
node --env-file=<env file with PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET> scripts/webhook-proof.mjs
```

It asks the simulator to deliver both events to subscription `8042373202922840X` and polls `/api/cited/api/webhook-proof` until both show `verified=true`, printing the event id, `signedFor`, transmission id and cert URL. Proof rows are keyed by transmission id, because the simulator reuses the event ids above on every run. A `subscription` row appears whenever PayPal sends a real event to the subscription, for example `PAYMENT.PAYOUTSBATCH.SUCCESS` after a sandbox payout.

## Not yet run in the sandbox

The steps before the payout (the buyer's vault approval, the agent's Orders v2 checkouts, captures and the refund webhook) need the sandbox buyer to approve the vault, and have so far run only against the simulated PayPal. The eval numbers behind the $383.96 come from the committed results in [`packages/evals/results`](../packages/evals/results).
