# Devpost submission draft

Paste each section into the matching Devpost field. Numbers come from `npm run demo:cited`, `packages/evals/results/cited*` and [spec/CITED-card.md](spec/CITED-card.md); see the provenance table in [spec/CITED-packet.md](spec/CITED-packet.md). Items marked [confirm after AG Studio PR] describe the planned AG Studio build; check them against the merged PR before submitting.

## Before submitting (requirements from the hackathon rules)

| Requirement | Where it is met | Status |
|---|---|---|
| Meaningful use of PayPal (sandbox) and AI | Orders v2, Vault, Webhooks, Payouts, captures refund, disputes; shopper agents (GPT, Gemini, Sonnet); AG Studio Analyst agent | met |
| Public repo with a visible OSS licence | <https://github.com/HUSAM-07/hack-paypal>, MIT | **repo is private today: make it public before submitting** |
| Working build: hosted URL or full run instructions | Hosted demo below; `npm ci && npm run demo:cited` runs with no keys; sandbox setup in `.env.example` and `cited/spec/AGENT-CHECKOUT.md` | met |
| Text description, tools used | This file | met |
| YouTube video under 3 minutes showing it working | Script: `cited/spec/CITED-packet.md` (b) | **record and paste the link** |
| New or significantly updated since 1 Oct 2026 | All CITED code was written during the period (git history) | met |
| Legible to an LLM grader | README, this file and the card state problem, user, numbers and sources in plain text | met |
| AG Grid sponsor prize: polish beyond plain AG Grid/AG Charts, plus Studio Agent Framework | Studio brand and creator views; custom Analyst agent delegating to the built-in Data and Chart agents | [confirm after AG Studio PR] |

---

## Project name

CITED

## Tagline (Elevator pitch)

PayPal's affiliate network, rebuilt for AI agents: it pays creators on proven lift, not last-click cookies.

## Inspiration

Affiliate marketing is a $13.81B-a-year business in the US (eMarketer), and it pays per click. AI shopping agents read product tests, then buy, and never click a link. In October 2026 Fast Company reported Meta's Muse selling on Vacuum Wars' tests, with no way for the creators to prove it or be paid. The people agents trust most are about to earn nothing from them.

PayPal is the one company that holds all three pieces needed to fix this: an affiliate network (Honey), an agent catalogue (Store Sync) and Payouts to PayPal and Venmo. So we asked what PayPal's affiliate network should look like when the shopper is an agent.

## What it does

CITED pays creators for sales their tests cause, measured with a randomised holdout, settled through PayPal.

1. **Brands fund a category, never a verdict.** Winix and Levoit each deposit $1,000 into a purifier programme (Orders v2 capture). Each pays only for its own lifted units, so an honest "buy the rival" verdict still earns when the rival funds.
2. **The catalogue randomises what agents see.** Sellers (Northwind, Lumen, MegaMart) sync their catalogues to PayPal; there are no storefronts. Each agent session randomly gets the creator's test, a placebo (other content from the same creator) or nothing: 50/50 for a new test's first 7 days, then a permanent 5% holdout. Ranking is identical in every arm; only the test is added or withheld.
3. **Agents check out through PayPal themselves.** The agent platform creates an Orders v2 order with the seller as `payee`, charges the wallet the buyer linked once through PayPal Vault, and puts a signed Agent Affiliate Passport in `purchase_units[].custom_id`. In the demo the exposed agent reads Northwind's offer, pays Lumen $4 less, and the sale still joins its arm.
4. **The engine credits only caused sales.** From PayPal's webhooks it computes the attributable fraction at the 80% lower bound: 57 exposed sales become 51 caused units, $391.64 at 8% commission. Levoit's bound is below zero: $0.
5. **Unhappy paths are first-class.** A seller refund voids the pending credit before it can pay (−$7.68). A buyer dispute freezes credits until PayPal decides, then releases them (or voids them if the buyer wins). Credits are held 30 days.
6. **Creators are paid by PayPal Payouts.** Day 30: $383.96 to HouseFresh in one batch, and $616.04 of Winix's deposit returns through `captures/{id}/refund`. When a second creator, AirLab, publishes its own test, co-exposed sales split by Shapley value ($3.84 each on a $7.68 commission). Programme to date: $468.43 paid in 3 batches, and the ledger matches PayPal to the cent.
7. **AG Studio shows it to the brand and the creator.** Maya, Winix's brand manager, sees caused units, credits, voids and the deposit; her Analyst agent recommends where to spend, and she approves. The creator sees pending, frozen, voided and paid credits and the Shapley split. [confirm after AG Studio PR]

Judges can run it three ways: watch the recorded two-agent demo at `/console`, run a live agent at `/try`, or point their own agent at the public MCP server at `/mcp` and buy a purifier.

## How we built it

