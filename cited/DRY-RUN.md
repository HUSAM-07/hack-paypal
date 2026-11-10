# Demo dry run (F8, issue #32)

Run on 2026-11-10 against https://pact-worker.vincent-wesley-liem.workers.dev (main at `bd8fe07`) and locally with `CITED_ENGINE=worker npm run demo:cited`. Screenshots were viewed in the built-in browser, not saved to the repo.

**Result: the numbers are all right; the picture is not yet.** Every locked number matches on the hosted engine and in the local demo. The problems are in what the console frame shows and what is not deployed.

## Problems, worst first for video

1. **Studio beat.** Rebuilt on AG Studio; how to record it, with Maya approving in Studio: [STUDIO.md](STUDIO.md). (Was: `/studio` returned 404 on hosted, pending #69.) The 1:50-2:40 beat: +51 extra Winix, $391.64 → $383.96, Levoit $0, Analyst, Maya approves. Fallback if Studio is down: the API (`/api/cited/api/lift`, `/deposits`) or the local demo output carries the same numbers.
2. **Console side-by-side showed the wrong story (fixed in this PR).** Hosted `/console` showed the newest runs: exposed agent saw the test at MegaMart ("$7.00 cheaper") and the held-out agent bought the same Winix, with "No commission: the test did not cause this sale" under the exposed order (the engine credits 51 of the 57 exposed sales; the newest was one of the 6 not credited). The script says Northwind → Lumen ($4 cheaper) and held-out buys Levoit. Commit "fix(console): show a credited, cross-shop…" now prefers a credited, cross-shop exposed run and a held-out run that bought the other purifier. It takes effect once this merges to `main` and deploys. Re-check `/console?clean=1` after the deploy.
3. **The hosted demo is a finished run, not a live one.** State is already post-payout (clock at 2026-12-09, deposits captured, payout `000000000000C` sent). The payout card therefore reads "Dec 9, 2026", a date in the future. The simulated PayPal lives in the demo Durable Object's memory and resets when it idles; D1 keeps the ledger. If the object is evicted before recording, hosted `/console/payout` still reads from D1, but new orders and refunds need a fresh run. Do not trigger a re-run on hosted while recording. Cut the date off the payout card, or record the local demo for the hook.
4. **"Pay with PayPal (simulated)" on shop product pages.** Visible if the video lingers on a shop. Crop it, or show the shop only as the hop.
5. **Console "Runs / Payout" footer and `/console/` links.** `?clean=1` hides the footer; use `/console?clean=1` and `/console/payout?clean=1` for recording.
6. **Levoit shows "lift bound −98.6 points" in the local demo output (beat 5).** Correct (Levoit's exposed share is 0/57 against 51/54 for the placebo), but it will read oddly next to "Levoit's sales didn't lift". Say "no lift", not the number.

## Locked numbers

| Number | Hosted (`/api/cited/api/...`) | Local `demo:cited` | |
|---|---|---|---|
| 51 caused units | `caused-units`: Winix 51 (57 exposed, bound 90.3%) | beat 5: 51 | pass |
| $391.64 credited | 51 × $7.68 (768 minor) | beat 5: $391.64 | pass |
| Refund voids $7.68 | `credits`: housefresh voided 768, one credit | beat 6: 1 voided, $7.68 | pass |
| $383.96 to HouseFresh | `payouts`: 38396, batch SUCCESS; `/console/payout` shows $383.96 | beat 8: $383.96 | pass |
| $616.04 returned | `deposits`: Winix returned 61604 | beat 9: $616.04 | pass |
| Levoit pays $0 | `deposits`: Levoit spent 0, returned 100000; payout card "Levoit · 0 extra units · $0.00 paid" | beat 9: $1,000 returned | pass |
| $500 top-up after approval | `deposits`: `dep_winix_approval-analyst-1` topup 50000 | beat 10: $500.00 | pass |
| Prices (Winix = Levoit) | Northwind $99.99, Lumen $95.99, MegaMart $102.99 on both | beat 1: same | pass |
| 94pp lift, 57/57, 3/54, 3/36 | `lift`: Winix 57/57, 3/54, 3/36, lift 0.944 | beat 4 | pass |

Local run ends with 16 of 16 ledger-vs-PayPal checks ok.

## Beat by beat

| Beat | URL / command | What to click | Should show | Result |
|---|---|---|---|---|
| 0:00 Hook: $383.96 notification | `/console/payout?clean=1` | none | PayPal card, "$383.96 USD", Completed, HouseFresh · HOUSEFRESH-PP | **pass**, date reads Dec 9, 2026 (problem 3) |
| 0:20 Money beat: two agents, same request | `/console?clean=1` | none | Request text; exposed agent with passport "shown the test", held-out "held out"; same listings | **fail on main** (problem 2); fixed in this PR, verify after deploy |
| 0:20 Winix and Levoit fund, equal prices | `/shops/northwind`, `/shops/lumen`, `/shops/megamart` | open each | Winix and Levoit at $99.99 / $95.99 / $102.99 | pass |
| 0:50 PayPal-only: Northwind → Lumen $4 cheaper | `/console?clean=1`, left column | none | "Stores visited: Northwind", paid at Lumen, "$4.00 cheaper" | **fail on main** (problem 2: showed MegaMart, $7.00), fixed in this PR |
| 1:20 Proof: 147 sessions, 94pp, 24pp, close verdict pays nothing | `/api/cited/api/lift` | none | Winix 57/57, 3/54, 3/36; Levoit 0 caused units | pass (numbers only; no page shows the 24pp or narrow-verdict studies, they come from `packages/evals/results`) |
| 1:50 AG Studio: +51, $391.64, voids $7.68, $383.96, $616.04, Levoit $0, Analyst, Maya approves | `/studio` | | | AG Studio; see [STUDIO.md](STUDIO.md) |
| 2:40 Close | | | | n/a, no screen |
| Whole flow, one command | `CITED_ENGINE=worker npm run demo:cited` | | 11 beats, all locked numbers, 16/16 checks ok | pass |

## Not covered

- Timing against 3:00: the script is narration over static frames; no live run was timed. The local demo finishes in well under a minute.
- Real PayPal sandbox mode. Hosted runs `simulated`.
- I did not click "Pay with PayPal (simulated)" or call any mutating endpoint on hosted.
