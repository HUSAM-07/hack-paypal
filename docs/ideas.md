# Idea Bank — Unified Agentic Commerce Chat

Direction: **one chat interface** where an agent finds, compares, and **actually buys** things through PayPal. Users set **fine-grained controls** on what the agent may spend. Answers render as **generative UI**: product cards, carts, approval prompts, and dashboards inside the chat.

See [hackathon-brief.md](hackathon-brief.md) for rules and prizes. Deadline: **Nov 12, 12:00pm PT**, with the optional early check on **Nov 5**.

---

## The shared core (build this regardless of idea)

Every idea below sits on the same platform, so we build it once and pick a story on top.

| Layer | Choice | Why |
|---|---|---|
| Chat + generative UI | Next.js + **AI SDK** with typed tool calls → React components per tool result | Each tool returns structured data the client renders as a widget, e.g. `searchProducts` → `<ProductCarousel>` and `proposeCart` → `<CartCard>` |
| Model | Claude (Opus/Sonnet 5.5) via AI Gateway or Anthropic direct | Strong tool use; name it clearly in "Built With" |
| Catalog | **Channel3** API/MCP | Real products, images, prices, and variants with no scraping. Qualifies for the Channel3 prize. |
| Payments | **Orders v2 + JS SDK v6** for in-chat approval; **Vault v3** for pre-approved off-session buys; **`@paypal/agent-toolkit`** for refunds, shipment tracking, invoices, subscriptions, and transactions | Covers the "agent that actually transacts" story end to end |
| **Policy engine** | Deterministic TypeScript, *not* the LLM | **The model proposes; the policy engine decides.** Every spend tool goes through `authorize(intent, policy)` and returns `allow`, `needs_approval`, or `deny`, with a reason. This is the core idea behind "fine-grained controls". |
| Mandates | AP2-style **intent mandate** ("up to $60 on running shoes this week") → **cart mandate** (the exact items and total the user signed off on) | Gives judges a recognizable frame. Stored, auditable, and revocable. |
| Audit + webhooks | PayPal webhooks (capture completed, refund, dispute) feed the activity log and push in-chat events | Shows a real round-trip, not just a fire-and-forget call |

**Generative UI widget kit** (each one is a tool result renderer):
- `ProductCarousel`, `CompareTable`, and `VariantPicker` (size/color)
- `CartCard` with an inline **PayPal button** (SDK v6) and a "why this pick" explanation
- `ApprovalRequest`: "Agent wants to spend $84 at X, which is over your $50 cap. Approve, edit, or deny." It can be sent to another person.
- `PolicyEditor`: the user says "never spend more than $100/week on gadgets" in plain language. The agent turns it into a structured rule and shows a diff to confirm.
- `SpendDashboard` (**AG Grid / AG Studio** widget): spend by category, remaining budgets, agent vs. manual purchases
- `OrderTimeline`: capture → shipped → delivered, using shipment tracking
- `Receipt` with **Refund** and **Return** actions (toolkit `create_refund`)

**Control dimensions worth supporting** (pick 5–6 for the demo):
- Per-transaction cap, plus daily, weekly, and monthly budgets
- Category caps and blocklists (e.g. no alcohol, no gift cards)
- Merchant allow/deny lists
- Approval threshold, routed to self or to a guardian/manager
- Time windows ("no purchases after 10pm")
- Mandate expiry
- Max number of auto-buys
- Price-ceiling conditions ("only if under $X")
- Kill switch: revoke all mandates and vaulted tokens

**Known constraint (be upfront in the README):** Channel3 items are sold by real retailers, and sandbox money can't buy from them. In the demo our app acts as the **sandbox merchant of record**: one sandbox business account, or several, one per "retailer", using `purchase_units[].payee`. Verify on day 1 that `payee` routing works in the sandbox. Don't use KERNEL to automate checkouts on real retail sites (ToS risk).

---

## Ideas

Scores are 1–5 against the five equally weighted judging criteria: **T**ech, **D**esign, **I**mpact, **N**ovelty, **P**resentation.

### 1. Mandate: an agentic shopping chat with programmable spending policies ⭐ flagship

Chat to shop. The agent searches Channel3, compares options, and builds a cart. Then it either checks out instantly (when the order fits an active mandate, charged against the vaulted wallet) or raises an approval widget. Users manage rules in plain language through the chat.
- **Demo moment:** "Get me trail running shoes, size 10, under $120." The agent shows a carousel, auto-buys because it fits the mandate, and shows a receipt. Then: "Also grab a $200 GPS watch." Policy blocks it, the approval widget appears, the user taps approve, and it's captured.
- **Prize targets:** Grand, *Best Use of Agentic Commerce*, *Best Use of PayPal + AI*, plus Channel3 or AG Grid.
- **Scores:** T5 D5 I3 N4 P5. Impact is weak unless paired with a specific audience, so choose one from ideas 2–4.

### 2. Family Agent Allowance (persona layer on #1)

