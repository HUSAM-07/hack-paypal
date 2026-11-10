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

## Not yet run in the sandbox

The steps before the payout (the buyer's vault approval, the agent's Orders v2 checkouts, captures and the refund webhook) need the sandbox buyer to approve the vault, and have so far run only against the simulated PayPal. The eval numbers behind the $383.96 come from the committed results in [`packages/evals/results`](../packages/evals/results).
