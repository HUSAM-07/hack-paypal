# Sandbox evidence

The hosted demo runs on a simulated PayPal, so no money moves there. The money at the end of the demo was also run once against the real PayPal sandbox, with the demo's numbers, and the whole agent checkout (vault, order, capture, credit, refund void, payout) ran once end to end through the engine's code with small amounts. This page lists those runs by PayPal id only: no credentials, no account emails, no vault or payer ids.

All runs are recorded in [HUSAM-07/hack-paypal#84](https://github.com/HUSAM-07/hack-paypal/issues/84).

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

## Agent checkout, end to end: vault → order → capture → credit → refund void → payout

Run on 2026-11-10 (UTC) with [`apps/engine/scripts/sandbox-agent-checkout.ts`](../apps/engine/scripts/sandbox-agent-checkout.ts):

```bash
CITED_BUYER_VAULT_FILE=<vault json> npx tsx apps/engine/scripts/sandbox-agent-checkout.ts <env file>
```

It prints PayPal ids and statuses only. What was real and what was not:

| Step | Where it ran |
|---|---|
| Buyer's vaulted PayPal wallet (`payment_source.paypal.vault_id`) | Real sandbox. The sandbox buyer approved the setup token once; every order below charged that vault with no further approval. |
| Agent search, arm assignment, signed passport | The catalogue's own code (`createCatalogue`), in process. |
| Agent checkout: Orders v2 with seller as `payee`, passport in `custom_id`, `items[].upc` | Real sandbox, through the catalogue's `checkout()`: PayPal created and captured each order in one call (`COMPLETED`), then the Agent Toolkit's `get_order` read it back. |
| Seller refund | Real sandbox, Agent Toolkit `create_refund`. |
| Webhook delivery | Real: PayPal sent `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.PAYOUTSBATCH.*` to subscription `8042373202922840X`, and the hosted engine verified each signature (`signedFor=subscription`). |
| Ledger: join, lift, credits, void, guard, payout | The engine's code, in process, `PAYPAL_MODE=sandbox`, on a fresh local D1. |
| Events into that local engine | **Replayed.** PayPal cannot reach a local engine and we did not open a tunnel, so the script fetched each event from PayPal's events API (`GET /v1/notifications/webhooks-events`) and posted it to the engine's `/webhooks/paypal`, re-signed with a throwaway local cert. Everything after the signature check is the engine's real code. The capture events carry no line items, so the engine read each order from PayPal (`get_order`) to join the sale to its seller and UPC. |
| Brand deposit | Real sandbox $1.00 capture, paid from the vaulted wallet. The engine's own deposit order waits for a brand to approve it at PayPal; a headless run cannot, so the script recorded the capture the way `captureDeposit` does. |
| Payout | Real sandbox Payouts batch sent by the engine's `runPayouts`, `recipient_type` `PAYPAL_ID`, deterministic `sender_batch_id`. |

Sessions: 3 exposed to HouseFresh's Winix test (all bought), 8 placebo (none bought), plus the no-content sessions the catalogue assigned on the way; one scripted agent model. Each sale: $2.00 at Lumen, UPC `100000000001`. The signed passport in `custom_id` was 62 characters and still verified when read back from PayPal.

### Orders and captures

| | Order | Capture | Status |
|---|---|---|---|
| Brand deposit (`custom_id` `cited-dep:winix`), $1.00 | `7XS95089B0131464C` | `1RW3974186481415R` | `COMPLETED` |
| Agent sale 1, $2.00 | `8E6030344K4198450` | `3NH71085W5469283J` | `COMPLETED`, later refunded |
| Agent sale 2, $2.00 | `8F195714E6441535R` | `74B14143V5373574L` | `COMPLETED` |
| Agent sale 3, $2.00 | `4XV50799SF6195530` | `5AY25547HJ5070341` | `COMPLETED` |

Read back from PayPal (order `8E6030344K4198450`): `reference_id` `lumen`, `payee` set, `items[0].upc` `{type: UPC-A, code: 100000000001}`, and `custom_id` verifies as a passport.

### What the engine did

| Step | Result |
|---|---|
| Recompute | Winix: 3 exposed sales, attributable fraction 0.786 at the 80% lower bound, **2 caused units**, 2 pending credits of $0.16 (8% of $2.00) on captures `3NH71085W5469283J` and `74B14143V5373574L` |
| Refund `81C245246C527113H` of capture `3NH71085W5469283J` | `COMPLETED`; the `PAYMENT.CAPTURE.REFUNDED` event **voided** that credit (`voidReason: refund`) |
| Day 31 | The abuse guard held the remaining credit: `self_purchase`. The sandbox has one personal account, so the buyer who paid is also the creator's payout receiver, which is exactly what the guard looks for. The script released the hold through `POST /api/review-flags/:id/release`, as a reviewer would. |
| Payout | Batch `GB9U5DYBGHLY4`, `sender_batch_id` `cited-6f574066056e50da8cfba9c9e19d2758`, `SUCCESS`; item `C5JGPHCPV5DTE`, transaction `9VY80107DJ501915S`, 0.16 USD, `SUCCESS`. The credit is `paid` with that batch id; the voided one was not paid. |

### Webhooks PayPal sent, verified on the hosted engine

| Event | Resource | Event id | Transmission id |
|---|---|---|---|
| `PAYMENT.CAPTURE.COMPLETED` | deposit `1RW3974186481415R` | `WH-9UF36234GR757963C-6WA14718V2816523Y` | `5c866128-dd3d-11f1-8118-859bca291824` |
| `PAYMENT.CAPTURE.COMPLETED` | `3NH71085W5469283J` | `WH-4WG41797SW3496008-98Y49543EJ2036912` | `584730cf-dd3d-11f1-8118-59b8b5464d32` |
| `PAYMENT.CAPTURE.COMPLETED` | `74B14143V5373574L` | `WH-57T3469384491762P-9C282954DT119182N` | `5caf946b-dd3d-11f1-bdb3-ffd39224685c` |
| `PAYMENT.CAPTURE.COMPLETED` | `5AY25547HJ5070341` | `WH-0AJ60520WP8055443-5UN667350D3232625` | `625f6ad4-dd3d-11f1-bdb3-fb95004a81fc` |
| `PAYMENT.CAPTURE.REFUNDED` | refund `81C245246C527113H` | `WH-8XN750834C843330K-8WR90752NC992325D` | `cda4a9ae-dd3d-11f1-ae6a-393f5c810b2d` |
| `PAYMENT.PAYOUTSBATCH.PROCESSING` | batch `GB9U5DYBGHLY4` | `WH-2F7798662U991061B-2AC47433PP4798435` | `02d52618-dd3e-11f1-84a3-4f9e5c8b4fc9` |
| `PAYMENT.PAYOUTSBATCH.SUCCESS` | batch `GB9U5DYBGHLY4` | `WH-4A384970NC906034D-84K241677K921990T` | `0f2a30b5-dd3e-11f1-98c7-f97b04a73b36` |

All `verified=true`, `signedFor=subscription`, and listed at [/api/cited/api/webhook-proof](https://pact-worker.vincent-wesley-liem.workers.dev/api/cited/api/webhook-proof). The hosted engine runs simulated PayPal, so it records them and does not dispatch them; the event ids are the same ones the local engine received by replay.

Earlier vault smoke test (2026-11-10): $1.00 order `50542347YD822594J`, capture `7NM60589UN236160Y` `COMPLETED`, `custom_id` kept; its capture event `WH-35E94278CM0934524-8AY757673V9186310` was verified on the hosted engine the same way.

The eval numbers behind the $383.96 come from the committed results in [`packages/evals/results`](../packages/evals/results).
