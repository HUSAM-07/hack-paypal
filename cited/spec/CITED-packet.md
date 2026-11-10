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

**Try it.** Hosted: <https://pact-worker.vincent-wesley-liem.workers.dev> (`/console`, `/try`, `/mcp`). Local: `npm ci && npm run demo:cited` (13 beats, self-checking, no keys).

## (a2) Number provenance

| Kind | Numbers | Source |
|---|---|---|
| Measured, price-matched (headline) | 147 forced-buy sessions; Winix share 57/57, 3/54, 3/36; lift +94pp (GPT +89, Gemini +100, Sonnet +94), 80% lower bound +90.3pp; abstain allowed +82pp (bound +77.2pp) | `packages/evals/results/cited-price-matched/summary.md` |
| Measured, Winix already cheaper | 147 sessions, lift +24pp (bound +18.8pp); narrow verdict 81 sessions, bound −6.0pp, $0 | `packages/evals/results/cited/summary.md` |
| All evals | 963 sessions, three models, two pre-registrations | `packages/evals/scenarios/cited/PREREGISTRATION*.md` |
| Derived, first cycle (demo beats 1-10) | 57 exposed sales → 51 caused units → $391.64 credited; one refund voids $7.68; day 30: $383.96 paid to HouseFresh, $616.04 of Winix's $1,000 returned; Levoit $0, $1,000 returned | `npm run demo:cited`, `cited/spec/CITED-card.md` |
| Derived, later cycle (demo beats 11-13, not on the card) | AirLab joins; 12 co-exposed agents, 12/12 buy Winix; bound tightens 51 → 62 caused units over 69 exposed sales; one sale's $7.68 splits $3.84 / $3.84; dispute freezes 2 credits; day-60 batch HouseFresh $61.43, AirLab $15.36; after PayPal resolves for the seller, $3.84 + $3.84; programme to date $468.43 over 3 batches (HouseFresh $449.23, AirLab $19.20); 159 orders, $15,262.41 | `npm run demo:cited` |
| Scripted | Lumen's $4 discount, the $1,000 deposits, equal Winix and Levoit prices (Northwind $99.99, Lumen $95.99, MegaMart $102.99), Maya's $500 top-up, AirLab's test, the dispute and its outcome | demo seed |

Never mix the two cycles: $383.96 is the first payout; $468.43 is everything paid after the later cycle.

## (b) 3-minute video script

Base URL: `https://pact-worker.vincent-wesley-liem.workers.dev` (abbreviated `$B`). Record pages with `?clean=1` (hides the nav). Voice-over is about 440 words, about 150 words a minute: read briskly, or cut the `/try` beat.

| Time | On screen | Voice-over | Number shown |
|---|---|---|---|
| 0:00-0:15 | `$B/console/payout?clean=1` (PayPal payment notice, day-30 batch) | "HouseFresh just got paid $383.96 through PayPal. AI shopping agents read their purifier test and bought the winner. Nobody clicked a link." | $383.96 |
| 0:15-0:35 | `$B/#problem`, scroll to `$B/#how` | "Affiliate marketing pays per click, and agents never click. CITED is PayPal's affiliate network, rebuilt for agents: it pays on proven lift. Winix and Levoit each put $1,000 into a purifier programme. They fund the category, never a verdict, and each pays only for its own extra sales." | $1,000 + $1,000 |
| 0:35-1:05 | `$B/console?clean=1` (two agents side by side) | "Two agents get the same request: small bedroom purifier, light sleeper, around $100, just buy it. Same offers, same order. One is shown HouseFresh's test. It reads Northwind's offer, then pays Lumen, $4 cheaper, for the Winix. The other sees everything except the test, and buys the Levoit. No storefronts: each agent pays through PayPal itself, seller as payee, from a wallet the buyer linked once with Vault. A signed passport in the order's `custom_id` brings the sale back, even from a different shop." | $99.99 read, $95.99 paid |
| 1:05-1:20 | `$B/try`, press "Run the agent" | "You can run one yourself. Type a request at slash try and watch an agent shop and pay through PayPal." | live order total |
| 1:20-1:40 | `$B/#proof` (Fig. 1) | "Does the test actually cause sales? We pre-registered it: 147 agent sessions across GPT, Gemini and Sonnet, Winix and Levoit priced the same. Shown the test, agents chose Winix 57 times out of 57. Shown other HouseFresh content, 3 out of 54. That's +94 points; we pay on the cautious 80% lower bound, +90.3." | 57/57, 3/54, +94pp, +90.3pp |
| 1:40-2:05 | `$B/studio?clean=1` (Maya's brand view) [confirm after AG Studio PR] | "Maya runs Winix's brand. Her dashboard shows 51 extra Winix the test caused, $391.64 credited. A buyer returned one; Lumen refunded it through PayPal, and the webhook voided that $7.68 before it could pay. After the 30-day hold, $383.96 goes to HouseFresh in one Payouts batch, and $616.04 goes back to Winix. Levoit's sales didn't lift, so Levoit pays nothing." | 51, $391.64, −$7.68, $383.96, $616.04, Levoit $0 |
| 2:05-2:20 | `$B/studio?clean=1`, Analyst panel [confirm after AG Studio PR] | "Her Analyst agent asks AG Studio's built-in Data and Chart agents, charts the lift, and proposes: tests with a clear winner move agents 94 points; raise the purifier budget. Maya approves. Winix adds $500. Money buys honest tests, never a better spot." | +94, +$500 |
| 2:20-2:45 | `$B/studio/creator?clean=1` (Shapley split table) [confirm after AG Studio PR], then `$B/console/payout?clean=1&creator=airlab&batch=latest` | "A second creator, AirLab, tests purifiers too. Twelve agents see both tests and all twelve buy the Winix. More evidence tightens the bound: 62 caused units now. One sale's $7.68 splits by Shapley value, $3.84 each. Then that buyer opens a PayPal dispute: the credits freeze, skip the day-60 batch, and pay once PayPal rules for the seller. Programme to date: $468.43 paid, and the ledger matches PayPal to the cent." | 62 units, $3.84 + $3.84, $468.43 |
| 2:45-2:55 | `$B/mcp` (config snippets) | "And any agent can shop this way. Add our public MCP server to Claude or Cursor, buy a purifier, and see whether your sale would credit the creator." | — |
| 2:55-3:00 | `$B/` hero | "Agents read. Now the people they read get paid, through PayPal." | — |

### Recording notes

- The hosted demo must be seeded before recording (`reseed-hosted` workflow); `/console?clean=1` shows "No agent runs yet" when it is not.
- `/console/payout?clean=1` shows the first (day-30) batch; `&batch=latest` the last; `&creator=airlab` AirLab's.
- The three Studio beats follow the planned AG Studio build (Analyst = Agent Framework custom agent delegating to the built-in Data and Chart agents, Maya approves through an approval tool). Re-check URLs, wording and the on-screen numbers once that PR merges.
- If a beat runs long, cut the `/try` beat first (the description and README still cover it).