Parents give a teen or college student a shopping agent with guardrails: weekly allowance, category rules, and "ask Mom over $40". Approval requests go **to the parent's view** as an `ApprovalRequest` widget, and the parent sees a household spend dashboard.
- **Why it wins Impact:** a specific audience (families, an explicit PayPal "underserved" example). Multi-party controls are a real gap today, since kids borrowing a parent's card has no limits.
- **Demo moment:** a split screen with the teen's chat on one side and the parent's phone on the other. The parent approves live and the order captures.
- **Scores:** T5 D5 I5 N4 P5. **Top recommendation.**

### 3. Caregiver Co-pilot: accessible shopping for seniors

A voice-first, large-type chat for an elderly person ("I need more of my usual vitamins"). Their caregiver sets rules: reorder only known items, cap $75/week, flag new merchants. The aim is to protect against scams and overspending while preserving independence.
- **Prize targets:** *Most Impactful*, Grand.
- **Risk:** voice adds scope. Text-first with big-button widgets is enough, and we can add Web Speech API input as a stretch.
- **Scores:** T4 D4 I5 N4 P4. A great alternative persona to #2, and we could ship both as "delegation profiles".

### 4. Team Procurement Agent for small businesses

The office manager chats: "restock the kitchen and order 3 monitors". Per-department budgets apply, and anything over $500 needs the founder's approval. Items post to the AG Grid spend dashboard, and invoices are generated for client-billable items (toolkit invoicing).
- **Prize targets:** Grand, AG Grid ($5k 1st).
- **Scores:** T5 D4 I4 N3 P4. Less novel because B2B spend management (Ramp, Brex) is crowded.

### 5. Standing Orders and Price-Watch Agent (feature for #1 or standalone)

"Buy the Sony XM6 if it drops below $280 before Friday" or "Reorder coffee beans every 3 weeks." A durable background agent (Render Workflows or Vercel Workflow) polls Channel3 prices. When the condition is met and the mandate permits, it charges the vaulted token and posts a message in the chat thread. A Bryntum calendar shows upcoming scheduled buys.
- **Prize targets:** Agentic Commerce, Bryntum or Render.
- **Scores:** T5 D4 I4 N4 P4. **Best "wow" add-on**: it shows the agent acting while the user is away, which is the real point of agentic commerce.

### 6. Group Cart and Split-Pay in Chat

Multiple people share one thread ("group gift for Sam, $30 each" or "dorm supplies"). The agent builds a shared cart. Each person approves their share via their own PayPal popup, and the order completes when everyone has paid (or the organizer covers the gap). Uses multiple orders or invoices plus webhooks to track who has paid.
- **Prize targets:** Most Creative, Agentic Commerce.
- **Scores:** T4 D4 I4 N5 P4. Real-time multi-user adds complexity, so treat it as a stretch.

### 7. Agent-to-Agent Negotiated Checkout

Our buyer agent negotiates with a seller agent that we also run, standing in for a merchant with a margin floor. Each side's turns render as offer cards. On agreement, the seller agent creates the PayPal order and the buyer agent pays within its mandate. PayPal named agent-to-agent settlement explicitly as inspiration.
- **Prize targets:** Most Creative, Agentic Commerce.
- **Scores:** T4 D3 I2 N5 P5. A flashy demo but the impact case is weak. Good as a 20-second "one more thing" in the video.

### 8. Gift Concierge with Budgets per Person

"Holiday shopping for 6 people, $300 total." The agent interviews you about each recipient, curates picks on Channel3, and gives each recipient a budget sub-mandate. It checks out in one session, schedules deliveries, and tracks shipments.
- **Timing:** the hackathon ends Dec 21, so it's seasonal and gives an easy pitch.
- **Scores:** T4 D5 I3 N3 P5. A better demo *script* than standalone product; can be folded into #1 as the video storyline.

### 9. Merchant Ops Copilot (the inverse side)

The merchant chats with their PayPal business: "Why did refunds spike?" or "Accept the low-value disputes." It's AG Studio widgets plus toolkit tools for disputes, refunds, invoices, and insights.
- **Scores:** T4 D4 I3 N2 P4. ❌ Avoid as the main project: AG Grid's own idea list suggests it, so many teams will build it. A tiny merchant console in #1 (seeing agent-originated orders) is fine.

### 10. Post-Purchase Agent: returns, refunds, tracking

"Where's my order?" or "This doesn't fit, return it." The agent tracks the shipment, starts a refund (toolkit `create_refund` from our merchant side), and logs the result. Closing the commerce loop strengthens #1's design score.
- **Scores:** T4 D4 I3 N2 P3. **Include as a feature, not a product.**

### 11. Pact: group money agents in chat ⭐⭐ CHOSEN (merges #5 and #6, plus P2P)

> **A pact is a money agreement that an agent carries out for you and your people.** You write it in one sentence. Each person pre-commits their share. The agent watches for the condition and pays when it's met, even if everyone is offline.

Examples a user types into chat:
- "When the PS6 drops below $450, buy it for Sam's birthday. Me, Ana, and Leo split it, max $160 each."
  This is a **price-watch + group buy**.
- "Every 3 weeks reorder dorm supplies, split between the 4 of us."
  This is a **standing order + split**.
