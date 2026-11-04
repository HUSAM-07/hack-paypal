# 05 — PayPal platform and AG Studio feasibility (sponsor APIs deep-dive)

Researched 2026-10-22. Sources are primary docs (developer.paypal.com `.md` page exports, GitHub source, npm/PyPI registries, ag-grid.com docs) unless marked otherwise. Raw captures are in `research/_raw/`.
Labels: **[V]** = verified in primary docs or source code today. **[U]** = unverified or inferred, so spike it before building on it. **[3P]** = third-party source only.

Key dates (rules, `sources/j_rules.md`): submissions close **Thu 12 Nov 2026 12:00 PT**. Judging runs **1 to 15 Dec 2026**. Winners are announced around 21 Dec. The judging window affects the AG Studio trial licence (see Traps).

---

## 1. PayPal Agent Toolkit / MCP server

### Packages and repos
| Artifact | Version / state | Notes |
|---|---|---|
| `@paypal/agent-toolkit` (npm) | **1.11.0**, published 2026-09-01 [V] | TypeScript. Adapters: `ai-sdk` (Vercel AI SDK, plus a `PayPalWorkflows` helper), `openai` (Agents SDK), `langchain`, `bedrock`, `modelcontextprotocol` [V, repo tree] |
| `paypal-agent-toolkit` (PyPI) | **1.11.0** [V] | Python 3.11+. Adapters: `openai`, `langchain`, `crewai`, `bedrock` [V] |
| `@paypal/mcp` (npm, local MCP server) | **1.8.1**, last published 2025-10-28 [V] | Depends on `@paypal/agent-toolkit: "latest"` (issue #96), so the tool set you get changes underneath you. Run with `npx -y @paypal/mcp --tools=all`, env `PAYPAL_ACCESS_TOKEN`, `PAYPAL_ENVIRONMENT=SANDBOX` [V] |
| Remote MCP | Sandbox `https://mcp.sandbox.paypal.com/sse` or `/http`. Prod `https://mcp.paypal.com/...` [V] | Auth with `Authorization: Bearer <access token>` header, or an OAuth login flow. Docs say the "complete catalog of tools is available in both local and remote" [V] |
| `paypal/AI-Toolkit` | Coding-agent plugin (Claude Code / Codex / Cursor): skills, commands, hooks, and a sandbox MCP config. Pushed 2026-10-16 [V] | A dev-time aid only. It is not a runtime capability. |
| `paypal/agent-toolkit` repo | 196 stars, pushed 2026-09-01. MCP server code moved to `paypal/paypal-mcp-server` (#76) [V] | |

Sources: https://github.com/paypal/agent-toolkit · https://developer.paypal.com/ai-tools/agent-tools · https://developer.paypal.com/ai-tools/mcp-server · https://developer.paypal.com/ai-tools/toolkit · https://github.com/paypal/AI-Toolkit

### Full tool list (from `typescript/src/shared/tools.ts`, 48 tools) [V]
Each tool maps to a REST call I read in `functions.ts`.

**Invoicing (22)** — `/v2/invoicing/*`
`create_invoice`, `list_invoices`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `cancel_sent_invoice`, `delete_invoice`, `generate_invoice_qr_code`, `generate_invoice_number`, `search_invoicing` (invoices or recurring series), `update_invoicing` (full replace), `setup_invoice_auto_reminders`, `update_invoice_auto_reminder`, `cancel_invoice_auto_reminder`, `record_payment_for_invoice`, `record_refund_for_invoice`, `create_conditional_rules_for_invoice` (early-pay discount, auto-cancel date), `create_recurring_series`, `activate_recurring_series`, `get_recurring_series`, `cancel_recurring_series`, `delete_recurring_series`.

**Payments (5)**
`create_order` (POST `/v2/checkout/orders`), `get_order`, `pay_order` (POST `/v2/checkout/orders/{id}/capture`, **captures with no confirmation step**, issue #82), `create_refund` (POST `/v2/payments/captures/{id}/refund`), `get_refund`.

**Disputes (3)**
`list_disputes`, `get_dispute`, `accept_dispute_claim`. There is **no** `provide_evidence`, `make_offer`, `escalate`, `send_message`, or `appeal` tool.

**Shipment tracking (3)** — `/v1/shipping/trackers*`
`create_shipment_tracking`, `get_shipment_tracking`, `update_shipment_tracking`.

**Catalog (4)**
`create_product`, `list_products`, `update_product`, `show_product_details`.

**Subscriptions (8)**
`create_subscription_plan`, `list_subscription_plans`, `show_subscription_plan_details`, `update_plan`, `create_subscription`, `show_subscription_details`, `update_subscription`, `cancel_subscription`.

**Reporting / insights (2)**
`list_transactions` (GET `/v1/reporting/transactions`), `get_merchant_insights` (GET `/v1/merchant/insights?insight_type=ORDERS|SALES&time_interval=DAILY..YEARLY`). Whether `/v1/merchant/insights` returns data in sandbox is [U].

**Remote-MCP-only "commerce" tools (3)**: `search_product`, `create_cart`, `checkout_cart`. These are **gift cards only** and enabled with the header `x-feature-flags: commerce:true`. The docs example uses the **production** URL. Sandbox availability is [U]. Source: https://developer.paypal.com/ai-tools/agent-tools#additional-tools-for-remote-mcp-server

Small inconsistencies: Python names one tool `get_order_details` where TS uses `get_order`. The Python list lacks `create_refund`, `get_refund`, `update_product` and `update_plan` [V]. The docs table says `list_product` and `list_transaction` (singular) where the code uses plural names.

**What the toolkit does NOT cover** (gaps we could fill and contribute upstream): Payouts (PR #107 is open and unmerged), Vault v3 / payment tokens, authorize/void/reauthorize, dispute evidence/offer/escalate/appeal, webhooks, Partner Referrals and multiparty `platform_fees`, Transaction Search balances and summaries, Braintree, and negative testing. Open issues #95, #98, #104 and #105 ask for spend bounds, a human gate, per-call `PayPal-Request-Id` idempotency, and host-side attestation for mutating tools. **Here is a non-shallow niche: a policy-enforced, idempotent, auditable "agent payment firewall".** PayPal's own issue tracker shows the gap exists (issue dates 2026-08-29 to 2026-09-18).

---

## 2. What works in SANDBOX

| Product | Sandbox status | Evidence / how |
|---|---|---|
| **Orders v2** create / authorize / capture / patch | Works [V] | Buyer approval for the PayPal wallet requires a buyer to log in at `sandbox.paypal.com`, so it is not purely API. **Card payments can be fully headless**: send `payment_source.card` with a test PAN in create-order (doc: /api/orders-v2/save-with-purchase/cards). Card-processing eligibility depends on country (US OK) [V, /expanded/eligibility] |
| **Payments v2** authorize/capture/void/reauth/refund | Works [V] | Negative testing with the `PayPal-Mock-Response` header on authorizations-get/capture/void, captures-get/refund, refunds-get, and orders create/patch/get/authorize/capture (/negative-testing/request-headers) |
| **Card test data** | Rich [V] | 19 static test PANs plus a generator. Rejection triggers go in the cardholder name: `CCREJECT-REFUSED` (0500), `-SF` (9500 suspected fraud), `-EC`, `-IRC`, `-IF`, `-LS`, `-IA`, `-BANK_ERROR`, `-CVV_F`. 3DS scenarios are available (/sandbox-testing/card-testing) |
| **Vault v3** (setup-tokens to payment-tokens, then `vault_id` in orders = merchant-initiated charges) | Works in sandbox [V] | App setting: Accept payments, then Advanced, then Vault. Card vaulting: no-verification, smart-auth and 3DS variants (/api/save-with-purchase/test-integration). **PayPal-wallet vault (reference-transaction style)**: docs say "You must be approved and have your account configured for billing agreements… Contact your account manager". Sandbox may be pre-enabled [U]. Card vault is the safe path. |
| **Subscriptions** | Works [V] | Product, then plan (ACTIVE), then subscription, then buyer approval. Negative test values `ERRSUB###`. Renewal cycles run in sandbox. "Accelerate via Dashboard" is from AI-Toolkit [3P-ish, U] |
| **Invoicing** | Works [V] | Full API including recurring series, reminders, conditional rules, QR. The sandbox never emails real addresses. |
| **Payouts** | Works [V] | POST `/v1/payments/payouts`. Simulated outcomes via `items[0].note` codes: `ERRPYO001..040` (SENDER_RESTRICTED, INSUFFICIENT_FUNDS, RATE_LIMIT_VALIDATION, CIP_NOT_VERIFIED…). `POSPYO003` gives a Venmo receiver 201. Simulator receiver `payouts-simulator-receiver@paypal.com`. Recipient types EMAIL/PHONE/PAYPAL_ID/VENMO_HANDLE (/api/payouts/test-go-live). Production needs Payouts enablement. In sandbox, create a Merchant app [V] |
| **Disputes** | **Fully simulatable via API** [V], see §2a | |
| **Transaction Search / Reporting** | Works, with caveats [V] | Enable the "Transaction search" app feature (the boilerplate README says so). **Max 31-day window per call. Up to 3 hours before new transactions appear. Rejects fractional seconds in practice** (boilerplate README). Endpoints: `/v1/reporting/transactions`, `/balances`, `/get-balance-net-summary`, `/get-daily-summary`. T-codes classify events. `balance_affecting_records_only=N` returns everything. SFTP reports (settlement, disputes custom, etc.) have specs, but sandbox delivery is [U] |
| **Webhooks** | Works [V] | Up to 10 URLs per app. Retries 25 times over 3 days. Verify via `/v1/notifications/verify-webhook-signature` or CRC32. Simulator: Dashboard plus `POST /v1/notifications/simulate-event`. **Simulated events carry `webhook_id: "WEBHOOK_ID"` and cannot be signature-verified, and they do not appear in delivery history.** `POST /v1/notifications/webhooks-events/{id}/resend` replays real signed events. You need public HTTPS (no localhost) [V, AI-Toolkit webhook-sandbox.md + /api/webhooks/overview] |
| **Pay Later** messaging and offers | Messaging renders. In the buyer window, US Pay in 4 shows for $30 to $1,500 and Pay Monthly for $199 to $10,000. **Installment billing is not simulated, only the initial capture** [AI-Toolkit, U-ish] | /pay-later/overview |
| **Partner / Marketplace (multiparty)** | **Sandbox works before partner approval** [V]: "You can call and test the PayPal Complete Payments Platform APIs with your sandbox credentials before you are approved" (live calls 401 until approved). Create the app with Type=Platform. Partner Referrals v2 (`/v2/customer/partner-referrals`) returns a one-time `action_url`. `PayPal-Auth-Assertion` lets you act on behalf of a seller. `platform_fees` needs sellers onboarded with PARTNER_FEE. Multi-seller orders allow **max 10 purchase_units** with a 20 s timeout. Delayed disbursement is supported. Embedded onboarding CIP failure triggers use `DECLINED` in names. The doc also says "share your sandbox Client ID with your PayPal account manager to configure your sandbox", so some fee features may need PayPal-side config [U] |
| **Venmo (PayPal checkout)** | Partial [V] | US only, `buyer-country=US`. Supported: app-switch, web login flow (for non-US devs), one-time checkout, vault setup, risk errors by amount (12.34 INSUFFICIENT_FUNDS, 21.43 ACCOUNT_CLOSED, 11.45 FROZEN, 10.23 SUSPECTED_FRAUD, 13.42 GENERIC_DECLINE). **Not supported: vault subsequent purchases, self-service test accounts, feed/ledger, settlement, disputes, merchant reporting**. Desktop QR is unavailable in sandbox (/venmo/test) |
| **Braintree sandbox** | Free self-serve signup at `apply.braintreegateway.com/signup/sandbox` [3P + Braintree help]. It is separate from PayPal developer sandbox accounts. | Fraud: card `4111140000000002` gives Review (FPA only), `4000111111111511` gives gateway_rejected fraud, `4111130000000003` gives risk_threshold. Nonces `fake-gateway-rejected-kount-nonce` etc. [V]. Amount-driven processor/settlement responses. `gateway.testing.settle()`. **Disputes: card `4023898493988028` creates an instantly disputed settled sale. Text evidence `compelling_evidence` wins and `losing_evidence` loses, then finalize** [V]. Venmo disputes and a mocked PayPal flow also exist. Warning: FPA starts rejecting if you hammer it with many cards [V] |
| **Hyperwallet** | Developer Sandbox: **anyone can self-register** at portal.hyperwallet.com and gets auto-generated REST credentials, with no inbound IP restriction [V, docs.hyperwallet.com environments]. UAT/prod are client-only. Counts as PayPal family under the rules | |
| Xoom / Honey / Zettle / Paidy | No hackathon-usable public sandbox found [U]. Do not plan on them. | |
| **Agent Ready / ACP / Store Sync** (agentic commerce) | **Early access, request via form** [V, /agentic-commerce-services/about]. ACP requires Braintree delegated tokens plus a publicly hosted MCP server. Treat it as not available in a 3-week window unless PayPal DevRel unlocks it via Discord. | |

### 2a. Disputes in sandbox — the most under-used capability [V]
Source: https://developer.paypal.com/disputes/test-go-live (101 KB page) and /disputes/set-up, /disputes/reasons-evidence.
- **Create a dispute by API (sandbox-only)**: `POST /v1/customer/disputes` (multipart, `input` JSON) with a `PayPal-Auth-Assertion` header. In the doc sample it is an unsigned JWT `{"alg":"none"}` with `{"iss": <client_id>, "email": <buyer sandbox email>}`. Body: `disputed_transactions[].buyer_transaction_id`, `reason`, `dispute_amount`, `extensions`. **This means disputes can be seeded programmatically.** The open question [U] is how to get the buyer-side transaction ID headlessly (doc: log in as buyer and copy it). Spike: try the capture ID, or Transaction Search with the buyer's auth assertion.
- **Create a chargeback (sandbox-only)**: `POST /v2/customer-support/process-chargeback` (`adjacency: PAYPAL`, `file_layout: ATCK_CB`, `financial_institution.processor: FDMS`, `instrument_type: CARD`). Card-funded transactions only.
- **Change reason (buyer)**: `POST /v1/customer/disputes/{id}/change-reason`.
- **Buyer accepts or denies merchant offer**: `/accept-offer`, `/deny-offer`.
- **Simulate PayPal's decision**: `POST /v1/customer/disputes/{id}/adjudicate` with `BUYER_FAVOR` or `SELLER_FAVOR` (status must be UNDER_REVIEW with an `adjudicate` HATEOAS link). `POST .../require-evidence` moves the dispute to the evidence-required state.
- **Merchant side** (works in sandbox): send-message, make-offer (REFUND / REFUND_WITH_RETURN / REFUND_WITH_REPLACEMENT / REPLACEMENT_WITHOUT_REFUND), provide-evidence (PROOF_OF_FULFILLMENT with tracking, PROOF_OF_REFUND with refund ids, OTHER with notes and documents), accept-claim, escalate, **appeal** (buyer email containing `allowappeal` or `noappeal` toggles eligibility; one appeal per party).
- **Accelerated Response**: put the note `ACCELERATED_RESPONSE_ENABLED` in evidences. Transaction amount picks the escalation day (5.00–5.99 gives Day 5, 9.00–9.99 gives Day 9, 11.00 or more gives Day 11). Applies to SNAD and INR.
- Five chargeback scenarios (with or without provisional credit × win or lose). Webhooks: `CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED` fire in sandbox. Actions become available a few minutes after creation.
- Evidence requirements per reason are documented (INR, SNAD, UNAUTHORISED, CREDIT_NOT_PROCESSED, DUPLICATE, INCORRECT_AMOUNT…). That gives a deterministic target schema for an evidence-assembly agent.
- Prereq: the app's "Customer disputes" add-on is checked by default.

---

## 3. Rate limits, quirks, seeding realistic data

- **Rate limits are deliberately unpublished** [V, /api/rate-limiting]: "PayPal doesn't publish exact rate limits because they vary". Throttling returns 429 `RATE_LIMIT_REACHED`. Triggers include polling, spikes, **re-minting OAuth tokens per request**, and suspicious patterns. Cache tokens: sandbox tokens last 3 to 9 h (`expires_in: 32400` in the sample) [V]. Payouts: "400 POST/min" per the AI-Toolkit skill [3P, U].
- **Sandbox accounts**: create them one at a time in the Dashboard (Personal/Business, any country, custom balances). **Bulk upload takes up to 40 accounts per file** (UTF-16LE CSV: country, type, email, password, names, `ppBalance` 0–100000, `addBank`, `ccType`, `payment_card`). There is also "duplicate account". No public API creates sandbox accounts [V, /sandbox-testing/bulk-accounts]. In practice the team can create a few hundred accounts in about an hour of manual uploads. That is plenty.
- **Seeding transactions headlessly**:
  1. Card orders (`payment_source.card`, test PANs, rejection triggers for declines) produce captures, refunds, partial refunds and declines with no browser. This is the backbone for volume. [V for the API shape. Card-processing enablement on a default sandbox business account is U, likely fine for US.]
  2. Vaulted cards plus `vault_id` produce recurring MIT charges with no browser [V].
  3. PayPal-wallet orders need buyer approval in a browser. Automate it with Playwright, or with **KERNEL cloud browsers (sponsor synergy)** [U on ToS/CAPTCHA].
  4. Payouts with simulator codes produce payout successes and failures [V].
  5. Invoices plus `record_payment_for_invoice` give invoice lifecycles without real payment [V].
  6. Disputes via the sandbox create/adjudicate endpoints [V, buyer-txn-id caveat].
  7. Braintree: amount-driven outcomes, `testing.settle`, dispute card. Very fast for volume.
- **Transaction Search lag (up to 3 h)** means a "live" dashboard must source from webhooks or our own ledger, not just from reporting. Seed data at least a day ahead of the demo recording.
- **Idempotency**: send a unique `PayPal-Request-Id` per mutating call. The agent toolkit does NOT do this per call (issue #98). Wrap it ourselves.
- **Timestamps**: you cannot backdate transactions. A "12-month history" demo must be generated over the 3 weeks, or blended with clearly labelled synthetic data in our own warehouse. Transaction Search only goes back 3 years and 31 days per call [V].

---

## 4. AG Studio Agent Framework (sponsor target)

Sources: https://www.ag-grid.com/studio/react/ai-agents/ · /ai-builtin-agents/ · /ai-custom-agents/ · /ai-harness/ · /ai-custom-harness/ · /ai-direct-llm-runner/ · /ai-client-tool-runner/ · /ai-custom-runner/ · /ai-tools/ · /ai-tools-builtin/ · /ai-tools-external/ · /ai-tool-components/ · /ai-webmcp/ · /licence-install/ · /studio/license-pricing/ · blog 2026-09-28 https://www.ag-grid.com/blog/introducing-the-ag-studio-agent-framework/

- **Packages**: `ag-studio` + `ag-studio-react` **v3.0.0**, licence "Commercial" [V npm]. **Framework pages exist for React, Angular, Vue and vanilla JS** (all quick-start URLs return 200) [V]. Enable AI by passing `modules={[AgStudioAiModule]}` to `<AgStudioProvider licenseKey=…>` (boilerplate `dashboard.tsx`) [V].
- **No model, no servers, nothing sent to AG Grid.** You supply an `AgLlmAdapter` with one method, `executeTurn(request, {signal})`, which returns `{ stream (async iterable of AgAiEvent), complete }`. The request carries conversation items, instructions, tool schemas, toolChoice, format, and an optional model selection [V].
- **Event protocol = AG-UI** (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_START/ARGS/END/RESULT`, `REASONING_MESSAGE_*`, `RUN_ERROR`, `RAW`, `CUSTOM`). These are hand-declared types, structurally compatible, with no `@ag-ui/*` dependency [V].
- **Agent contract**: `{ id, name?, description, schema(s) (delegation params), instructions() (re-resolved per run), tools() (re-resolved per run), prefetch tools, maxTurns (default 100), run? }` [V].
- **Three runners** [V]:
  - `directLlmRunner({id, adapter, instructions, tools})`: Studio owns the loop and runs it in the browser.
  - `clientToolRunner({id, run: async function*(input, ctx)})`: your server answers each round and Studio executes the browser-side tools you emit calls for. **This is the natural bridge to a Go/Next backend agent holding PayPal credentials.**
  - Custom `{...def, run}`: you own the loop, run boundaries and telemetry. Docs explicitly cover wrapping the AI SDK or CopilotKit.
- **Built-in agents (5)** [V]: **Lead** (coordinator: view_schema, view_report, view_page, view_plan, update_plan, clear_plan, rename_thread, delegate_to), **Planning** (create_plan), **Data** (execute_query, create/update/delete_expression), **Page** (add/position/remove_widget, add/remove_page_filter), **Widget** (configure_widget parameterised by widgetType/widgetId, plus widget filters). Widget agents run concurrently, one per widget. The plan is a durable artefact on the thread.
- **Built-in tools**: `api.getAiTools()` returns 15 Studio tools plus harness tools (plan.*, delegateTo). Custom tools come from `api.defineAiCommand` + `api.defineAiTool({command, result})`. External tools use `kind: 'server' | 'provided'`. Tool schemas are live functions and can be uncallable (`schema()` returns undefined). Results are `ctx.success/error` and are never thrown [V].
- **"Custom agent talking to built-in agents"**: declare your own lead with `tools.delegateTo(['data','page','planning','widget','paypal-ops', …])` and spread `builtIn` into the roster. The built-in lead delegates only to its fixed ids, so it will not discover new agents. You need your own lead [V].
- **"Swapped-in harness"**: implement `AgAiHarness`: add/removeEventListener, `agents`, `models`, `threads`, `promptStarters`, getAgent/getThread/openSession/createThread/deleteThread/getOpenSession/setThreadModel/destroy. **Studio's chat panel still renders it**, because it only reads the session surface. You then own persistence, plan store and delegation, and get no harness-owned tools [V].
- **Chat UI extras**: per-tool `label` + `detail` React components, with an **`awaiting_approval` phase** (so human-in-the-loop approval of a payment action can render natively in the panel) [V]. A model picker, prompt starters, and an observer stream for metrics, cost meters and **evals** [V].
- **WebMCP bridge**: expose Studio tools to browser agents via `registerTool`. The doc example publishes 4 read-only tools [V]. Novel angle: a judge's own browser agent can query the dashboard.
- **Custom data engine**: replace the built-in engine to push queries to a backend (doc example uses AlaSQL) [V]. You could point it at a Go service over our PayPal ledger.
- **Licence**: "You can test AG Studio locally without a licence" (watermark plus console warnings). The **45-day enterprise trial** removes the watermark, allows "testing in production", and includes the Agent Framework [V]. A public hosted demo is OK under the trial. The key sits in the frontend bundle, which is normal for AG products.
- **PayPal x AG Grid boilerplate** (https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate, pushed 2026-10-12): Next.js, plain-fetch PayPal client with token cache, paging and retry, five data pages, AG Studio dashboard, OpenAI adapter, `/api/ai/responses` proxy. **Its AI route has no auth or rate limiting**, so add both before hosting publicly. Many teams will start from it. Differentiate well beyond it.

---

## 5. Under-used but powerful (ranked by leverage for a technically impressive build)

1. **Dispute lifecycle simulation + Evidence API** (§2a). Full buyer, merchant and PayPal-adjudicator control in sandbox, chargebacks, appeals, accelerated response, evidence schema per reason. Almost no hackathon project goes past `list_disputes`. Pairs with Braintree's deterministic dispute card plus `compelling_evidence`.
2. **Agent-safety gap in PayPal's own toolkit**: no spend bounds, no human gate, non-idempotent capture, `@paypal/mcp` floating on `latest` (issues #82, #95, #96, #98, #104, #105). A policy/attestation layer is real infrastructure with merit outside the hackathon and could go upstream.
3. **Multiparty / Partner Referrals in sandbox without approval**: seller onboarding links, `PayPal-Auth-Assertion`, `platform_fees`, up to 10-seller orders, delayed disbursement. Marketplace money-movement logic is non-trivial and rarely demoed.
4. **Vault v3 merchant-initiated charges**: headless recurring and usage-based billing with cards. This enables agents that actually transact after one consent.
5. **Payouts with deterministic failure simulation** (ERRPYO codes) plus Venmo handles. Lets an agent's retry and repair logic be tested and demoed reproducibly.
6. **Transaction Search T-codes + balance/daily summaries** give a real double-entry-ish ledger for reconciliation agents. Most teams only read `/v2/checkout/orders`.
7. **Negative testing** (`PayPal-Mock-Response`, card `CCREJECT-*` triggers, Venmo risk amounts, subscription `ERRSUB`). This allows **eval suites** for payment agents: inject failures, measure recovery. That fits the team's LLM-eval strength.
8. **Risk signals**: `PAYPAL-CLIENT-METADATA-ID` (FraudNet), `supplementary_data.risk.customer.ip_address`, Braintree Kount decisions (Review / gateway_rejected). The FPA dashboard itself is a business-tools UI with no public API [V], so do not promise risk-score APIs.
9. **Add-Tracking API**: tracking data feeds seller protection and dispute outcomes (PROOF_OF_FULFILLMENT).
10. **Hyperwallet self-serve sandbox**: global payouts to bank, card and wallet. Almost certainly no other team uses it.
11. **Webhook resend** (`/webhooks-events/{id}/resend`) for deterministic replay of real signed events in a demo.

---

## HARD CAPABILITIES WE CAN RELY ON
- Orders v2 create/authorize/capture/void/refund in sandbox, **headless with test cards**. Declines are triggerable by cardholder-name codes.
- Vault v3 card tokens and `vault_id` charges (MIT) in sandbox.
- Subscriptions, Invoicing (incl. recurring, reminders, conditional rules, record payment), Catalog, Shipment tracking.
- Payouts API with deterministic success and error simulation codes.
- **Disputes end-to-end by API** (create, change reason, chargeback, offers, evidence, escalate, adjudicate, appeal) plus dispute webhooks.
- Webhooks with signature verification, dashboard/API simulator, and resend.
- Transaction Search (31-day window, ≤3 h lag) plus balances and summaries.
- Multiparty/Partner Referrals/`platform_fees` callable in sandbox before partner approval.
- Agent toolkit (48 tools, TS + Python, AI SDK/OpenAI/LangChain/CrewAI/Bedrock/MCP), local MCP via npx, remote sandbox MCP at mcp.sandbox.paypal.com.
- Braintree sandbox (self-serve) with fraud-decision test cards and an instant-dispute card with a win/lose evidence switch.
- AG Studio v3 with the Agent Framework: 5 built-in agents, 3 runner types, swappable harness, AG-UI events, custom tools and widgets, approval-phase tool UI, WebMCP. Supports React, Angular, Vue and JS. The 45-day trial covers a hosted demo.

## TRAPS
1. **AG Studio trial is 45 days and judging ends 15 Dec.** A trial started on 22 Oct expires around 6 Dec, mid-judging, and the hosted demo could fall back to a watermark. **Start the trial on or after about 1 Nov** (expires about 16 Dec), or ask AG Grid on Discord for a hackathon key. Unlicensed still works locally with a watermark.
2. **Transaction Search lag (up to 3 h) and 31-day window.** Do not build a "real-time" view on it. Use webhooks plus our own ledger. Seed early.
3. **PayPal-wallet buyer approval needs a browser login.** Only card and vault flows are fully headless. Plan seeding accordingly.
4. **Venmo sandbox is thin**: no vault reuse, disputes, settlement or reporting, and no self-serve test accounts. Venmo as a centrepiece is risky. Venmo payouts (simulated) are fine.
5. **Agentic commerce (Agent Ready / ACP / Store Sync) is gated early access.** Remote-MCP commerce tools are gift-card-only, flag-gated, and documented on the production URL. Do not depend on them.
6. **Toolkit safety holes**: `pay_order` captures immediately, there are no per-call idempotency keys, and `@paypal/mcp` pins `latest`. Pin versions, and wrap mutating tools with our own guard and `PayPal-Request-Id`.
7. **Rate limits are unpublished**, and FPA/Braintree start rejecting rapid repeated test cards. Cache OAuth tokens, throttle seeding, and spread it over days.
8. **Simulated webhooks can't be signature-verified** (fixed `WEBHOOK_ID`). Demo verification only with real events or resend. Webhooks need public HTTPS.
9. **PayPal-wallet vault (reference transactions) may require account-manager enablement** per docs. Use card vault as the guaranteed path [U for sandbox].
10. **Platform fees may need PayPal-side sandbox config** ("share sandbox client ID with account manager"). Verify `platform_fees` on day 1, or fall back to multi-seller split without fees.
11. **Buyer transaction ID for API-created disputes**: the docs show copying it from the buyer UI. Headless retrieval is [U]. Spike on day 1.
12. **Boilerplate AI proxy has no auth or rate limit.** A public demo can burn the LLM key. Add per-IP limits and a budget cap.
13. **Sandbox and dashboard identities are confusing**: developer.paypal.com login, sandbox.paypal.com test logins, and a separate Braintree sandbox login. Document all of it in the README for judges (rules require test creds or run instructions).
14. **Many teams will fork the AG Grid boilerplate** (a revenue/invoice dashboard with chat). A plain "NL to widget over PayPal data" project is a commodity. The custom-agent/harness depth must be visible in the video.

## Day-1 spikes (each 30–60 min)
- Card `payment_source` create+capture on the default sandbox business account (confirms headless volume).
- `POST /v1/customer/disputes` with a buyer auth-assertion JWT, then `adjudicate` (confirms dispute seeding). Test whether the capture ID is accepted as `buyer_transaction_id`.
- `platform_fees` on a Platform-type app with a Partner-Referrals-onboarded seller.
- `GET /v1/merchant/insights` in sandbox.
- AG Studio: `clientToolRunner` streaming from our backend plus a custom lead delegating to built-ins.
