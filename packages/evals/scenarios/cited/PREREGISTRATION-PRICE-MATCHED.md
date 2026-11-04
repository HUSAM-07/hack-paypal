# CITED price-matched eval: pre-registration

Written and committed before any session of this study ran. Follow-up to `PREREGISTRATION.md`, whose results (`results/cited/`) stay as they are.

## Why

In the first study every purchase was at Lumen, the cheapest shop, and Winix was cheaper than Levoit in every shop. Price decided most picks, so the Winix baseline was 69-76% and exposed agents hit a 100% ceiling. This study removes the price advantage so the test has to do the work.

## Setup

Identical to the first purifier study (same models `gpt-6-luna`, `gemini-3.8-flash`, `claude-sonnet-5-5`, temperature 0.7, same four buyer requests, same fixtures, same payload shape from `apps/catalogue-mcp`, same tools and system prompts) except Levoit's price:

- **parity:** Levoit Core 300 costs the same as Winix A230 in each shop (Northwind $99.99, Lumen $95.99, MegaMart $102.99). Shop prices are unchanged from the catalogue, so Lumen is still $4 cheaper than Northwind for both brands.
- **levoit-cheaper:** Levoit costs $4.00 less than Winix in each shop (Northwind $95.99, Lumen $91.99, MegaMart $98.99).

Ranking stays "price, then shop, then UPC", identical across arms. In parity, Winix sorts before Levoit at equal price and shop (UPC tie-break), so Winix is listed first: a position advantage that is the same in all arms and is disclosed, not removed.

- **Seed:** `20261106`.
- **Sample:** per price condition and variant (forced, abstain-allowed): per model 19 test / 18 placebo / 12 nothing = 147 sessions. 4 cells, 588 sessions.
- **Outcome, exclusions, statistic:** as in `PREREGISTRATION.md` (Winix purchase share over valid sessions; model-stratified lift and one-sided 80% lower bound from `packages/attribution`; abstain variant reported over all sessions and buyers-only).

## Hypotheses and thresholds

- **P1 (parity, forced):** pooled lift ≥ +15pp, 80% lower bound > 0, test − placebo > 0 in each model.
- **P2 (levoit-cheaper, forced):** 80% lower bound > 0 (the test beats a $4 price disadvantage). No size threshold.
- **P3 (placebo neutral):** |placebo − nothing| ≤ 20pp in each price condition (forced).
- **P4 (abstain-allowed, both prices):** reported as is. A lift is claimed only if the buyers-only 80% lower bound is > 0; an all-sessions lift driven by declines is reported as an unlock effect, not brand lift.

## Reporting rules

- The card's headline is **parity, forced**: it is the price-neutral comparison, and the demo keeps the shop-to-shop $4 gap (Lumen) while Winix and Levoit are priced alike. The first study (Winix cheaper) is reported next to it. If parity does not meet P1, the card says so and keeps the smaller real number.
- Every number goes to the card and packet as measured. Raw results are committed unedited in `results/cited-price-matched/results.jsonl`. No sessions dropped after seeing outcomes.
