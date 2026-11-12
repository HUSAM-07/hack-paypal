# Devpost submission draft

Paste each section into the matching Devpost field. Numbers come from `npm run demo:cited`, `packages/evals/results/cited*` and [spec/CITED-card.md](https://github.com/HUSAM-07/hack-paypal/blob/main/cited/spec/CITED-card.md); see the provenance table in [spec/CITED-packet.md](https://github.com/HUSAM-07/hack-paypal/blob/main/cited/spec/CITED-packet.md). Be precise about money: one Payouts batch and one Invoicing statement ran on the real PayPal sandbox with the demo's numbers, and the agent checkout ran end to end on the sandbox with small amounts (HUSAM-07/hack-paypal#84, [SANDBOX-EVIDENCE.md](https://github.com/HUSAM-07/hack-paypal/blob/main/cited/SANDBOX-EVIDENCE.md)); the hosted demo runs on simulated PayPal.

## Before submitting (requirements from the hackathon rules)

| Requirement | Where it is met | Status |
|---|---|---|
| Meaningful use of PayPal (sandbox) and AI | Orders v2 and Vault (real sandbox agent checkout, captured and refunded), Webhooks (verified PayPal deliveries), Payouts (real sandbox batches `ME2KV57B7KYNS` and `GB9U5DYBGHLY4`), Invoicing (real sandbox invoice `INV2-TNXC-9GA6-W36V-WTF6`), captures refund, disputes, Log in with PayPal; shopper agents (GPT, Gemini, Sonnet); AG Studio Analyst agent | met |
| Public repo with a visible OSS licence | <https://github.com/HUSAM-07/hack-paypal>, MIT | met (public) |
| Working build: hosted URL or full run instructions | Hosted demo below; `npm ci && npm run demo:cited` runs with no keys; sandbox setup in `.env.example` and `cited/spec/AGENT-CHECKOUT.md` | met |
| Text description, tools used | This file | met |
| YouTube video under 3 minutes showing it working | Script: `cited/spec/CITED-packet.md` (b) | **record and paste the link** |
| New or significantly updated since 1 Oct 2026 | All CITED code was written during the period (git history) | met |
| Legible to an LLM grader | README, this file and the card state problem, user, numbers and sources in plain text | met |
| AG Grid sponsor prize: polish beyond plain AG Grid/AG Charts, plus Studio Agent Framework | `/studio` and `/studio/creator`: AG Studio themed in CITED's palette and fonts, live tables updated by transactions, a master-detail AG Grid widget (cross-seller journey + Shapley split), a First payout / Programme to date toggle, Release / Void buttons on held credits; custom Agent Framework Analyst delegating to the built-in Data, Page and Widget agents, with Maya's Approve button on its tool card | met (Studio and Grid licence keys set on the hosted worker: no watermark) |


## PayPal APIs: real sandbox vs simulated

| API | Real PayPal sandbox | Hosted demo |
|---|---|---|
| Payouts | Day-30 batch: $383.96, batch `ME2KV57B7KYNS`, status SUCCESS (HUSAM-07/hack-paypal#84) | simulated |
| Invoicing v2 | Winix statement `INV2-TNXC-9GA6-W36V-WTF6`: $383.96 invoiced, MARKED_AS_PAID, $0 due (HUSAM-07/hack-paypal#84) | simulated |
| OAuth, Vault | The sandbox buyer approved a vault setup token once; the agent's orders charge that `vault_id` with no further approval | simulated |
| Orders v2 agent checkout, Agent Toolkit `get_order` | 3 agent orders ($2.00 each) with the seller as payee, the signed passport in `custom_id` and `items[].upc`, created and captured in one call from the vault (`8E6030344K4198450`, `8F195714E6441535R`, `4XV50799SF6195530`), read back with `get_order`; the engine joined each capture to its arm and credited 2 caused units | simulated |
| Captures refund (Agent Toolkit `create_refund`) | Refund `81C245246C527113H`; its `PAYMENT.CAPTURE.REFUNDED` webhook voided that sale's credit in the engine | simulated |
| Webhooks | PayPal-signed captures, refund and payout-batch events delivered to subscription `8042373202922840X` and verified on the hosted engine (`signedFor=subscription`); a local engine received the same events by replay, since PayPal cannot reach it | simulated |
| Payouts (agent checkout run) | The engine's `runPayouts` sent batch `GB9U5DYBGHLY4`: $0.16 for the one credit left after the refund, SUCCESS | simulated |
| Log in with PayPal | A sandbox personal account signed in; the worker's identity code exchanged the code and read a payer id, name and email from `userinfo` ([SANDBOX-EVIDENCE.md](https://github.com/HUSAM-07/hack-paypal/blob/main/cited/SANDBOX-EVIDENCE.md)) | simulated |
| Disputes | Code paths built against the sandbox APIs | simulated |

The simulated PayPal mirrors the REST shapes and signs webhooks like PayPal, so the same client code runs in both modes (`PAYPAL_MODE=sandbox` switches it; on the worker, `CITED_PAYPAL_MODE`).

## Testing instructions

No login, no keys. Open in this order:

1. <https://pact-worker.vincent-wesley-liem.workers.dev/>: the problem and how it works.
2. <https://pact-worker.vincent-wesley-liem.workers.dev/console?clean=1>: two agents, same request; one shown the test buys the Winix, one held out buys the Levoit.
3. <https://pact-worker.vincent-wesley-liem.workers.dev/console/payout?clean=1>: the $383.96 payout; "Statement" opens Winix's PayPal invoice.
4. <https://pact-worker.vincent-wesley-liem.workers.dev/proof>: the pre-registered eval (147 headline sessions, +94pp, 80% bound +90.3pp); all 1,551 sessions download as CSV; `#vacuums` repeats the study on robot vacuums.
5. <https://pact-worker.vincent-wesley-liem.workers.dev/studio?view=first>: the brand's AG Studio dashboard. Ask the Analyst "Should we raise the purifier cap?": it hands the work to Studio's Data, Page and Widget agents, adds a chart, and answers from the ledger (on the hosted data, which already includes a top-up, it says keep the cap; the video shows the Approve flow). "Why did Levoit pay nothing?" answers in about 10 seconds. `/studio/creator?clean=1` is the creator's view.
6. <https://pact-worker.vincent-wesley-liem.workers.dev/try>: run a shopping agent yourself.
7. Your own agent: `claude mcp add --transport http cited https://pact-worker.vincent-wesley-liem.workers.dev/mcp`, then ask it to buy an air purifier.
8. <https://pact-worker.vincent-wesley-liem.workers.dev/creators>: onboard as a creator (simulated Log in with PayPal) and publish a test.

Fallback, locally with Node 22+ (no keys; simulated PayPal, scripted agents):

```bash
npm ci && npm run demo:cited
```

It plays the 14 beats and ends with 32 ledger-vs-PayPal checks.

---

## Project name

CITED

## Tagline (Elevator pitch)

Affiliate marketing, rebuilt on PayPal for AI agents: it pays creators on proven lift, not last-click cookies.

## Inspiration

US advertisers will spend $13.81B on affiliate marketing in 2026 ([EMARKETER](https://www.emarketer.com/content/faq-on-affiliate-marketing--how-ai-creators-reshaping-channel-2026)), and it pays per click. AI shopping agents read product tests, then buy, and never click a link. In October 2026 [Fast Company](https://www.fastcompany.com/91621388/i-let-ai-assistant-shop-me-reviewers-got-nothing) let Meta's Muse shop for a robot vacuum: it leaned on Vacuum Wars' tests and sent the sale to other retailers, so the reviewers who did the testing got nothing. The people agents trust most are about to earn nothing from them.

PayPal is the one company that holds all three pieces needed to fix this: an affiliate network (Honey), an agent catalogue (Store Sync) and Payouts to PayPal and Venmo. So we asked what PayPal's affiliate network should look like when the shopper is an agent.

## What it does

CITED pays creators for sales their tests cause, measured with a randomised holdout, settled through PayPal.

1. **Brands fund a category, never a verdict.** Winix and Levoit each deposit $1,000 into a purifier programme (Orders v2 capture). Each pays only for its own lifted units, so an honest "buy the rival" verdict still earns when the rival funds.
2. **The catalogue randomises what agents see.** Sellers (Northwind, Lumen, MegaMart) sync their catalogues to PayPal; there are no storefronts. Each agent session randomly gets the creator's test, a placebo (other content from the same creator) or nothing: 50/50 for a new test's first 7 days, then a permanent 5% holdout. Ranking is identical in every arm; only the test is added or withheld.
3. **Agents check out through PayPal themselves.** The agent platform creates an Orders v2 order with the seller as `payee`, charges the wallet the buyer linked once through PayPal Vault, and puts a signed Agent Affiliate Passport in `purchase_units[].custom_id`. In the demo the exposed agent reads Northwind's offer, pays Lumen $4 less, and the sale still joins its arm.
4. **The engine credits only caused sales.** From PayPal's webhooks it computes the attributable fraction at the 80% lower bound: 57 exposed sales become 51 caused units, $391.64 at 8% commission. Levoit's bound is below zero: $0.
5. **Unhappy paths are first-class.** A seller refund voids the pending credit before it can pay (−$7.68). A buyer dispute freezes credits until PayPal decides, then releases them (or voids them if the buyer wins). Credits are held 30 days. A self-dealing guard holds credits for review when a creator buys through their own PayPal (also repeat buyers, sudden spikes and serial refunders): the sale stays out of the study and the credit is never paid automatically.
6. **Creators are paid by PayPal Payouts; brands get a PayPal invoice.** Day 30: $383.96 to HouseFresh in one batch, and $616.04 of Winix's deposit returns through `captures/{id}/refund`. We ran that payout on the real PayPal sandbox: batch `ME2KV57B7KYNS`, status SUCCESS. At cycle close each brand gets a statement through PayPal Invoicing, marked paid against its deposit ($383.96 invoiced, $0 due; sandbox invoice `INV2-TNXC-9GA6-W36V-WTF6`). When a second creator, AirLab, publishes its own test, co-exposed sales split by Shapley value ($3.84 each on a $7.68 commission). Programme to date: $468.43 paid in 3 batches, and the ledger matches PayPal to the cent.
7. **AG Studio shows it to the brand and the creator.** Maya, Winix's brand manager, sees "+51 extra Winix sales" at the 80% lower bound, Levoit's $0, the arm strip, the deposit meter and every cross-seller journey; a toggle switches between the first payout and programme to date. Her Analyst, a custom Agent Framework agent, reads the data through Studio's built-in Data agent, adds a chart with the Page and Widget agents, and drafts a $500 top-up that changes nothing until she presses Approve. The creator view shows pending, frozen, held, voided and paid credits and the Shapley split.
8. **Creators onboard with PayPal.** At `/creators` a creator connects with Log in with PayPal (its payer id becomes the Payouts receiver) and publishes a test, which enters the holdout schedule. Hosted, the sign-in is a labelled simulated PayPal page.

**Who pays and who earns.** Brands pay commission only on sales their creators' tests caused, out of a deposit they control, and get back whatever is unspent. CITED, run by PayPal, would take a platform fee on the commission it settles, as affiliate networks take an override today, so it earns only when a test provably caused a sale (the demo charges no fee). PayPal gains more than the fee: every caused sale is a PayPal checkout, every creator payment a Payouts transfer and every brand statement a PayPal invoice.

Judges can check it four ways: read the pre-registration and per-model results at `/proof` (all 1,551 sessions downloadable), watch the recorded two-agent demo at `/console` and Studio, run a live agent at `/try`, or point their own agent at the public MCP server at `/mcp` and buy a purifier.

## How we built it

- **PayPal Orders v2:** brand deposits (`CAPTURE` orders) and every agent checkout: seller as `purchase_units[].payee`, `items[].upc`, the signed passport in `custom_id`, `payment_source.paypal.vault_id` with stored-credential fields. Every mutating call sets a deterministic `PayPal-Request-Id`, so a retry never pays twice.
- **PayPal Vault:** the buyer links a PayPal wallet to their shopping agent once (setup token, then payment token); every later checkout charges that `vault_id`.
- **PayPal Webhooks:** signature-verified intake of `CHECKOUT.ORDER.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED` and `CUSTOMER.DISPUTE.CREATED` / `RESOLVED`. If a capture arrives before its order, the engine reads the order back with `GET /v2/checkout/orders/{id}`.
- **Payments v2 captures refund:** sellers refund returned items (voiding the credit); the programme refunds each brand's unspent deposit.
- **Disputes:** an open dispute freezes the sale's credits; a seller-favour resolution releases them, a buyer win voids them.
- **PayPal Payouts:** batch payouts to creators' `PAYPAL_ID`, with a deterministic `sender_batch_id`, after the 30-day hold. Proven on the real sandbox: $383.96, batch `ME2KV57B7KYNS`, SUCCESS.
- **PayPal Invoicing v2:** one statement per brand at cycle close, recorded as paid against the prepaid deposit; a brand with nothing to pay gets no invoice.
- **Log in with PayPal:** creator onboarding; the payer id from `userinfo` is the Payouts receiver.
- **AI agents:** shopper agents on GPT, Gemini and Claude Sonnet through an OpenAI-compatible gateway, shopping through an MCP catalogue (`search_product`, `checkout`). Checkout uses the PayPal Agent Toolkit (`@paypal/agent-toolkit`) for every call it can express: `pay_order` (capture), `get_order` (read-back, also exposed as an MCP tool) and `create_refund` (seller refunds). Order creation stays on our Orders v2 client, because the toolkit's `create_order` cannot set the payee, `custom_id`, `items[].upc` or a vaulted `payment_source`. The catalogue is also a public remote MCP server (Streamable HTTP) that Claude, Cursor or any MCP client can use.
- **Attribution:** pure TypeScript functions for the model-stratified attributable fraction, its one-sided 80% lower bound, the Shapley split and the ledger rules, with property tests. Money is integer minor units throughout.
- **AG Studio + Agent Framework:** `ag-studio` + `ag-studio-react`, themed with CITED's colours and fonts. The engine's read API becomes eight Studio tables, polled every 15 s while someone is looking and applied as transactions, so a refund void appears without a reload. A master-detail AG Grid widget shows each cross-seller journey with its Shapley split. The custom Analyst agent delegates to the built-in Data, Page and Widget agents (Studio has no separate chart agent; the Widget agent configures charts), then calls a `draft_cap_top_up` tool whose card carries Maya's Approve button; the server recomputes the amount and never trusts the request. The model runs server-side, rate-limited, keys never reach the browser.
- **Cloudflare:** one Worker (Hono) serves the landing page, `/proof`, console, Studio, `/creators`, `/try`, `/mcp` and the engine; D1 holds the ledger; a Durable Object holds the demo stack (catalogue, simulated PayPal, engine state).
- **Evals:** a pre-registered eval harness that reruns the agent study across three models and writes committed results; `/proof` renders them at build time.
- **Hardening:** the hosted engine's write endpoints (clock, payouts, cycle close, approvals, refunds, disputes) are locked behind a bearer token and fail closed; reads, `/try` and `/mcp` stay public and rate-limited.

## Challenges we ran into

- **Proving cause, not correlation.** Last-click credit rewards whoever touched the sale last. We needed a placebo arm (other content from the same creator) so reputation is stripped out, and a lower bound so creators are paid a defensible floor rather than a point estimate.
- **Keeping money out of rank.** Every arm must see the same offers in the same order. We enforce it with a test and never let a deposit touch ranking or verdicts.
- **Joining a sale back to its arm without the merchant's help.** The signed passport has to fit PayPal's 127-character `custom_id` and survive the agent paying a different seller than the one whose offer it read.
- **Agent checkout without storefronts.** Midway through we dropped demo shops entirely: agents now pay sellers through PayPal from a vaulted wallet. That meant rebuilding the checkout, the mock and the engine's join around Orders v2 payees.
- **Self-dealing.** A creator can pay for its own sales. The guard keeps those sessions out of the study and holds their credits for a human, without moving any measured number.
- **Unhappy paths in the right order.** Void before pay, freeze while a dispute is open, never pay inside the hold, and keep ledger and PayPal reconciled when the demo clock jumps 60 days.

## Accomplishments that we're proud of

- **A pre-registered eval with a real effect.** 147 forced-buy sessions across GPT, Gemini and Sonnet, Winix and Levoit priced the same: shown the test, agents bought Winix 57/57; shown the placebo, 3/54. Lift **+94pp**, 80% lower bound **+90.3pp**, positive in all three models (GPT +89, Gemini +100, Sonnet +94). Across all evals: 1,551 sessions under three pre-registrations, including the cases where it does not pay (a close verdict: lower bound −6.0pp, $0).
- **It holds in a second category, with an honest smaller number.** The same pre-registered study on robot vacuums (a fictional creator, Roborock Q7 Max vs iRobot Roomba Combo j5, 588 sessions, same three models): priced alike, shown the test agents bought the Roborock 57/57, shown the placebo 45/54, a lift of +16.7pp with an 80% lower bound of +11.7pp. Agents already leaned towards the Roborock, so there was less for the test to add, and the engine credits 5 of 50 sales instead of nearly all; Sonnet showed no lift, so one pre-registered check (positive in every model) is not met. With the Roomba $4 cheaper: +74.1pp, bound +68.6pp.
- **The demo checks itself.** `npm run demo:cited` plays 14 beats and ends with 32 reconciliation checks: 160 orders paid sellers from the buyer's wallet, every capture reached the engine, and the ledger's $468.43 paid equals PayPal's 3 payout batches.
- **A real PayPal sandbox payout** of the headline $383.96 (batch `ME2KV57B7KYNS`, SUCCESS) and a matching Invoicing statement.
- **Anyone can try it with their own agent**, through the public MCP server, with live sessions kept apart from the recorded numbers.
- **Every number on the card traces to a committed result.**

## What we learned

- Agents defer strongly to an explicit verdict: when prices match they flip from the default to the tested product. When price already decides, the test adds little (+24pp) and pays less. Paying on measured lift handles both honestly.
- Disputes and refunds shape the ledger design more than the happy path does.
- An MCP catalogue is a natural place to run a holdout: the platform, not the merchant, decides what each agent reads.

## What's next for CITED

- Run the agent checkout on the PayPal sandbox with three separate seller accounts (it already ran end to end there with one, with PayPal-signed webhooks: [SANDBOX-EVIDENCE.md](https://github.com/HUSAM-07/hack-paypal/blob/main/cited/SANDBOX-EVIDENCE.md)).
- Feed tests published at `/creators` into the live catalogue's holdout.
- More categories and creators beyond purifiers and robot vacuums, so tests compete and Shapley splits get richer.
- Venmo payouts for creators and a brand self-serve programme flow in AG Studio.
- Integrate with PayPal's real agent catalogue and Honey's affiliate contracts.

## Built with

`paypal` `paypal-orders-v2` `paypal-vault` `paypal-webhooks` `paypal-payouts` `paypal-invoicing` `paypal-disputes` `log-in-with-paypal` `ag-grid` `ag-studio` `ag-studio-agent-framework` `mcp` `cloudflare-workers` `cloudflare-d1` `durable-objects` `hono` `typescript` `vitest` `openai` `gemini` `claude`

## Try it out (links)

- Hosted demo: <https://pact-worker.vincent-wesley-liem.workers.dev/>
- Two agents, side by side: <https://pact-worker.vincent-wesley-liem.workers.dev/console?clean=1>
- The payout: <https://pact-worker.vincent-wesley-liem.workers.dev/console/payout?clean=1>
- Run a live agent: <https://pact-worker.vincent-wesley-liem.workers.dev/try>
- Public MCP server: <https://pact-worker.vincent-wesley-liem.workers.dev/mcp> (`claude mcp add --transport http cited https://pact-worker.vincent-wesley-liem.workers.dev/mcp`)
- The proof (pre-registration, per-model results, all 1,551 sessions): <https://pact-worker.vincent-wesley-liem.workers.dev/proof>
- AG Studio, brand view: <https://pact-worker.vincent-wesley-liem.workers.dev/studio?view=first>
- AG Studio, creator view: <https://pact-worker.vincent-wesley-liem.workers.dev/studio/creator?clean=1>
- Winix's statement (PayPal Invoicing): <https://pact-worker.vincent-wesley-liem.workers.dev/console/statement?brand=winix&clean=1>
- Creator onboarding: <https://pact-worker.vincent-wesley-liem.workers.dev/creators>
- Repository: <https://github.com/HUSAM-07/hack-paypal>
- Video: VIDEO_LINK_TODO
