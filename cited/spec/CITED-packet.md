# CITED: judge-facing packet

The README intro, where every number comes from, and the 3-minute video script for the agent-checkout build (no storefronts: agents pay sellers through PayPal themselves, see [AGENT-CHECKOUT.md](AGENT-CHECKOUT.md)). The Devpost text is in [../DEVPOST.md](../DEVPOST.md).

## (a) README intro

# CITED
**PayPal's affiliate network, rebuilt for AI agents: it pays creators on proven lift, not last-click cookies.**

**Problem.** US affiliate spend ($13.81B/year, eMarketer) pays per click. AI shopping agents read creators' tests but never click. Meta's Muse sold on Vacuum Wars' tests, unpaid (Fast Company, 13 Oct 2026).

**Who.** US product-testing creators and the brands they review.

**What it does.** Agent Search Optimisation measurement, not ads.
- Brands fund a category programme (say, purifiers), never a verdict. Creators pick rivals and write verdicts.
- In PayPal's agent catalogue, sessions randomly get the test, a same-creator placebo, or nothing: 50/50 for a new test's first 7 days, then a permanent 5% holdout. Only the test is withheld; organic reviews remain; ranking never changes.
- No storefronts. Sellers sync their catalogues to PayPal; the agent checks out through PayPal itself (Orders v2, seller as payee, the buyer's Vault-linked wallet) with a signed Agent Affiliate Passport in `custom_id`, so the sale joins its arm even at a different seller.
- Creators earn 8% on units the test caused (cautious lower bound); $0 on no lift. Co-exposed creators split by Shapley value. Each brand pays only for its own lifted units, so an honest "buy the rival" verdict still earns.
- Only PayPal combines an affiliate network (Honey), the agent catalogue (Store Sync) and creator Payouts to PayPal/Venmo.

**Try it.** Hosted: <https://pact-worker.vincent-wesley-liem.workers.dev> (`/console`, `/proof`, `/studio`, `/try`, `/mcp`, `/creators`). Local: `npm ci && npm run demo:cited` (14 beats, self-checking, no keys).

## (a2) Number provenance

| Kind | Numbers | Source |
|---|---|---|
| Measured, price-matched (headline) | 147 forced-buy sessions; Winix share 57/57, 3/54, 3/36; lift +94pp (GPT +89, Gemini +100, Sonnet +94), 80% lower bound +90.3pp; abstain allowed +82pp (bound +77.2pp) | `packages/evals/results/cited-price-matched/summary.md` |
| Measured, Winix already cheaper | 147 sessions, lift +24pp (bound +18.8pp); narrow verdict 81 sessions, bound −6.0pp, $0 | `packages/evals/results/cited/summary.md` |
| All evals | 963 sessions, three models, two pre-registrations | `packages/evals/scenarios/cited/PREREGISTRATION*.md` |
| Derived, first cycle (demo beats 1-10) | 57 exposed sales → 51 caused units → $391.64 credited; one refund voids $7.68; day 30: $383.96 paid to HouseFresh, $616.04 of Winix's $1,000 returned; Levoit $0, $1,000 returned | `npm run demo:cited`, `cited/spec/CITED-card.md` |
| Derived, later cycle (demo beats 11-12, not on the card) | AirLab joins; 12 co-exposed agents, 12/12 buy Winix; bound tightens 51 → 62 caused units over 69 exposed sales; one sale's $7.68 splits $3.84 / $3.84; dispute freezes 2 credits; day-60 batch HouseFresh $61.43, AirLab $15.36; after PayPal resolves for the seller, $3.84 + $3.84; programme to date $468.43 over 3 batches (HouseFresh $449.23, AirLab $19.20) | `npm run demo:cited` |
| Derived, guard (demo beat 13, not on the card) | a co-conspirator's agent buys a Winix with HouseFresh's own PayPal: the session stays out of the study (62 units over 69 exposed sales, unchanged), its $7.68 credit is held for review (self-purchase) and is in no payout batch; 160 orders, $15,358.40 in all | `npm run demo:cited` |
| Real PayPal sandbox | the day-30 payout, $383.96 to a sandbox account standing in for HouseFresh: Payouts batch `ME2KV57B7KYNS`, status SUCCESS; Winix's statement for the same cycle through Invoicing v2: `INV2-TNXC-9GA6-W36V-WTF6`, $383.96 invoiced, MARKED_AS_PAID, $0 due. Everything else on the hosted demo runs on simulated PayPal | HUSAM-07/hack-paypal#84 (comments) |
| Scripted | Lumen's $4 discount, the $1,000 deposits, equal Winix and Levoit prices (Northwind $99.99, Lumen $95.99, MegaMart $102.99), Maya's $500 top-up, AirLab's test, the dispute and its outcome | demo seed |

Never mix the two cycles: $383.96 is the first payout; $468.43 is everything paid after the later cycle.

## (b) 3-minute video script

Base URL: `https://pact-worker.vincent-wesley-liem.workers.dev` (abbreviated `$B`). Record at 1920×1080 with `?clean=1` where given (hides the nav). Voice-over is about 410 spoken words, about 140 words a minute. Only the first cycle is on screen (51 caused units, $383.96 paid); the Shapley, dispute and self-purchase beats, which move totals to 62 caused units and $468.43 paid, are under "If time allows".

| Time | On screen | Voice-over | Number shown |
|---|---|---|---|
| 0:00-0:15 | `$B/console/payout?clean=1` (PayPal payment notice, day-30 batch) | "HouseFresh just got paid $383.96 through PayPal Payouts. AI shopping agents read their purifier test and bought the winner. Nobody clicked a link. We sent that exact batch on the real PayPal sandbox." | $383.96; caption: sandbox batch `ME2KV57B7KYNS`, SUCCESS |
| 0:15-0:35 | `$B/#problem`, scroll to `$B/#how` | "Affiliate marketing pays per click, and agents never click. CITED is PayPal's affiliate network, rebuilt for agents: it pays on proven lift. Winix and Levoit each put $1,000 into a purifier programme. They fund the category, never a verdict, and each pays only for its own extra sales." | $1,000 + $1,000 |
| 0:35-1:05 | `$B/console?clean=1` (two agents side by side) | "Two agents get the same request: small bedroom purifier, light sleeper, around $100, just buy it. Same offers, same order. One is shown HouseFresh's test: it reads Northwind's offer, then pays Lumen, $4 cheaper, for the Winix. The other sees everything except the test and buys the Levoit. There are no storefronts. Each agent pays through PayPal itself: Orders v2, the seller as payee, from a wallet the buyer linked once with Vault. A signed passport in the order's `custom_id` brings the sale back, even from a different seller." [confirm after Agent Toolkit PR: if checkout moves to the PayPal Agent Toolkit, say "through the PayPal Agent Toolkit"] | $99.99 read, $95.99 paid |
| 1:05-1:30 | `$B/proof` (Fig. 1, then Fig. 2) | "Does the test cause the sale? We pre-registered it: 147 sessions across GPT, Gemini and Sonnet, with the two purifiers priced the same. Shown the test, agents chose Winix 57 times out of 57. Shown other content from the same creator, 3 out of 54. That's +94 points, and we pay on the cautious 80% lower bound: +90.3." | 57/57, 3/54, +94pp, +90.3pp |
| 1:30-2:00 | `$B/studio?clean=1`, header toggle on **First payout** | "Maya runs the Winix brand. Her AG Studio dashboard shows 51 extra Winix sales the test caused, $391.64 credited. Then a buyer returns one. The seller refunds it through PayPal, and the refund webhook voids that $7.68 before it can ever be paid. After the 30-day hold, $383.96 goes to HouseFresh in one Payouts batch, and $616.04 goes back to Winix. Levoit's test didn't lift its sales, so Levoit pays nothing." | 51, $391.64, −$7.68, $383.96, $616.04, Levoit $0 |
| 2:00-2:40 | `$B/studio?clean=1`, Analyst chat: ask "Should we raise the purifier cap?"; expand "Drafted a cap top-up for Maya to approve"; press **Approve** | "Maya asks her Analyst, a custom agent built on AG Studio's Agent Framework. It reads the tables through Studio's built-in Data agent, adds a chart with the Page and Widget agents, and drafts a recommendation: tests with a clear winner move agents 94 points, so raise the purifier budget by $500. Nothing moves until Maya presses Approve. She does, and the deposit meter updates. Money buys honest tests, never a better spot." | +94, +$500, deposit $1,500 |
| 2:40-2:55 | `$B/mcp` (config snippets), cut to `$B/try` | "You can test it with your own agent. Add our public MCP server to Claude or Cursor, or run one at slash try, and buy a purifier through PayPal." | — |
| 2:55-3:00 | `$B/` hero | "Agents read. Now the people they read get paid, through PayPal." | — |

### If time allows (cut from the 3:00 cut, in priority order)

| Beat | On screen | Voice-over | Number shown |
|---|---|---|---|
| Self-dealing guard (demo beat 13) | `$B/studio?clean=1`, held-for-review panel with **Release** / **Void** | "A creator tries to buy through their own PayPal. The sale stays out of the study, and its credit is held for review: never paid automatically." | $7.68 held, 62 units unchanged |
| Statement (beat 9) | `$B/console/payout?clean=1`, click "Statement", `$B/console/statement?brand=winix&clean=1` | "At cycle close Winix gets a PayPal invoice for exactly what it paid, marked paid from its deposit." Sandbox: `INV2-TNXC-9GA6-W36V-WTF6` | $383.96 invoiced, $0 due |
| Shapley split (beat 11) | `$B/studio?clean=1` on **Programme to date**, expand a journey row; then `$B/studio/creator?clean=1&creator=airlab` | "A second creator, AirLab, tests purifiers too. Twelve agents see both tests; all twelve buy the Winix. The bound tightens to 62 caused units, and one sale's $7.68 splits by Shapley value, $3.84 each." | 62 units, $3.84 + $3.84 |
| Dispute (beat 12) | `$B/console/payout?clean=1&batch=latest` | "That buyer opens a PayPal dispute: the credits freeze, skip the day-60 batch, and pay once PayPal rules for the seller. Programme to date: $468.43 paid, and the ledger matches PayPal to the cent." | $468.43 |
| Creator onboarding | `$B/creators` | "Creators join with Log in with PayPal and publish a test; it enters the holdout schedule, 50/50 for 7 days, then 5%." | — |

### Recording notes

- Seed the hosted demo first (`reseed-hosted` workflow); `/console?clean=1` shows "No agent runs yet" when it is not.
- The Studio beats follow `cited/STUDIO.md`: open `/studio` on an empty engine, replay the demo with `--approve-in-studio --pace 4000` (needs `CITED_API_TOKEN`, since hosted writes are locked), toggle **First payout** at "Waiting for Maya to approve the top-up in AG Studio", ask the Analyst, press **Approve**. The refund void appears without a reload.
- The Analyst runs on a model only when the worker has `ANTHROPIC_API_KEY`; otherwise it runs scripted and says so on screen. Check which before recording.
- The hook's caption is the real sandbox batch (HUSAM-07/hack-paypal#84); say nothing that implies the rest of the hosted demo moves real sandbox money.
