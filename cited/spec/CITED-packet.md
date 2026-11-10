# CITED: judge-facing packet

## (a) README intro

# CITED
**PayPal's affiliate network, rebuilt for AI agents: it pays creators on proven lift, not last-click cookies.**

**Problem.** US affiliate spend ($13.81B/year, eMarketer) pays per click. AI shopping agents read creators' tests but never click. Meta's Muse sold on Vacuum Wars' tests, unpaid (Fast Company, 13 Oct 2026).

**Who.** US product-testing creators and the brands they review.

**What it does.** Agent Search Optimisation measurement, not ads.
- Brands fund a category programme (say, purifiers), never a verdict. Creators pick rivals and write verdicts.
- In PayPal's agent catalogue, sessions randomly get the test, a same-creator placebo, or nothing: 50/50 for a new test's first 7 days, then a permanent 5% holdout. Only the test is withheld; organic reviews remain; ranking never changes. Agents reading the test elsewhere only shrink measured lift, so pay is a conservative floor.
- Creators earn 8% on units the test caused (cautious lower bound); $0 on no lift. Each brand pays only for its own lifted units, so an honest "buy the rival" verdict still earns. Like affiliate links, but only test-caused sales pay.
- Only PayPal combines an affiliate network (Honey), the agent catalogue (Store Sync) and creator Payouts to PayPal/Venmo. PayPal earns a network fee plus settlement volume.

**PayPal APIs used.** Store Sync catalogue (our MCP server); Orders v2 (`purchase_units[].custom_id` Agent Affiliate Passport + `items[].upc`) and capture refunds; dispute webhooks freeze credits until PayPal decides (void if the buyer wins); multi-recipient Payouts to `PAYPAL_ID` (Shapley split across co-exposed affiliates).

Dashboards: AG Studio (including Master-Detail cross-store journey & Shapley split table). `eval/`: two pre-registered evals plus an abstain-allowed variant (963 sessions, three models).

```
cp .env.example .env        # PayPal sandbox + LLM keys (or PAYPAL_MODE=simulated)
npm install && npm run dev:cited
open http://localhost:3000  # Northwind (Shopify), Lumen (WooCommerce), MegaMart
```

## (a2) Number provenance

Measured, price-matched headline: 147 sessions, Winix share 57/57, 3/54, 3/36, lift +94pp, bound +90.3pp (abstain-allowed +82pp; buyers only +92pp). Measured, Winix cheaper: 147 sessions, 57/57, 41/54, 25/36, lift +24pp, bound +18.8pp; narrow verdict 81 sessions, bound −6.0pp, $0. Derived: 57 exposed sales → 51 units, $391.64 credited; one refund voids one credit (−$7.68), $383.96 paid, $616.04 returned. Scripted: Lumen's $4 discount, the $1,000 deposit, equal Winix and Levoit prices, the Maya approval. Later cycle (demo outputs from `npm run demo:cited`, not on the card, never mixed into the numbers above): AirLab joins with its own purifier test; 12 agents see both tests and buy the Winix; the bound tightens, 51 → 62 caused units; one co-exposed sale's $7.68 splits HouseFresh $3.84, AirLab $3.84 by Shapley; that sale's buyer disputes it, so its credits freeze at day 60 (batch: HouseFresh $61.43, AirLab $15.36) and are paid ($3.84 + $3.84) once PayPal resolves for the seller. Sources: `packages/evals/results/cited/summary.md`, `packages/evals/results/cited-price-matched/summary.md`.

**Demo prices (to match the headline study):** Levoit Core 300 priced the same as Winix A230 in every shop: Northwind $99.99, Lumen $95.99, MegaMart $102.99. Today `apps/catalogue-mcp/src/listings.ts` lists Levoit at $109.99 / $107.99 / $112.99 and must change (the shops and any demo seed too). Lumen stays $4 cheaper than Northwind for both brands, so the cross-shop moment is unchanged.

## (b) 3-minute demo script

**0:00-0:20 Hook.** A PayPal notification: $383.96 lands in HouseFresh's account. "HouseFresh tested two bedroom purifiers. AI agents read the test and bought dozens more of the winner. Nobody clicked a link."

**0:20-0:50 Money beat.** Winix and Levoit each join the purifier programme, and each pays only for its own extra sales. Neither tells HouseFresh what to say. Two agents get the same request: "Small bedroom purifier, light sleeper, around $100, just buy it." One is shown the test and buys the Winix. The other sees everything except the test and buys the Levoit. The order never changes. A buyer returns one Winix, and that commission disappears.

**0:50-1:20 PayPal-only moment.** The test appeared at Northwind, a Shopify shop. In our scripted run Lumen, a WooCommerce shop, was $4 cheaper, and the agent paid there. "Only PayPal runs an affiliate network, sees agent shopping, and pays creators. This is PayPal's affiliate network, rebuilt for agents."

**1:20-1:50 Proof.** "147 agent sessions, Winix and Levoit priced the same. Agents shown the test chose the Winix 94 points more often than agents shown other content from the same creator. When the Winix was already the cheaper one, the lift was a smaller 24 points. A close-verdict test moved nothing, and paid nothing."

**1:50-2:40 AG Studio.** Maya, Winix's brand manager, sees "+51 extra Winix": only the sales the test caused. Winix credits $391.64, one refunded sale voids $7.68, and Winix pays $383.96 to HouseFresh; $616.04 returns. Levoit's sales didn't lift, so Levoit pays nothing. Her analyst agent, using the built-in Data and Chart agents, says: "Tests with a clear winner move agents 94 points; close verdicts pay nothing. Raise the purifier budget." Maya approves. Money buys honest tests, never a better spot. Like an affiliate link, it pays only when the product sells, but only for sales the test caused.

**2:40-3:00 Close.** "Agents read. Now the people they read get paid for what they prove, through PayPal."
