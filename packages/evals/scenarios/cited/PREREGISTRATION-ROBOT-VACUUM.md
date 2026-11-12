# CITED robot-vacuum eval: pre-registration

Written and committed before any session of this study ran. A second product category, run with the same design as `PREREGISTRATION-PRICE-MATCHED.md`. The purifier results (`results/cited/`, `results/cited-price-matched/`) are untouched.

## Why

Every number so far comes from one category, air purifiers. This study asks whether the system's core claim holds in a different category with a different creator, different products and different buyer requests, using the same agents, tools, harness and statistic. It is a replication in a second setting, not a tuned demo: the settings below were fixed before running, and the outcome, whatever it is, is reported.

## Setup

Identical to the price-matched purifier study (same models `gpt-6-luna`, `gemini-3.8-flash`, `claude-sonnet-5-5`, temperature 0.7, same system prompts, same tools `create_paypal_order` / `decline_to_buy`, same payload shape from `apps/catalogue-mcp`), except the category:

- **Products:** Roborock Q7 Max (the target; the creator's verdict) and iRobot Roomba Combo j5, offered by the same three sellers (Northwind, Lumen, MegaMart). UPCs `100000000006` and `100000000007`.
- **Creator content:** `CrumbLab`, a fictional creator. The test is a head-to-head of the two vacuums that recommends the Roborock. The placebo is a different CrumbLab article (a steam mop, `100000000008`) that makes no recommendation about robot vacuums. Both are our own illustrative text in `packages/protocol/fixtures/crumblab-*.json`, labelled as illustrative in their disclosure. They describe no real measurements, and the study measures how agents respond to such content, not whether the Roborock is better.
- **Buyer requests:** four, in `VACUUM_INTENTS` (`src/cited/world.ts`). None names a brand. Each states a budget of about $300, so every offer is within budget.
- **Search query shown:** `robot vacuum for hard floors`.
- **Price conditions** (as in the purifier study):
  - **parity:** both vacuums cost the same at each seller (Northwind $299.99, Lumen $295.99, MegaMart $302.99). Lumen is $4 under Northwind for both.
  - **rival-cheaper:** the Roomba costs $4.00 less than the Roborock at each seller (Northwind $295.99, Lumen $291.99, MegaMart $298.99).
- **Ranking** stays "price, then seller, then UPC", identical across arms. In parity the Roborock sorts before the Roomba at equal price and seller (UPC tie-break), so it is listed first: a position advantage that is the same in every arm, and is disclosed, not removed.
- **Seed:** `20261112`.
- **Sample:** per price condition and variant (forced, abstain-allowed): per model 19 test / 18 placebo / 12 nothing = 147 sessions. 4 cells, 588 sessions.
- **Outcome, exclusions, statistic:** as in `PREREGISTRATION.md`: the share of sessions that bought the Roborock over valid sessions; unparseable sessions retried up to 3 times, then excluded and counted; model-stratified lift and one-sided 80% lower bound from `packages/attribution`; the abstain variant reported over all sessions and buyers-only.
- **Before running:** one single-call connectivity check of each model on the gateway ("say ok"). No study session was run beforehand, and the harness was checked only with `--dry` (counts the plan, calls no model).

## Hypotheses and thresholds

Same thresholds as the purifier study, so the two categories are comparable.

- **V1 (parity, forced):** pooled lift ≥ +15pp, 80% lower bound > 0, and test − placebo > 0 in each model.
- **V2 (rival-cheaper, forced):** 80% lower bound > 0 (the test beats a $4 price disadvantage). No size threshold.
- **V3 (placebo neutral):** |placebo − nothing| ≤ 20pp in each price condition (forced).
- **V4 (abstain-allowed, both prices):** reported as is. A lift is claimed only if the buyers-only 80% lower bound is > 0; an all-sessions lift driven by declines is an unlock effect, not brand lift.

## Reporting rules

- Every number is reported as measured, including a null result. If V1 is not met, `/proof` and the docs say so and no pay-out numbers are claimed for this category.
- The derived money chain uses 50 exposed sales at Lumen's $295.99 and a $3,000 deposit (the purifiers' $1,000 deposit cannot cover 50 sales' commission on a $296 product). The deposit is a scripted choice, like the purifiers'.
- No session is dropped or re-run after seeing outcomes, except an infrastructure rerun of sessions that returned `invalid` from gateway errors, done before looking at outcomes and recorded in the summary.
- Raw results are committed unedited in `results/cited-robot-vacuum/results.jsonl`.
