# Demo dry run (F8, issue #32)

Run on 2026-11-11 against https://pact-worker.vincent-wesley-liem.workers.dev (main after #111) and locally with `CITED_ENGINE=worker npm run demo:cited`. Pages were viewed in a browser at 1440×900 and 900×900; screenshots are not saved to the repo.

**Result: numbers and picture both pass.** Every locked number matches on the hosted engine and in the local demo (14 beats, 32 of 32 ledger-vs-PayPal checks ok). The console now shows the scripted Northwind → Lumen run.

> **Since this run (2026-11-12, #165):** the demo is 15 beats and 45 checks. Beat 14 funds Roborock and Bose and plays a small study in each category, so `/try` vacuum and headphone purchases are credited; every purifier number above is unchanged.

## Before recording

1. **AG Studio shows "For Trial Use Only"** until `AG_STUDIO_LICENSE_KEY` and `AG_GRID_LICENSE_KEY` are set on `pact-worker`. Set them, redeploy, and check the watermark is gone.
2. **Record at 1280px wide or more.** Below 1200px the Studio AI panel starts collapsed; open it with one click for the Analyst beat.
3. **Use the clean URLs:** `/console?clean=1` and `/console/payout?clean=1` hide the console footer.
4. **Don't trigger runs or press Approve, Release or Void on hosted while recording.** Studio's buttons only change your own tab's view, but the public engine is shared.
5. **The hosted data is reseeded every hour.** Order ids change between reseeds. The story and numbers don't.

## Locked numbers

| Number | Hosted (`/api/cited/api/...`) | Local `demo:cited` | |
|---|---|---|---|
| Winix 57/57 test, 3/54 placebo, 3/36 held out, +94pp (first payout) | Studio `?view=first`: 51 of 57, +51 | beat 4–5 | pass |
| Programme to date | `lift`: Winix 69/69, 3/54, 3/36, lift 0.944, 62 caused | final beats: 69 → 69 exposed, 62 caused | pass |
| $391.64 credited, $7.68 voided, $383.96 paid | Studio first payout tiles | winix statement: $391.64 − $7.68 = $383.96 | pass |
| $383.96 to HouseFresh by PayPal Payouts | `/console/payout?clean=1`: $383.96 USD, Completed, HOUSEFRESH-PP | invoice marked paid, $0 due | pass |
| $616.04 of Winix's deposit returned | `deposits`: Winix returned 61604 | $616.04 vs $616.04 refunded | pass |
| $500 top-up after approval | `deposits`: Winix topup 50000 | beat 10 | pass |
| Levoit pays $0, $1,000 back | `deposits`: Levoit spent 0, returned 100000; payout card "Levoit · 0 extra units caused, $0.00 paid" | $1,000.00 returned | pass |
| Prices equal for Winix and Levoit | `/console`: both lanes Lumen $95.99, $4.00 under Northwind | Northwind $99.99, Lumen $95.99, MegaMart $102.99 | pass |
| Shapley split | n/a | $7.68 → HouseFresh $3.84, AirLab $3.84; $468.43 paid in 3 batches | pass |

## Beat by beat

| Beat | URL / command | Should show | Result |
|---|---|---|---|
| 0:00 Hook | `/console/payout?clean=1` | PayPal card, $383.96 USD, Completed, HouseFresh · HOUSEFRESH-PP, "After the 30-day hold" | pass |
| 0:20 Two agents, same request | `/console?clean=1` | Same request; left lane "Shown HouseFresh's test", right lane "Held out"; both "Seeded demo agent" | pass |
| 0:50 Paid through PayPal | `/console?clean=1`, left lane | Northwind → Lumen, "$4.00 under Northwind's", Winix A230 $95.99, captured, "Caused by the test", $7.68 | pass |
| 0:50 Held out | `/console?clean=1`, right lane | Northwind → Lumen, Levoit Core 300 $95.99, "Earns nothing" | pass |
| 1:20 Proof | `/proof`, `/api/cited/api/lift` | Winix lift 94pp; Levoit 0 caused units | pass |
| 1:50 AG Studio | `/studio?view=first` | +51 extra Winix, $391.64 / $7.68 / $383.96, $1,000 deposit, $616.04 returned, cross-store journeys grid | pass (trial watermark until license keys are set) |
| 2:20 Analyst | `/studio`, AI panel | Real model (`claude-sonnet-5-5`), grounded answers | pass |
| Live agent | `/try` | Streams search → results → checkout → paid → verdict with `claude-sonnet-5-5`, not scripted | pass |
| Whole flow, one command | `CITED_ENGINE=worker npm run demo:cited` | 14 beats, 32/32 checks ok | pass |

## Not covered

- Timing against 3:00: no take has been timed yet.
- Real PayPal sandbox mode on hosted. Hosted runs `simulated`; the sandbox runs are in [SANDBOX-EVIDENCE.md](SANDBOX-EVIDENCE.md).
