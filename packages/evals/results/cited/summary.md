# CITED eval summary

Generated from `results.jsonl` by `src/cited/summarize.ts`. Pre-registration: `scenarios/cited/PREREGISTRATION.md`.

## purifier-forced (147 sessions)

### purifier-forced: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 13/18 | 7/12 | +27.8pp |
| gemini-3.8-flash | 19/19 | 10/18 | 7/12 | +44.4pp |
| claude-sonnet-5-5 | 19/19 | 18/18 | 11/12 | +0.0pp |
| **pooled** | 57/57 (100%) | 41/54 (76%) | 25/36 (69%) | |

- Model-stratified lift: **+24.1pp** (SE +6.3pp), one-sided 80% lower bound **+18.8pp**.
- Placebo − nothing: +6.5pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

Derived chain (200 exposed sales at $95.99, $1,000 deposit): attributable fraction 18.8% (lower bound +18.8pp / exposed rate 100.0%), credited units **37**, commission **$284.13**, refund **$715.87**.

## purifier-abstain (147 sessions)

### purifier-abstain: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 18/18 | 9/12 | +0.0pp |
| gemini-3.8-flash | 8/19 | 0/18 | 0/12 | +42.1pp |
| claude-sonnet-5-5 | 19/19 | 18/18 | 10/12 | +0.0pp |
| **pooled** | 46/57 (81%) | 36/54 (67%) | 19/36 (53%) | |

- Model-stratified lift: **+14.0pp** (SE +5.3pp), one-sided 80% lower bound **+9.5pp**.
- Placebo − nothing: +13.9pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

### purifier-abstain: buyers only

Basis: declines dropped from the denominator. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 18/18 | 9/11 | +0.0pp |
| gemini-3.8-flash | 8/8 | 0/0 | 0/0 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 18/18 | 10/12 | +0.0pp |
| **pooled** | 46/46 (100%) | 36/36 (100%) | 19/23 (83%) | |

- Model-stratified lift: **+0.0pp** (SE +5.0pp), one-sided 80% lower bound **-4.2pp**.
- Placebo − nothing: +17.4pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

- Declines: 42/147 (test 11/57, placebo 18/54, none 13/36).

Derived chain (200 exposed sales at $95.99, $1,000 deposit): attributable fraction 11.8% (lower bound +9.5pp / exposed rate 80.7%), credited units **23**, commission **$176.62**, refund **$823.38**.

## narrow-forced (81 sessions)

### narrow-forced: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 10/10 | 10/10 | 7/7 | +0.0pp |
| gemini-3.8-flash | 10/10 | 10/10 | 7/7 | +0.0pp |
| claude-sonnet-5-5 | 10/10 | 10/10 | 7/7 | +0.0pp |
| **pooled** | 30/30 (100%) | 30/30 (100%) | 21/21 (100%) | |

- Model-stratified lift: **+0.0pp** (SE +7.1pp), one-sided 80% lower bound **-6.0pp**.
- Placebo − nothing: +0.0pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

Derived chain (200 exposed sales at $92.99, $1,000 deposit): attributable fraction 0.0% (lower bound -6.0pp / exposed rate 100.0%), credited units **0**, commission **$0.00**, refund **$1000.00**.

