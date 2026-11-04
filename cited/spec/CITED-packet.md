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

**PayPal APIs used.** Store Sync catalogue (our MCP server); Orders v2 (`purchase_units[].custom_id` Agent Affiliate Passport + `items[].upc`) and capture refunds; dispute webhooks void credits; multi-recipient Payouts to `PAYPAL_ID` (Shapley split across co-exposed affiliates).

Dashboards: AG Studio (including Master-Detail cross-store journey & Shapley split table). `eval/`: two pre-registered evals plus an abstain-allowed variant (375 sessions, three models).

```
cp .env.example .env        # PayPal sandbox + LLM keys (or PAYPAL_MODE=simulated)
npm install && npm run dev:cited
open http://localhost:3000  # Northwind (Shopify), Lumen (WooCommerce), MegaMart
```

## (a2) Number provenance

Measured: 147 / 81 / 147 sessions, Winix share 57/57, 41/54, 25/36, lift +24pp, bound +18.8pp, narrow bound −6.0pp, abstain-allowed lift +14pp (0 among buyers). Derived: 37 units, $284.13, $715.87. Scripted: Lumen's $4 discount, the 200 exposed sales, the $1,000 deposit, the Maya approval. Sources: `packages/evals/results/cited/summary.md`.

## (b) 3-minute demo script

**0:00-0:20 Hook.** A PayPal notification: $284.13 lands in HouseFresh's account. "HouseFresh tested two bedroom purifiers. AI agents read the test and bought dozens more of the winner. Nobody clicked a link."

**0:20-0:50 Money beat.** Winix and Levoit each join the purifier programme, and each pays only for its own extra sales. Neither tells HouseFresh what to say. Two agents get the same request: "Small bedroom purifier, light sleeper, around $100, just buy it." One is shown the test and buys the Winix. The other sees everything except the test and buys the Levoit. The order never changes. A buyer returns one Winix, and that commission disappears.

**0:50-1:20 PayPal-only moment.** The test appeared at Northwind, a Shopify shop. In our scripted run Lumen, a WooCommerce shop, was $4 cheaper, and the agent paid there. "Only PayPal runs an affiliate network, sees agent shopping, and pays creators. This is PayPal's affiliate network, rebuilt for agents."

**1:20-1:50 Proof.** "147 agent sessions. Agents shown the test chose the Winix 24 points more often than agents shown other content from the same creator, and every agent shown the test bought it. A close-verdict test moved nothing, and paid nothing. We also let agents decline to buy: there, the lift came from one model that only buys once it sees a test."

**1:50-2:40 AG Studio.** Maya, Winix's brand manager, sees "+37 extra Winix": only the sales the test caused. Winix pays $284.13 to HouseFresh; $715.87 returns. Levoit's sales didn't lift, so Levoit pays nothing. Her analyst agent, using the built-in Data and Chart agents, says: "Tests with a clear winner move agents 24 points; close verdicts pay nothing. Raise the purifier budget." Maya approves. Money buys honest tests, never a better spot. Like an affiliate link, it pays only when the product sells, but only for sales the test caused.

**2:40-3:00 Close.** "Agents read. Now the people they read get paid for what they prove, through PayPal."