- "Leo owes me $42 for dinner. Remind him Friday, and if he pays, mark us even."
  This is **P2P request + settle**.
- "Pay the cleaner $80 every other Monday once two of us confirm she came."
  This is a **conditional payout with quorum**.

Each pact goes through these states:
1. `draft`: the agent turns the sentence into a structured pact and shows the PactCard.
2. `collecting`: each member taps their PayPal approval for a **capped mandate**, which is their own vaulted wallet plus a limit.
3. `armed`: the agent watches price, schedule, or quorum on the server (a Durable Object alarm). This works while everyone is offline.
4. `triggered`: policy checks run per member.
5. `settling`: the agent charges each member's share (off-session vault charge, or an approval push as a fallback), buys the item, and pays out to the organizer or payee.
6. `done`: receipts and ledger entries are written, and everyone in the thread is notified.

Why this is the strongest bet:
- **Novelty:** nobody combines conditional triggers, multi-party pre-commitment, and agent execution. Splitwise only tracks debts, price trackers only alert, and group gifting apps make everyone pay manually.
- **Agentic Commerce:** the agent actually acts while the user is away, under explicit and revocable per-person mandates.
- **Impact:** friends, roommates, families, and clubs, a large and specific audience with real pain. Who fronts the money, chasing people to pay, and missed deals all go away.
- **Design:** the whole flow fits in one chat, with live PactCards that update as members commit and conditions change.
- **Tech:** Orders v2, Vault v3, Payouts or Invoicing, webhooks, Channel3 catalog, durable timers, a policy engine, evals.

Prize targets: Grand, Best Use of Agentic Commerce, Most Creative, plus one sponsor prize (Channel3 is core; Render is an option).

**Scores:** T5 D5 I5 N5 P5 if executed well. The risks are vault behavior in the sandbox and the scope of multi-user real-time; both are covered by early spikes.

---

## Recommendation (superseded on 2026-11-01 by #11 Pact; kept for reference)

**Build #1 (Mandate) with the #2 Family persona as the story, plus #5 standing orders as the wow moment.** If time permits, add a "Caregiver" profile (#3) to show the policy engine generalizes. #10 adds post-purchase polish.

Why this combination:
- It hits all five criteria. Tech: Orders + Vault + Toolkit + webhooks + a real policy engine. Design: coherent generative UI. Impact: a specific audience with a real gap. Novelty: multi-party mandates in chat. Presentation: the split-screen parent approval is very visual.
- Prize coverage: Grand, *Best Use of Agentic Commerce*, and *Best Use of PayPal + AI*, plus **one** sponsor prize. Use Channel3 (core) and AG Grid (dashboard widget) so we qualify for both. AG Grid has the larger pool.
- Easy boxes to tick: deploy on **Render** (credits plus prize eligibility) and mention the **APIMatic** Context Plugin and the PayPal AI Toolkit in the build story.

### Must-verify on day 1 (riskiest assumptions)

1. **Vault v3 in sandbox:** save a PayPal wallet with a billing agreement, then charge off-session with no popup. If this fails, fall back to "pre-approved via one tap" (popup per purchase) and keep the policy engine.
2. **`payee` routing** to multiple sandbox merchant accounts (the multi-retailer illusion).
3. **JS SDK v6** popup works inside a chat widget (iframe/CSP, re-renders).
4. Channel3 rate limits and the image and variant data quality for the demo queries.

### 11-day plan

| Day | Date | Goal |
|---|---|---|
| 1 | Nov 1–2 | Repo + license + scaffold. Sandbox accounts. Spike the 4 must-verify items. |
| 2–3 | Nov 3–4 | Chat + tool-call → widget pipeline. Channel3 search → carousel → cart → PayPal approve → capture. |
| 4 | **Nov 5** | **Submit a draft for the early eligibility check** (hosted URL + README). |
| 5–6 | Nov 6–7 | Policy engine + mandates + vaulted auto-buy + ApprovalRequest to the second user (parent). |
| 7 | Nov 8 | Standing orders / price watch (background job) + webhook-driven chat events. |
| 8 | Nov 9 | AG Studio spend dashboard widget, refunds and tracking, polish. |
| 9 | Nov 10 | README with judge test accounts, architecture diagram, hosted demo hardening. |
| 10 | Nov 11 | Record the video (<3 min, show PayPal sandbox and model by name), write the Devpost copy. |
| 11 | Nov 12 | Buffer. Submit before **12:00pm PT**. |

### Video outline (≤ 3:00)

1. Hook and problem (0:00–0:20): "Agents can shop now. Would you hand one your card?"
2. The teen's chat: search → carousel → auto-buy within the mandate → receipt (0:20–1:00)
3. Over-limit request → parent's approval widget → capture (1:00–1:30)
4. Parent edits a rule in plain language → policy diff → saved (1:30–1:50)
5. Standing order fires while away → chat notification + dashboard (1:50–2:20)
6. Architecture slide: PayPal Orders/Vault/Toolkit, Claude, Channel3, AG Grid, Render (2:20–2:45)
7. Close with who it's for and why it matters (2:45–3:00)
