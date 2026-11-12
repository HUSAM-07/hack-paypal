# CITED: the affiliate network for the AI-agent era

**Pitch:** Agents read but never click. CITED, affiliate marketing rebuilt on PayPal for agents, pays creators on proven lift, not clicks.

**Who + pain:** US product-testing creators. Affiliate ($13.81B, eMarketer) pays per click. On the open web, Muse sold on Vacuum Wars' tests: unprovable, unpaid (Fast Company, Oct 2026).

**What it does:** Agent Search Optimisation, not ads.
- Brands fund the purifier programme, never a verdict. Creators pick rivals and verdicts (HouseFresh: Winix A230 vs Levoit Core 300). Each brand pays only its own lifted units.
- Sessions get the test, a same-creator placebo (another HouseFresh article), or neither: 50/50 for 7 days, then a permanent 5% holdout. Only the test is withheld; ranking never changes. Held-out agents reading the test elsewhere only shrink measured lift, so pay is a floor.
- Credited units = exposed sales × (exposed − placebo rate) / exposed rate; 8% commission, $0 on no lift; Shapley splits co-exposure.

**PayPal APIs + unhappy paths:** Store Sync; no storefronts: the agent checks out through PayPal itself (Orders v2, seller as `payee`, buyer's Vault-linked wallet); real arm-checkout join via signed Agent Affiliate Passport in `purchase_units[].custom_id` + `items[].upc`. Deposits: Orders v2 capture; unspent: `captures/{id}/refund`. 30-day hold; void on `REFUNDED`/`PARTIALLY_REFUNDED`; a dispute webhook freezes the credit until PayPal decides (void if the buyer wins). Multi-recipient Payouts (`PAYPAL_ID`) split co-exposed sales across affiliates by Shapley value.

**Why PayPal-only:** Only PayPal combines brand affiliate contracts (Honey), an agent catalogue (Store Sync) and Payouts to PayPal/Venmo; Stripe has no affiliate business. Last-click credit can be overwritten; causal credit can't. The demo's exposed agent reads Northwind's offer and pays $4-cheaper Lumen; the passport still credits the test. PayPal earns network fees plus settlement.

**AI + depth:** Model-stratified attributable fraction, 80% lower bound.

**AG Studio:** Brand: arm strip, "+51 extra Winix", deposit meter, and an expandable **Cross-Store Journey & Shapley Split** AG Grid table; custom Analyst delegates to built-in Data, Page and Widget agents. Creator: pending, voided, paid, and co-exposure splits.

**60-second demo:**
1. Winix and Levoit fund the purifier programme.
2. Exposed agent buys Winix at Lumen; held-out buys Levoit.
3. A buyer returns one Winix and that pending credit is voided ($7.68). Day 30: $383.96 to HouseFresh, $616.04 of Winix's $1,000 returns; Levoit pays $0.
4. Analyst: "Clear-winner purifier tests move agents +94pp when the rival is priced alike; close verdicts pay $0. Raise the purifier cap." Maya approves.

**Evidence** (`packages/evals/results/cited*`, each pre-registered in `packages/evals/scenarios/cited`; GPT/Gemini/Sonnet):
- *Measured, price-matched (headline; Levoit priced like Winix at every shop):* purifiers, 147 forced-buy sessions, Winix share exposed 57/57 (100%), placebo 3/54 (6%), nothing 3/36 (8%). Lift +94pp (80% bound +90.3pp), positive in all three models (GPT +89, Gemini +100, Sonnet +94). Agents otherwise default to Levoit and flip when shown a test that names Winix, so this mostly measures deference to an explicit verdict. With Levoit $4 cheaper: +96pp (bound +92.6pp). Abstain allowed: +82pp (bound +77.2pp); among buyers +92pp (bound +86.3pp); Gemini declines more without the test.
- *Measured, Winix already cheaper (catalogue prices):* 147 sessions, share 100% / 76% / 69%, lift +24pp (bound +18.8pp), Sonnet 0 (it bought Winix anyway). Price decided most picks, so exposure had little to add. Abstain allowed: +14pp, but 0 among buyers (bound −4.2pp). Narrow verdict (81): lift 0, bound −6.0pp, $0; QuietMax won every arm on price, so this is weak evidence.
- *Derived:* 57 exposed sales (one per exposed agent) × 90.3% (90.3pp/100%) = 51 units × $95.99 × 8% = $391.64 credited; one refund voids one credit (−$7.68), so $383.96 is paid and $616.04 of the $1,000 deposit returns. (Winix-cheaper study: 37 units of 200 sales, $284.13.)
- *Scripted:* Lumen's $4 discount, the $1,000 deposit, equal Winix and Levoit prices.

**Closest:** Honey, impact.com pay per click; Comet Plus/ProRata per citation. None pays on randomised purchase holdouts.

**Biggest risk:** Brand bias, pay-to-rank. Money never buys rank (ACP) or verdicts; disclosed (16 CFR 255). Affiliate links pay only when the reviewed product sells; CITED is stricter: only test-caused sales pay, the placebo strips out reputation, and an honest buy-the-rival verdict earns when the rival funds. Funding buys measurement of which tests move agents.
