# CITED eval: pre-registration

Written and committed before any session of this re-run was executed. Task: GitHub issue #20.

## Question

Do AI shopping agents shown a creator's test buy the tested brand more often than agents shown other content from the same creator (the placebo)? How much of that holds when agents may decline to buy? Does a close, verdict-less test move purchases?

## Setup

- **Agents:** three models through an OpenAI-compatible gateway, temperature 0.7: `gpt-6-luna` (GPT), `gemini-3.8-flash` (Gemini), `claude-sonnet-5-5` (Sonnet). Chosen as the current GPT, Gemini and Sonnet ids on the gateway on 2026-11-05. The earlier runs used `gpt-5.6-luna` and `gemini-3.5-flash`, so these are new models, not a replication of the same ones.
- **What the agent sees:** a buyer request (four wordings, `INTENTS` in `src/cited/world.ts`) plus the exact payload shape `search_product` returns in `apps/catalogue-mcp`: `{ listings, creatorContent, passport }`. Purifier-study listings and ranking come from `searchListings`; arm content from `creatorContent`. Ranking is identical in every arm (listings never see the arm).
- **Content:** our own fixtures only (`packages/protocol/fixtures/`): the HouseFresh Winix A230 vs Levoit Core 300 test, the HouseFresh humidifier article (placebo), the HouseFresh QuietMax vs Breezeline close test (narrow study). No scraped review text.
- **Tool:** `create_paypal_order(shopId, upc, unit_amount, passport, reason_for_buyer)`. Forced variant: the system prompt says to buy exactly one item. Abstain variant: a second tool `decline_to_buy(reason)` exists and the system prompt allows declining.
- **Arms:** `test`, `placebo`, `none`, assigned by a seeded plan, balanced per model.
- **Seed:** `20261105` (mulberry32; plan, intent rotation and shuffle all derive from it). Temperature sampling is not seeded, so a re-run reproduces the design, not the exact outputs.
- **Outcome:** the session bought the target brand (Winix in the purifier study, QuietMax in the narrow study). A tool call that fails to parse, names an unknown listing, or returns no tool call is retried up to 3 times; a session still failing is `invalid` and excluded from all rates, and the count is reported. Price mismatches are recorded and kept.

## Studies and sample sizes (sessions per model and arm: test / placebo / none)

| Study | Variant | Per model | Total |
|---|---|---|---|
| purifier | forced | 19 / 18 / 12 | 147 |
| purifier | abstain-allowed | 19 / 18 / 12 | 147 |
| narrow verdict | forced | 10 / 10 / 7 | 81 |

The card's "146" and "80" are the earlier counts; these are the nearest balanced designs.

## Statistic

Model-stratified lift and one-sided 80% lower bound from `computeLift` in `packages/attribution`: lift = pooled (test − placebo) purchase rate, lower bound = lift − 0.8416 × SE. Denominator for every rate is all valid sessions; in the abstain variant a decline counts as not buying the target. A buyers-only denominator is reported as a secondary view. Derived numbers use `creditBrand` with 200 exposed sales at $95.99 and a $1,000 deposit.

## Hypotheses and thresholds

- **H1 (purifier, forced):** pooled lift ≥ +15pp, 80% lower bound > 0, and test − placebo > 0 in each of the three models.
- **H2 (narrow verdict, forced):** the 80% lower bound is ≤ 0, so credited units are 0 and the commission is $0.
- **H3 (placebo is neutral):** |placebo − nothing| ≤ 20pp in the purifier study.
- **H4 (purifier, abstain-allowed):** same test as H1. No pass threshold is claimed: an earlier abstain-allowed run (13/26 vs 12/25) showed about zero lift, and whatever this run shows is reported as is.

## Reporting rules

- Every number goes to the card and packet as measured, even if smaller than the current +44pp. A failed hypothesis is stated as failed.
- The headline lift in the card is the forced purifier study (agents that must check out). The abstain-allowed result is reported next to it in the card's Evidence. If the abstain lower bound is ≤ 0, the card says so plainly.
- No session is dropped or re-run after seeing results, except an infrastructure rerun of sessions that returned `invalid` because of gateway errors, done before looking at outcomes and recorded in the summary.
- Raw results (`results/cited/results.jsonl`) are committed unedited.
