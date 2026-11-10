# CITED: build plan

Locked card: [`CITED-card.md`](CITED-card.md). Judge packet (README intro and video script): [`CITED-packet.md`](CITED-packet.md). Task breakdown: [`../WORKBOARD.md`](../WORKBOARD.md).

## Dates
- **Today:** Mon 26 Oct.
- **Feature freeze:** Mon 9 Nov.
- **Video:** Tue 10 Nov.
- **Submit:** Wed 11 Nov. The hard deadline is Thu 12 Nov, 12:00 PT.
- That leaves 2 build weeks.

## Stack (decided 5 Nov)

TypeScript throughout, in this monorepo, reusing the placeholder's `packages/protocol`, `packages/paypal` and `packages/evals`. Cloudflare Workers + D1 for the engine. One command: `npm run dev:cited`. See [`../../CLAUDE.md`](../../CLAUDE.md) for the layout. This replaces the earlier Go + docker compose plan.

## What gets built

| # | Component | What it does | Owner |
|---|---|---|---|
| 1 | **Catalogue MCP server** (mock Store Sync) | `search_product` returns listings across 3 shops. It attaches HouseFresh's test (plus co-exposed Creator B / AirLab), the placebo article, or nothing, per session arm, and issues a signed **Agent Affiliate Passport** (`session_id`, `arm`, `creators_seen`, `stores_viewed`). The schedule is 50/50 for 7 days, then a 5% holdout. Ranking is identical across arms. | Agents/MCP |
| 2 | **Shopper agents** | GPT, Gemini and Sonnet agents (via an OpenAI-compatible LLM gateway) get a buyer request, call the catalogue, carry their Agent Affiliate Passport across shops, and check out at the shop they choose. | Agents/MCP |
| 3 | **3 mock shops** | Northwind (Shopify-style), Lumen (WooCommerce-style) and MegaMart, each with PayPal checkout. Lumen is $4 cheaper on Winix. Checkout stamps the Agent Affiliate Passport into PayPal Orders v2 `purchase_units[].custom_id`. | Full-stack |
| 4 | **Attribution engine** (`packages/attribution` + `apps/engine`) | Joins each arm to its checkout in real time via PayPal `custom_id` and `items[].upc` (no mocked join). Computes the attributable fraction per model at the 80% lower bound. Splits co-exposed sales across multiple affiliates (HouseFresh + AirLab) by Shapley value. Runs a credit ledger with a 30-day hold, using a demo time-travel clock. Refund webhooks void credits; dispute webhooks freeze them until PayPal resolves the dispute (void if the buyer wins). | Fintech |
| 5 | **PayPal money flows** | Brand deposit = Orders v2 capture. Creator payout = multi-recipient batch Payouts to `PAYPAL_ID` (splitting commission across co-exposed affiliates). Unspent deposit = `captures/{id}/refund`. Webhooks: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.REFUNDED` and disputes. | Fintech |
| 6 | **AG Studio dashboards** | The brand view has 3 bespoke widgets: an arm strip, a "+51 extra Winix" tile and a deposit meter. The creator view shows pending, voided and paid credits. **Affiliate Journey & Shapley Split view (AG Grid Master-Detail):** expandable PayPal order rows showing cross-store price hops (Northwind $99.99 → Lumen $95.99), co-exposed affiliates read, and exact Shapley payout splits. A custom **Analyst agent** delegates to the built-in Data and Chart agents. | Full-stack |
| 7 | **`eval/`** | Re-runs the 2 pre-registered evals in-repo: 147 purifier sessions, 81 narrow-verdict sessions and a 147-session abstain-allowed variant, plus a 588-session price-matched study, across 3 models (results in `packages/evals/results/cited*`). The headline is price-matched. These are the "Measured" numbers on the card. | Agents/MCP |

## Affiliate Passport & Multi-Creator Split Spec (Owner: You)

| Piece | What gets built | How it works |
|---|---|---|
| **1. Agent Affiliate Passport** | Signed session token replacing affiliate cookies | `search_product` issues `sess_id\|arm\|creators_seen\|stores_viewed` when a bot queries the catalogue. |
| **2. Real PayPal Arm-Checkout Join** | Live link from catalogue session to PayPal receipt | Mock stores pass the passport inside `POST /v2/checkout/orders` → `purchase_units[0].custom_id`. When PayPal captures the order (even at a cheaper store like Lumen), the webhook/capture handler reads `custom_id` + `items[].upc` to join the sale to the exact bot arm. |
| **3. Multi-Affiliate Shapley Splitter** | Fair commission split when a bot reads 2+ affiliates | Computes marginal lift for Creator A alone (HouseFresh), Creator B alone (AirLab), and A+B co-exposed. Splits the 8% commission proportionally and sends one batch `POST /v1/payments/payouts` call paying both affiliates' PayPal accounts. |
| **4. AG Grid Journey & Split Table** | Master-Detail table of cross-store bot checkouts | Top row shows PayPal Order ID, Store Chosen, Price Saved ($4 at Lumen), Total Commission, and 30-Day Hold status. Expanding a row shows the bot's store-hop timeline and the per-affiliate Shapley payout breakdown. |

## Week 1 (27 Oct – 2 Nov): get every piece working alone

1. **Day 1:** repo skeleton and `npm run dev:cited`. Get the PayPal sandbox app and AG Studio trial set up (you do both).
2. **Days 1–3:** catalogue MCP server and shopper agents. One agent buys end to end in sandbox.
3. **Days 1–3:** attribution engine maths with unit tests (fraction, lower bound, Shapley, voids).
4. **Days 2–4:** 3 shops with PayPal checkout, plus deposit, payout and refund in sandbox.
5. **Days 4–7:** re-run the eval, then lock the card numbers to the eval output. Edit the card if the numbers move.

## Week 2 (3 – 9 Nov): wire it together and polish

1. **Days 8–9:** end-to-end run. 200 agent sessions lead to credits, then one payout and one refund.
2. **Days 8–11:** AG Studio widgets and the Analyst agent on live engine data.
3. **Day 12:** demo script dry run. Every beat in the packet plays from one command.
4. **Day 13:** README, repo licence, sandbox creds in `.env.example`, and run instructions.
5. **Day 14 (9 Nov):** freeze.

## Risks

| Risk | Fallback |
|---|---|
| PayPal sandbox flaky (it already was) | A mock layer that replays spec-valid responses from the official OpenAPI specs, toggled by env var. The demo never depends on sandbox uptime. |
| No public Store Sync agent catalogue API | Our own MCP server mocks it. This is legitimate: it is the PayPal-side view. |
| AG Studio Agent Framework docs are thin | Prototype the custom-agent handoff on day 1 of week 2. If it's blocked, ask AG Grid DevRel on their Discord, which needs your go-ahead. |
| Eval numbers differ from the card | Update the card. Keep any real number, even a smaller one. |

## Before you start
- Create a PayPal sandbox business app (merchant) and 2 personal accounts (buyer and HouseFresh). Takes about 15 minutes.
- Start the AG Studio 45-day trial now. Starting 26 Oct, it runs to about 10 Dec, which covers the 12 Nov submission (judging runs 1–15 Dec, so keep the hosted demo on mocks).