- **PayPal Orders v2:** brand deposits (`CAPTURE` orders) and every agent checkout: seller as `purchase_units[].payee`, `items[].upc`, the signed passport in `custom_id`, `payment_source.paypal.vault_id` with stored-credential fields. Every mutating call sets a deterministic `PayPal-Request-Id`, so a retry never pays twice.
- **PayPal Vault:** the buyer links a PayPal wallet to their shopping agent once (setup token, then payment token); every later checkout charges that `vault_id`.
- **PayPal Webhooks:** signature-verified intake of `CHECKOUT.ORDER.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED` and `CUSTOMER.DISPUTE.CREATED` / `RESOLVED`. If a capture arrives before its order, the engine reads the order back with `GET /v2/checkout/orders/{id}`.
- **Payments v2 captures refund:** sellers refund returned items (voiding the credit); the programme refunds each brand's unspent deposit.
- **Disputes:** an open dispute freezes the sale's credits; a seller-favour resolution releases them, a buyer win voids them.
- **PayPal Payouts:** batch payouts to creators' `PAYPAL_ID`, with a deterministic `sender_batch_id`, after the 30-day hold.
- **AI agents:** shopper agents on GPT, Gemini and Claude Sonnet through an OpenAI-compatible gateway, shopping through an MCP catalogue (`search_product`, `checkout`). The catalogue is also a public remote MCP server (Streamable HTTP) that Claude, Cursor or any MCP client can use.
- **Attribution:** pure TypeScript functions for the model-stratified attributable fraction, its one-sided 80% lower bound, the Shapley split and the ledger rules, with property tests. Money is integer minor units throughout.
- **AG Studio + Agent Framework:** brand and creator dashboards built on AG Studio with AG Grid, including a cross-seller journey and Shapley split table; a custom Analyst agent that delegates to Studio's built-in Data and Chart agents and asks Maya for approval through an approval tool before any budget change. [confirm after AG Studio PR]
- **Cloudflare:** one Worker (Hono) serves the landing page, console, Studio, `/try`, `/mcp` and the engine; D1 holds the ledger; a Durable Object holds the demo stack (catalogue, simulated PayPal, engine state).
- **Evals:** a pre-registered eval harness that reruns the agent study across three models and writes committed results.

## Challenges we ran into

- **Proving cause, not correlation.** Last-click credit rewards whoever touched the sale last. We needed a placebo arm (other content from the same creator) so reputation is stripped out, and a lower bound so creators are paid a defensible floor rather than a point estimate.
- **Keeping money out of rank.** Every arm must see the same offers in the same order. We enforce it with a test and never let a deposit touch ranking or verdicts.
- **Joining a sale back to its arm without the merchant's help.** The signed passport has to fit PayPal's 127-character `custom_id` and survive the agent paying a different seller than the one whose offer it read.
- **Agent checkout without storefronts.** Midway through we dropped demo shops entirely: agents now pay sellers through PayPal from a vaulted wallet. That meant rebuilding the checkout, the mock and the engine's join around Orders v2 payees.
- **Unhappy paths in the right order.** Void before pay, freeze while a dispute is open, never pay inside the hold, and keep ledger and PayPal reconciled when the demo clock jumps 60 days.

## Accomplishments that we're proud of

- **A pre-registered eval with a real effect.** 147 forced-buy sessions across GPT, Gemini and Sonnet, Winix and Levoit priced the same: shown the test, agents bought Winix 57/57; shown the placebo, 3/54. Lift **+94pp**, 80% lower bound **+90.3pp**, positive in all three models (GPT +89, Gemini +100, Sonnet +94). Across all evals: 963 sessions under two pre-registrations, including the cases where it does not pay (a close verdict: lower bound −6.0pp, $0).
- **The demo checks itself.** `npm run demo:cited` plays 13 beats and ends with 24 reconciliation checks: 159 orders paid sellers from the buyer's wallet, every capture reached the engine, and the ledger's $468.43 paid equals PayPal's 3 payout batches.
- **Anyone can try it with their own agent**, through the public MCP server, with live sessions kept apart from the recorded numbers.
- **Every number on the card traces to a committed result.**

## What we learned

- Agents defer strongly to an explicit verdict: when prices match they flip from the default to the tested product. When price already decides, the test adds little (+24pp) and pays less. Paying on measured lift handles both honestly.
- Disputes and refunds shape the ledger design more than the happy path does.
- An MCP catalogue is a natural place to run a holdout: the platform, not the merchant, decides what each agent reads.

## What's next for CITED

- Run the agent checkout end to end on the PayPal sandbox with three seller accounts and real webhook delivery.
- More categories and creators, so tests compete and Shapley splits get richer.
- Creator-side onboarding (Payouts to PayPal and Venmo) and a brand self-serve programme flow in AG Studio.
- Integrate with PayPal's real agent catalogue and Honey's affiliate contracts.

## Built with

`paypal` `paypal-orders-v2` `paypal-vault` `paypal-webhooks` `paypal-payouts` `paypal-disputes` `ag-grid` `ag-studio` `ag-studio-agent-framework` `mcp` `cloudflare-workers` `cloudflare-d1` `durable-objects` `hono` `typescript` `vitest` `openai` `gemini` `claude`

## Try it out (links)

- Hosted demo: <https://pact-worker.vincent-wesley-liem.workers.dev/>
- Two agents, side by side: <https://pact-worker.vincent-wesley-liem.workers.dev/console?clean=1>
- The payout: <https://pact-worker.vincent-wesley-liem.workers.dev/console/payout?clean=1>
- Run a live agent: <https://pact-worker.vincent-wesley-liem.workers.dev/try>
- Public MCP server: <https://pact-worker.vincent-wesley-liem.workers.dev/mcp> (`claude mcp add --transport http cited https://pact-worker.vincent-wesley-liem.workers.dev/mcp`)
- AG Studio: <https://pact-worker.vincent-wesley-liem.workers.dev/studio> [confirm after AG Studio PR]
- Repository: <https://github.com/HUSAM-07/hack-paypal>
- Video: VIDEO_LINK_TODO
