# CITED agents

Shopper agents (GPT, Gemini, Sonnet) and the one-command demo runner.

```bash
npm run demo:cited                 # every packet beat, fake agents, no keys
npm run demo:cited -- --help
npm run e2e:cited                  # the same pipeline as an assertion-checked test (~30 s)
```

## Demo runner (`npm run demo:cited`)

Starts a private stack (engine on `wrangler dev` with a throwaway D1, and the catalogue, which
also runs the agents' PayPal checkout; ports 8800-8801; `PAYPAL_MODE=simulated`), plays the beats of `cited/spec/CITED-packet.md` in order,
checks that the engine's ledger agrees with what PayPal's mocks hold, and stops the stack. It exits
non-zero if any check fails or the numbers drift from the card. About 10 s.

| # | Beat | What happens |
| --- | --- | --- |
| 1 | `fund` | Winix and Levoit each deposit $1,000 (Orders v2 captures) |
| 2 | `exposed` | An exposed agent reads Northwind's offer ($99.99), checks out through PayPal and pays Lumen $4 less ($95.99) |
| 3 | `heldout` | A held-out agent, same request and offers, no test, buys Levoit |
| 4 | `study` | The other 145 sessions: 3 models × 3 arms (19 exposed, 18 placebo, 12 held out each) |
| 5 | `credits` | Engine: 57 exposed sales → 51 caused units → $391.64 credited; Levoit 0 units, $0 |
| 6 | `refund` | One buyer returns a Winix; Lumen refunds it through PayPal and the webhook voids that pending credit (see below) |
| 7 | `jump` | Demo clock +30 days |
| 8 | `payout` | One batch Payouts call to HouseFresh's `PAYPAL_ID` |
| 9 | `return` | Unspent deposits come back through `captures/{id}/refund` |
| 10 | `analyst` | "Tests with a clear winner move agents 94 points…"; Maya approves a $500 top-up (scripted amount) |
| 11 | `shapley` | A later cycle: AirLab joins with its own purifier test; 12 agents (4 per model) see both tests and buy Winix. The bound tightens (51 → 62 units); one co-exposed sale's $7.68 splits HouseFresh $3.84, AirLab $3.84 by Shapley |
| 12 | `dispute` | The buyer of that sale opens a PayPal dispute: its 2 credits freeze. Day 60: one batch pays HouseFresh $61.43 and AirLab $15.36, the frozen $7.68 held back. PayPal resolves for the seller and the next batch pays $3.84 + $3.84 |
| 13 | `checks` | Ledger vs PayPal mocks; one line per check |

**The later cycle.** Beats 11-12 run after the day-30 payout and the deposit returns, so the
card's numbers (beats 1-10) never move. They are demo outputs, stated on their own: AirLab's
cohort draws on Winix's approved $500 top-up. A dispute only freezes a credit; it voids if PayPal
decides for the buyer (`RESOLVED_BUYER_FAVOUR`) and is released otherwise. The runner pins these
numbers too (`COEXPOSURE` in `src/demo.ts`).

**Determinism.** The seed fixes everything. The catalogue is stateless and arms are a hash of
`(seed, sessionId)`, so the runner picks session ids that land on the planned arms (simulated mode
only; the catalogue ignores a caller-chosen id otherwise). Under the fake provider each agent's
choice is scripted to the price-matched study's shape (Winix share 57/57, 3/54, 3/36), so the card's
numbers come out of the real pipeline. Two runs with one seed give byte-identical event streams.
`--real-models` uses the gateway (`LLM_BASE_URL`, `LLM_API_KEY`); numbers then differ from the card.

**The refund beat.** A void only applies to a *pending* credit (rule 5), so the order matters:

- `--refund before-payout` (default, matches the card): the refund voids one credit first. $391.64
  credited, −$7.68 voided, $383.96 paid to HouseFresh, $616.04 returned.
- `--refund after-payout`: $391.64 is paid and $608.36 returned; the late refund
  can't claw back a paid credit and shows as a review flag.

### Flags

`--seed S` · `--real-models` · `--refund before-payout|after-payout` · `--events FILE|-` ·
`--serve PORT` · `--pace MS` · `--use-running` · `--verbose`

`--use-running` uses an already running `npm run dev:cited` stack and needs a fresh engine
database (a second run on the same engine would find the first run's deposits and sessions).

## Event stream

One JSON object per line (JSONL), also served as Server-Sent Events. Start with
`--events run.jsonl` (file), `--events -` (JSONL on stdout, nothing else) or `--serve 8805`
(`GET http://localhost:8805/events` is SSE, `GET /events.jsonl` is the history so far; both replay
from `seq` 1 for late joiners; CORS open). The server stays up after the run until Ctrl-C.

```ts
interface DemoEvent {
  v: 1;
  seq: number;          // 1, 2, 3, … no gaps
  type: "run.start" | "beat.start" | "line" | "session" | "numbers" | "beat.end" | "run.end";
  beat?: "fund" | "exposed" | "heldout" | "study" | "credits" | "refund" | "jump" | "payout" | "return" | "analyst" | "shapley" | "dispute" | "checks";
  text?: string;        // a sentence for the screen: beat title, line, or "ok"/"failed" on run.end
  data?: Record<string, unknown>;
}
```

There are no wall-clock fields, so a consumer stamps events on arrival.

| `type` | When | `data` |
| --- | --- | --- |
| `run.start` | once | `{seed, provider, refund, beats[]}` |
| `beat.start` / `beat.end` | around each beat | none; `text` is the beat title |
| `line` | narration, in order | optional facts, e.g. `{brandId, amountMinor, captureId}` |
| `session` | each agent session | `{sessionId, model, arm, storesViewed[], seller, sellerName, paidWith, product, upc, totalMinor, orderId, captureId, reason, status}` |
| `numbers` | the beat's figures (money in minor units) | per beat, below |
| `run.end` | once | the headline numbers, `matchesCard`, and every `checks[]` `{name, ok, detail}` |

`numbers` by beat: `study` `{sessions, byArm:[{arm, sessions, winix, levoit}]}` · `credits`
`{exposedSales, causedUnits, attributableFraction, liftPoints, lowerBound, credits, creditedMinor,
levoitCausedUnits, levoitLowerBound}` · `refund` `{captureId, voidedCredits, voidedMinor,
reviewFlags, creditStates}` · `jump` `{days, payout}` · `payout` `{batches, senderBatchId, items,
paidMinor, pendingMinor, voidedMinor}` · `return` `{brands:[{brandId, spentMinor, returnedMinor}]}` · `shapley` `{sessions, winixBuyers,
causedUnitsBefore, causedUnitsAfter, earlierSalesCredited, coExposedSalesCredited, splitSale,
day60, released, lowerBound, exposedSales, coalitionLiftPoints, shapleyPoints}` · `dispute`
`{day60}` then `{outcome, released}` · `checks` `{checks[]}`.

`run.end.data`: `{sessions, purchased, exposedSales, causedUnits, creditedMinor, paidMinor,
returnedMinor, levoitCausedUnits, liftPoints, coExposure, matchesCard, checks}` (`sessions` counts
the 147-session study only).

## Shopper runner (`npm run run:sessions`)

`tsx src/cli.ts --n 10 --seed s [--family gpt|gemini|sonnet|mix] [--in-process]` runs sessions
against the catalogue (offers and checkout) and prints one JSON record per session. Set `MODEL_PROVIDER` to a
non-`fake` value to use real models through the gateway.

## How sales reach the engine

The agent calls the catalogue's `checkout` tool; the platform creates the Orders v2 order with the
seller as `payee`, the passport in `custom_id` and the buyer's vaulted wallet as payment source, so
PayPal creates and captures it in one call (see `cited/spec/AGENT-CHECKOUT.md`). The catalogue's
PayPal mock (`@pact/paypal`) delivers the same signed webhooks PayPal would
(`CHECKOUT.ORDER.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED`) to `ENGINE_URL/webhooks/paypal`; the
runner reports each session's arm to `POST /api/sessions` so lift sees the non-buyers. Sellers
refund with catalogue `POST /sellers/:id/refunds`. Simulated-only: a buyer's dispute and PayPal's
decision with catalogue `POST /mock/disputes {captureId}` and
`POST /mock/disputes/:id/resolve {favour: seller|buyer}` (signed `CUSTOMER.DISPUTE.CREATED` /
`.RESOLVED` webhooks); catalogue `GET /mock/state`;
engine `GET /api/mock/state`.
