# CITED headphones eval: pre-registration

Written and committed before any session of this study ran. A third product category, run with the same design as `PREREGISTRATION-PRICE-MATCHED.md` and `PREREGISTRATION-ROBOT-VACUUM.md`. The purifier results (`results/cited/`, `results/cited-price-matched/`) and the robot-vacuum results (`results/cited-robot-vacuum/`) are untouched.

## Why

Two categories so far, and the second gave a smaller lift than the first partly because agents already leaned towards the tested product and it was listed first at equal price. This study asks the same question in a third category, with a different creator, different products and different buyer requests, and removes the position advantage on purpose: at equal price and seller the tested product is listed second. It is a replication in a third setting, not a tuned demo: the settings below were fixed before running, and the outcome, whatever it is, is reported.

## Setup

Identical to the price-matched purifier study (same models `gpt-6-luna`, `gemini-3.8-flash`, `claude-sonnet-5-5`, temperature 0.7, same system prompts, same tools `create_paypal_order` / `decline_to_buy`, same payload shape from `apps/catalogue-mcp`), except the category:

- **Products:** Bose QuietComfort Headphones (the target; the creator's verdict) and Sony WH-1000XM5, both over-ear wireless noise-cancelling headphones, offered by the same three sellers (Northwind, Lumen, MegaMart). UPCs `100000000021` (Bose) and `100000000020` (Sony). The catalogue gives both the same generic description.
- **Which product is the target, and why:** chosen before any session ran, from judgement, not from data. We expected agents to name the Sony model more readily without any test, because it is the more widely cited of the two. Making the less-expected product the target, and listing it second, leaves room for a test to matter and is the harder case for CITED: a lift here has to overcome both the default and the listing order. This is a prior, not a measurement; no session had been run.
- **Listing order:** ranking stays "price, then seller, then UPC", identical across arms. Sony has the lower UPC, so at equal price and seller it is listed first and Bose is listed second. This is the opposite of the robot-vacuum study, where the target was listed first. In the parity condition the six offers are listed Sony, Bose at Lumen, then at Northwind, then at MegaMart. In the rival-cheaper condition the Sony offer is cheaper at every seller and is listed before the Bose offer at that seller.
- **Creator content:** `QuietBench`, a fictional creator. The test is a head-to-head of the two headphones that recommends the Bose. The placebo is a different QuietBench article (a portable Bluetooth speaker, `100000000022`) that makes no recommendation about headphones. Both are our own illustrative text in `packages/protocol/fixtures/quietbench-*.json`, labelled as illustrative in their disclosure. They describe no real measurements, and the study measures how agents respond to such content, not whether the Bose is better.
- **Buyer requests:** four, in `HEADPHONE_INTENTS` (`src/cited/world.ts`). None names a brand or a model. Each states a budget of about $350 (one says under $380), so every offer is within budget.
- **Search query shown:** `noise cancelling headphones`.
- **Price conditions** (as in the other studies):
  - **parity:** both headphones cost the same at each seller (Northwind $349.99, Lumen $345.99, MegaMart $352.99). Lumen is $4 under Northwind for both.
  - **rival-cheaper:** the Sony costs $4.00 less than the Bose at each seller (Northwind $345.99, Lumen $341.99, MegaMart $348.99).
- **Seed:** `20261113`.
- **Sample:** per price condition and variant (forced, abstain-allowed): per model 19 test / 18 placebo / 12 nothing = 147 sessions. 4 cells, 588 sessions.
- **Outcome, exclusions, statistic:** as in `PREREGISTRATION.md`: the share of sessions that bought the Bose over valid sessions; unparseable sessions retried up to 3 times, then excluded and counted; model-stratified lift and one-sided 80% lower bound from `packages/attribution`; the abstain variant reported over all sessions and buyers-only.
- **Before running:** one single-call connectivity check of each model on the gateway ("say ok"). No study session was run beforehand, and the harness was checked only with `--dry` (counts the plan, calls no model).

## Hypotheses and thresholds

Same thresholds as the other studies, so the categories are comparable.

- **N1 (parity, forced):** pooled lift ≥ +15pp, 80% lower bound > 0, and test − placebo > 0 in each model.
- **N2 (rival-cheaper, forced):** 80% lower bound > 0 (the test beats a $4 price disadvantage as well as the listing order). No size threshold.
- **N3 (placebo neutral):** |placebo − nothing| ≤ 20pp in each price condition (forced).
- **N4 (abstain-allowed, both prices):** reported as is. A lift is claimed only if the buyers-only 80% lower bound is > 0; an all-sessions lift driven by declines is an unlock effect, not brand lift.

## Reporting rules

- Every number is reported as measured, including a null result. If N1 is not met, `/proof` and the docs say so and no pay-out numbers are claimed for this category.
- The derived money chain uses 50 exposed sales at Lumen's $345.99 and a $3,000 deposit (the purifiers' $1,000 deposit cannot cover 50 sales' commission on a $346 product). The deposit is a scripted choice, like the other studies'.
- No session is dropped or re-run after seeing outcomes, except an infrastructure rerun of sessions that returned `invalid` from gateway errors, done before looking at outcomes and recorded in the summary.
- Raw results are committed unedited in `results/cited-headphones/results.jsonl`.
