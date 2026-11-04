# CITED eval summary

Generated from `results.jsonl` by `src/cited/summarize.ts`. Pre-registration: `scenarios/cited/PREREGISTRATION-PRICE-MATCHED.md`.

## purifier-parity-forced (147 sessions)

### purifier-parity-forced: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 2/18 | 3/12 | +88.9pp |
| gemini-3.8-flash | 19/19 | 0/18 | 0/12 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 1/18 | 0/12 | +94.4pp |
| **pooled** | 57/57 (100%) | 3/54 (6%) | 3/36 (8%) | |

- Model-stratified lift: **+94.4pp** (SE +4.9pp), one-sided 80% lower bound **+90.3pp**.
- Placebo − nothing: -2.8pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

Derived chain (50 exposed sales at $95.99, $1,000 deposit): attributable fraction 90.3% (lower bound +90.3pp / exposed rate 100.0%), credited units **45**, commission **$345.56**, refund **$654.44**.

## purifier-parity-abstain (147 sessions)

### purifier-parity-abstain: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 3/18 | 3/12 | +83.3pp |
| gemini-3.8-flash | 12/19 | 0/18 | 0/12 | +63.2pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 50/57 (88%) | 3/54 (6%) | 3/36 (8%) | |

- Model-stratified lift: **+82.2pp** (SE +5.9pp), one-sided 80% lower bound **+77.2pp**.
- Placebo − nothing: -2.8pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

### purifier-parity-abstain: buyers only

Basis: declines dropped from the denominator. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 3/18 | 3/12 | +83.3pp |
| gemini-3.8-flash | 12/12 | 0/0 | 0/0 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 50/50 (100%) | 3/36 (8%) | 3/24 (13%) | |

- Model-stratified lift: **+91.7pp** (SE +6.4pp), one-sided 80% lower bound **+86.3pp**.
- Placebo − nothing: -4.2pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

- Declines: 37/147 (test 7/57, placebo 18/54, none 12/36).

Derived chain (50 exposed sales at $95.99, $1,000 deposit): attributable fraction 88.0% (lower bound +77.2pp / exposed rate 87.7%), credited units **44**, commission **$337.88**, refund **$662.12**.

## purifier-levoit-cheaper-forced (147 sessions)

### purifier-levoit-cheaper-forced: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 0/18 | 0/12 | +100.0pp |
| gemini-3.8-flash | 17/19 | 0/18 | 0/12 | +89.5pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 55/57 (96%) | 0/54 (0%) | 0/36 (0%) | |

- Model-stratified lift: **+96.5pp** (SE +4.6pp), one-sided 80% lower bound **+92.6pp**.
- Placebo − nothing: +0.0pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

Derived chain (50 exposed sales at $95.99, $1,000 deposit): attributable fraction 96.0% (lower bound +92.6pp / exposed rate 96.5%), credited units **47**, commission **$360.92**, refund **$639.08**.

## purifier-levoit-cheaper-abstain (147 sessions)

### purifier-levoit-cheaper-abstain: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 1/18 | 3/12 | +94.4pp |
| gemini-3.8-flash | 3/19 | 0/18 | 0/12 | +15.8pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 41/57 (72%) | 1/54 (2%) | 3/36 (8%) | |

- Model-stratified lift: **+70.1pp** (SE +5.1pp), one-sided 80% lower bound **+65.8pp**.
- Placebo − nothing: -6.5pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

### purifier-levoit-cheaper-abstain: buyers only

Basis: declines dropped from the denominator. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 1/18 | 3/12 | +94.4pp |
| gemini-3.8-flash | 3/3 | 0/17 | 0/12 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 41/41 (100%) | 1/53 (2%) | 3/36 (8%) | |

- Model-stratified lift: **+97.6pp** (SE +5.7pp), one-sided 80% lower bound **+92.8pp**.
- Placebo − nothing: -6.4pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

- Declines: 17/147 (test 16/57, placebo 1/54, none 0/36).

Derived chain (50 exposed sales at $95.99, $1,000 deposit): attributable fraction 91.5% (lower bound +65.8pp / exposed rate 71.9%), credited units **45**, commission **$345.56**, refund **$654.44**.

