# CITED engine benchmark

The demo runs 159 agent sessions. This measures the attribution engine at 1,000, 10,000 and
50,000 sessions, checks the ledger stays correct at that volume, and times the pure maths at
1,000,000 sales. Raw output: [bench-results.json](bench-results.json).

```bash
npm run bench:cited                                    # 10k sessions + 1M pure, ~3 min
npm run bench:cited -- --sessions 1000,10000,50000 --json cited/bench-results.json
npm run bench:cited -- --pure-only                     # no wrangler
```

## Machine and method

- Apple M2 Pro, 12 cores, 32 GB, macOS 27.2, Node 22.23.4, wrangler 4.156.0. Other local
  dev servers were running at the same time, so treat the numbers as a floor, not a ceiling.
- The engine runs exactly as deployed: `wrangler dev` of `pact-worker` on a fresh local D1
  (all migrations applied), `CITED_OPEN_API=1`, simulated PayPal. Every request goes to
  `/api/cited/*`; in simulated mode that is the one demo Durable Object, so every write is
  serialised through a single object.
- [`scripts/bench-engine.mjs`](../scripts/bench-engine.mjs) generates N agent sessions from a
  fixed seed: 3 brands in 3 categories, arms 50% test / 25% placebo / 25% none, 3 models
  (GPT, Gemini, Sonnet), 24 creators with 1 to 4 co-exposed per session. 20% of test sessions
  and 12% of the others buy (90% the brand's SKU, 10% an unfunded one).
- Each purchase is delivered as PayPal would: `CHECKOUT.ORDER.COMPLETED` (line items, payer),
  then `PAYMENT.CAPTURE.COMPLETED` carrying the HMAC-signed Agent Affiliate Passport in
  `custom_id`. 32 requests in flight. 1% of captures are redelivered with the same event id.
- After the first credit recompute, ~2% of sales are refunded (a quarter of them partially)
  and ~0.5% disputed (a third resolved for the buyer, a third for the seller, a third left
  open), drawn first from exposed-arm sales so they hit credited captures. Then: recompute
  again, a payout run inside the 30-day hold, a 31-day clock jump with its payout run, and
  cycle close (deposit refunds and brand statements).
- Latency is client-side wall time per HTTP request on localhost.

## Results

| | 1k sessions | 10k sessions | 50k sessions |
|---|---:|---:|---:|
| Sales (captures) | 160 | 1,571 | 8,006 |
| Refunds / disputes | 3 / 1 | 31 / 8 | 160 / 40 |
| Session reports: per second | 346 | 552 | 528 |
| Session reports: p50 / p95 / p99 ms | 85 / 143 / 161 | 55 / 79 / 126 | 54 / 101 / 149 |
| Order webhooks: per second | 343 | 316 | 485 |
| Order webhooks: p50 / p95 / p99 ms | 90 / 110 / 110 | 91 / 200 / 261 | 58 / 109 / 162 |
| Capture webhooks + passport join: per second | 162 | 214 | 299 |
| Capture + join: p50 / p95 / p99 ms | 174 / 293 / 294 | 143 / 212 / 282 | 100 / 158 / 207 |
| Refund webhooks (each voids its credits): p50 ms | 25 | 112 | 114 |
| Credits recompute (lift + Shapley + caps + voids + guard) | 58 ms, 16 credits | 123 ms, 824 credits | 643 ms, 4,014 credits |
| Recompute again (idempotent, 0 new) | 47 ms | 124 ms | 631 ms |
| Payout run inside the hold | 14 ms, nothing due | 27 ms, nothing due | 154 ms, nothing due |
| Clock +31 days and payout batch | 78 ms, 11 items | 46 ms, 24 items | 191 ms, 24 items |
| Cycle close (deposit refunds + statements) | 45 ms | 127 ms | 54 ms |

Throughput rises with size because the first seconds of each run include the Durable
Object's cold start. At 50k sessions the engine took 8,006 signed captures at ~300 a second
through one Durable Object, and a full recompute over 4,014 credits took under a second.

### Pure maths at 1,000,000 sales (`@pact/attribution`, in process)

| Step | Time |
|---|---:|
| Tally 1M sessions into 3 model strata, then lift + 80% lower bound + attributable fraction | 29 ms + 0.3 ms |
| Lift and attributable fraction evaluated 1M times | 238 ms |
| Shapley split, 1 / 2 / 3 / 4 co-exposed creators, 1M sales each | 0.49 / 0.82 / 1.29 / 2.46 s |
| `createCredits`: 1M sales → 1,000,547 credits (8% commission, cumulative rounding, Shapley) | 2.9 s |
| `releasePayable`: 1M credits → payout lines | 0.72 s |

## Correctness at scale

Every run checks these against the local D1 file and the PayPal mock's state, and fails if
any does not hold. All passed at 1k, 10k and 50k:

- Every signed sale was joined to its arm (0 unattributed), and sales in D1 equal what was
  sent, count and cents.
- Redelivered webhooks were deduplicated; nothing was recorded twice.
- Every full refund voided exactly its own capture's credits, partial refunds voided only a
  share, and no credit was voided by a refund it does not belong to. At 50k, 54 refunded sales
  carried credits.
- A dispute won by the buyer voided its credits; an open dispute's credits were never paid.
- No credit was paid inside its 30-day hold: the payout run before the jump paid nothing, and
  no paid credit has a hold ending after the payout.
- Paid credits equal the mock's Payouts batch items to the cent, and no batch exceeds 15,000
  items.
- Deposited = paid + still pending + refunded at cycle close, and the deposit refunds in D1
  equal the refunds in the mock.

## What the benchmark found and fixed

Nothing broke at 50k, but four things would have, further out. Fixed with tests in
[`apps/engine/test/scale.test.ts`](../apps/engine/test/scale.test.ts); the demo's numbers are
unchanged.

1. **Payout batches had no size limit.** PayPal's Payouts API takes at most 15,000 items per
   call, and the engine put every creator in one call. It now splits a run into batches of at
   most 15,000 (`PAYOUT_BATCH_MAX_ITEMS`), each with its own deterministic `sender_batch_id`.
   A run under the limit keeps the same id as before.
2. **Ledger writes would hit D1's per-invocation query cap.** A Worker invocation may make
   1,000 D1 queries (a `batch()` counts as one). Credits were written one statement per row,
   50 per batch, so ~50k changed credits in one recompute or payout would have hit the cap.
   They are now bulk-written through `json_each`, 2,000 rows per statement, in one batch: one
   transaction, and one query per 2,000 rows.
3. **`releasePayable` was quadratic.** It copied each creator's credit list for every credit:
   540 ms at 100k credits, so ~1 minute at 1M. Now 0.72 s at 1M.
4. **Every refund webhook reloaded the whole ledger.** It now loads only its capture's credits
   and sale, and the full void pass reads sale totals in one query instead of one per refund.
   Also: Shapley coalition values are memoised per recompute (each was a scan of every exposed
   session, once per subset per sale), and payouts read creators' PayPal ids in one query.

## Caveats

- **Local D1 is not production D1.** Miniflare's D1 is SQLite on the same machine, with no
  network hop and no replication. Production D1 adds a round trip per query from the Worker,
  so expect higher latency per webhook (each makes 3 to 6 queries) and similar query plans.
  These numbers show the work per event and how it grows, not production latency.
- **One Durable Object serialises simulated mode.** Simulated PayPal lives in memory, so the
  deployed worker routes `/api/cited` through one Durable Object. With real PayPal the engine
  runs in any isolate and D1 is the only shared state, so intake would scale out further.
- **Recompute grows with the ledger.** It reads every attributed sale and credit each time
  (643 ms at 4k credits). That is fine as a periodic job; a much larger network would compute
  per brand and only for new captures.
- **The 15,000-item split is tested, not benchmarked.** A batch item is one creator, and the
  benchmark has 24. The split is covered by an engine test with a small limit.
- Sessions here are synthetic, so the credited share and money totals are not study results;
  the card's numbers still come only from `packages/evals`.
