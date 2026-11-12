# CITED eval summary

Generated from `results.jsonl` by `src/cited/summarize.ts`. Pre-registration: `scenarios/cited/PREREGISTRATION-HEADPHONES.md`.

## headphones-parity-forced (147 sessions)

### headphones-parity-forced: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 10/18 | 6/12 | +44.4pp |
| gemini-3.8-flash | 19/19 | 8/18 | 6/12 | +55.6pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 57/57 (100%) | 18/54 (33%) | 12/36 (33%) | |

- Model-stratified lift: **+66.7pp** (SE +6.4pp), one-sided 80% lower bound **+61.2pp**.
- Placebo − nothing: +0.0pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

Derived chain (50 exposed sales at $345.99, $3,000 deposit): attributable fraction 61.2% (lower bound +61.2pp / exposed rate 100.0%), credited units **30**, commission **$830.37**, refund **$2169.63**.

## headphones-parity-abstain (147 sessions)

### headphones-parity-abstain: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 10/18 | 6/12 | +44.4pp |
| gemini-3.8-flash | 15/19 | 0/18 | 0/12 | +78.9pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 1/12 | +100.0pp |
| **pooled** | 53/57 (93%) | 10/54 (19%) | 7/36 (19%) | |

- Model-stratified lift: **+74.5pp** (SE +6.1pp), one-sided 80% lower bound **+69.3pp**.
- Placebo − nothing: -0.9pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

### headphones-parity-abstain: buyers only

Basis: declines dropped from the denominator. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 10/18 | 6/12 | +44.4pp |
| gemini-3.8-flash | 15/15 | 0/0 | 0/0 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 1/12 | +100.0pp |
| **pooled** | 53/53 (100%) | 10/36 (28%) | 7/24 (29%) | |

- Model-stratified lift: **+72.2pp** (SE +7.3pp), one-sided 80% lower bound **+66.1pp**.
- Placebo − nothing: -1.4pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

- Declines: 34/147 (test 4/57, placebo 18/54, none 12/36).

Derived chain (50 exposed sales at $345.99, $3,000 deposit): attributable fraction 74.6% (lower bound +69.3pp / exposed rate 93.0%), credited units **37**, commission **$1024.13**, refund **$1975.87**.

## headphones-rival-cheaper-forced (147 sessions)

### headphones-rival-cheaper-forced: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 9/18 | 6/12 | +50.0pp |
| gemini-3.8-flash | 19/19 | 0/18 | 1/12 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 57/57 (100%) | 9/54 (17%) | 7/36 (19%) | |

- Model-stratified lift: **+83.3pp** (SE +5.4pp), one-sided 80% lower bound **+78.8pp**.
- Placebo − nothing: -2.8pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

Derived chain (50 exposed sales at $345.99, $3,000 deposit): attributable fraction 78.8% (lower bound +78.8pp / exposed rate 100.0%), credited units **39**, commission **$1079.48**, refund **$1920.52**.

## headphones-rival-cheaper-abstain (147 sessions)

### headphones-rival-cheaper-abstain: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 9/18 | 6/12 | +50.0pp |
| gemini-3.8-flash | 15/19 | 0/18 | 0/12 | +78.9pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 53/57 (93%) | 9/54 (17%) | 6/36 (17%) | |

- Model-stratified lift: **+76.3pp** (SE +6.1pp), one-sided 80% lower bound **+71.2pp**.
- Placebo − nothing: +0.0pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

### headphones-rival-cheaper-abstain: buyers only

Basis: declines dropped from the denominator. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 9/18 | 6/12 | +50.0pp |
| gemini-3.8-flash | 15/15 | 0/15 | 0/1 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 53/53 (100%) | 9/51 (18%) | 6/25 (24%) | |

- Model-stratified lift: **+82.2pp** (SE +5.8pp), one-sided 80% lower bound **+77.4pp**.
- Placebo − nothing: -6.4pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

- Declines: 18/147 (test 4/57, placebo 3/54, none 11/36).

Derived chain (50 exposed sales at $345.99, $3,000 deposit): attributable fraction 76.6% (lower bound +71.2pp / exposed rate 93.0%), credited units **38**, commission **$1051.80**, refund **$1948.20**.

