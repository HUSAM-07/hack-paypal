# CITED: the affiliate network for the AI-agent era

**Pitch:** Agents read but never click. CITED, PayPal's affiliate network for agents, pays creators on proven lift, not clicks.

**Who + pain:** US product-testing creators. Affiliate ($13.81B, eMarketer) pays per click. On the open web, Muse sold on Vacuum Wars' tests: unprovable, unpaid (Fast Company, Oct 2026).

**What it does:** Agent Search Optimisation, not ads.
- Brands fund the purifier programme, never a verdict. Creators pick rivals and verdicts (HouseFresh: Winix A230 vs Levoit Core 300). Each brand pays only its own lifted units.
- Sessions get the test, a same-creator placebo (another HouseFresh article), or neither: 50/50 for 7 days, then a permanent 5% holdout. Only the test is withheld; ranking never changes. Held-out agents reading the test elsewhere only shrink measured lift, so pay is a floor.
- Credited units = exposed sales × (exposed − placebo rate) / exposed rate; 8% commission, $0 on no lift; Shapley splits co-exposure.

**PayPal APIs + unhappy paths:** Store Sync; real arm-checkout join via signed Agent Affiliate Passport in Orders v2 `purchase_units[].custom_id` + `items[].upc`. Deposits: Orders v2 capture; unspent: `captures/{id}/refund`. 30-day hold; void on `REFUNDED`/`PARTIALLY_REFUNDED` or dispute webhook. Multi-recipient Payouts (`PAYPAL_ID`) split co-exposed sales across affiliates by Shapley value.

**Why PayPal-only:** Only PayPal combines brand affiliate contracts (Honey), an agent catalogue (Store Sync) and Payouts to PayPal/Venmo; Stripe has no affiliate business. Last-click credit can be overwritten; causal credit can't. 22/22 exposed Winix buys settled at $4-cheaper Lumen (WooCommerce), not Northwind (Shopify). PayPal earns network fees plus settlement.

**AI + depth:** Model-stratified attributable fraction, 80% lower bound.

**AG Studio:** Brand: arm strip, "+102 extra Winix", deposit meter, and an expandable **Cross-Store Journey & Shapley Split** AG Grid table; custom Analyst delegates to built-in Data and Chart agents. Creator: pending, voided, paid, and co-exposure splits.

**60-second demo:**
1. Winix and Levoit fund the purifier programme.
2. Exposed agent buys Winix at Lumen; held-out buys Levoit.
3. Day 30: $783.28 to HouseFresh, $216.72 of Winix's $1,000 returns; Levoit pays $0. A refund voids one credit.
4. Analyst: "Clear-winner purifier tests move agents +44pp; close verdicts pay $0. Raise the purifier cap." Maya approves.

**Evidence:**
- *Measured* (pre-registered, GPT/Gemini/Sonnet): purifiers, 146 sessions, Winix share exposed 41/56 (73%), placebo 16/54, nothing 11/36. Lift +44pp (80% bound +37.5pp), positive per model. Narrow verdict (80 sessions): bound −3.6pp, $0.
- *Derived:* 200 exposed sales × 51% (37.5pp/73%) = 102 units × $95.99 × 8% = $783.28.
- *Scripted:* Lumen's price.

**Closest:** Honey, impact.com pay per click; Comet Plus/ProRata per citation. None pays on randomised purchase holdouts.

**Biggest risk:** Brand bias, pay-to-rank. Money never buys rank (ACP) or verdicts; disclosed (16 CFR 255). Affiliate links pay only when the reviewed product sells; CITED is stricter: only test-caused sales pay, the placebo strips out reputation, and an honest buy-the-rival verdict earns when the rival funds. Funding buys measurement of which tests move agents.
