# CITED eval summary

Generated from `results.jsonl` by `src/cited/summarize.ts`. Pre-registration: `scenarios/cited/PREREGISTRATION-ROBOT-VACUUM.md`.

## vacuum-parity-forced (147 sessions)

### vacuum-parity-forced: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 12/18 | 7/12 | +33.3pp |
| gemini-3.8-flash | 19/19 | 15/18 | 12/12 | +16.7pp |
| claude-sonnet-5-5 | 19/19 | 18/18 | 12/12 | +0.0pp |
| **pooled** | 57/57 (100%) | 45/54 (83%) | 31/36 (86%) | |

- Model-stratified lift: **+16.7pp** (SE +5.9pp), one-sided 80% lower bound **+11.7pp**.
- Placebo − nothing: -2.8pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

Derived chain (50 exposed sales at $295.99, $3,000 deposit): attributable fraction 11.7% (lower bound +11.7pp / exposed rate 100.0%), credited units **5**, commission **$118.39**, refund **$2881.61**.

## vacuum-parity-abstain (147 sessions)

### vacuum-parity-abstain: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 10/18 | 6/12 | +44.4pp |
| gemini-3.8-flash | 19/19 | 0/18 | 0/12 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 18/18 | 12/12 | +0.0pp |
| **pooled** | 57/57 (100%) | 28/54 (52%) | 18/36 (50%) | |

- Model-stratified lift: **+48.1pp** (SE +5.4pp), one-sided 80% lower bound **+43.6pp**.
- Placebo − nothing: +1.9pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

### vacuum-parity-abstain: buyers only

Basis: declines dropped from the denominator. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 10/18 | 6/11 | +44.4pp |
| gemini-3.8-flash | 19/19 | 0/0 | 0/0 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 18/18 | 12/12 | +0.0pp |
| **pooled** | 57/57 (100%) | 28/36 (78%) | 18/23 (78%) | |

- Model-stratified lift: **+22.2pp** (SE +7.3pp), one-sided 80% lower bound **+16.1pp**.
- Placebo − nothing: -0.5pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

- Declines: 31/147 (test 0/57, placebo 18/54, none 13/36).

Derived chain (50 exposed sales at $295.99, $3,000 deposit): attributable fraction 43.6% (lower bound +43.6pp / exposed rate 100.0%), credited units **21**, commission **$497.26**, refund **$2502.74**.

## vacuum-rival-cheaper-forced (147 sessions)

### vacuum-rival-cheaper-forced: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 19/19 | 8/18 | 5/12 | +55.6pp |
| gemini-3.8-flash | 19/19 | 4/18 | 5/12 | +77.8pp |
| claude-sonnet-5-5 | 19/19 | 2/18 | 1/12 | +88.9pp |
| **pooled** | 57/57 (100%) | 14/54 (26%) | 11/36 (31%) | |

- Model-stratified lift: **+74.1pp** (SE +6.5pp), one-sided 80% lower bound **+68.6pp**.
- Placebo − nothing: -4.6pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

Derived chain (50 exposed sales at $295.99, $3,000 deposit): attributable fraction 68.6% (lower bound +68.6pp / exposed rate 100.0%), credited units **34**, commission **$805.09**, refund **$2194.91**.

## vacuum-rival-cheaper-abstain (147 sessions)

### vacuum-rival-cheaper-abstain: all valid sessions in the denominator

Basis: declines count as not buying the target. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 18/19 | 6/18 | 5/12 | +61.4pp |
| gemini-3.8-flash | 9/19 | 0/18 | 0/12 | +47.4pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 46/57 (81%) | 6/54 (11%) | 5/36 (14%) | |

- Model-stratified lift: **+69.6pp** (SE +6.5pp), one-sided 80% lower bound **+64.1pp**.
- Placebo − nothing: -2.8pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

### vacuum-rival-cheaper-abstain: buyers only

Basis: declines dropped from the denominator. Target-brand purchases / denominator.

| model | test | placebo | nothing | lift (test − placebo) |
|---|---|---|---|---|
| gpt-6-luna | 18/18 | 6/18 | 5/12 | +66.7pp |
| gemini-3.8-flash | 9/9 | 0/12 | 0/1 | +100.0pp |
| claude-sonnet-5-5 | 19/19 | 0/18 | 0/12 | +100.0pp |
| **pooled** | 46/46 (100%) | 6/48 (13%) | 5/25 (20%) | |

- Model-stratified lift: **+87.2pp** (SE +6.1pp), one-sided 80% lower bound **+82.0pp**.
- Placebo − nothing: -7.5pp. Invalid sessions excluded: 0. Price mismatches (kept): 0.

- Declines: 28/147 (test 11/57, placebo 6/54, none 11/36).

Derived chain (50 exposed sales at $295.99, $3,000 deposit): attributable fraction 79.5% (lower bound +64.1pp / exposed rate 80.7%), credited units **39**, commission **$923.48**, refund **$2076.52**.

