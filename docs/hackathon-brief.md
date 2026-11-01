# PayPal AI Hackathon — Brief

Source: <https://paypalaihackathon.devpost.com/> (overview, rules, resources, FAQs, updates, 10 sponsor pages). Captured 2026-11-01.

## Key dates (Pacific Time)

| Milestone | When |
|---|---|
| Submission period | Oct 1, 2026 9:15am → **Thu Nov 12, 2026 12:00pm PT** |
| Early eligibility check (optional) | Submit by **Thu Nov 5** — review team flags problems; edits allowed until deadline |
| Judging | Dec 1 → Dec 15, 2026 |
| Winners announced | ~Dec 21, 2026 |

As of today (Nov 1) there are **11 days** left. ~26k registered participants.

## Theme

No tracks, no problem statements. One hard requirement: **the project must meaningfully use both PayPal and AI**, with PayPal integration *central*.

PayPal's "Inspiration" buckets (resources page):
1. **AI Agents / Automation:** agents that actually transact, not just recommend. Their examples are "an AI agent that shops and checks out for you" and agent-to-agent negotiation and settlement.
2. **Money movement:** phone-number send, freelancer payment dashboards, instant gig payouts, receipt-scan bill split, multi-cause donations.
3. **Business solutions:** multi-currency invoicing, creator tipping/memberships, marketplace split payments, POS add-ons.
4. **Consumer experiences:** auto-categorized budgeting, "request money" embedded in chat, simpler checkout for underserved groups (students, families, seniors).
5. **Social impact:** accessible donations, microloans for the underbanked, nonprofit payouts, community pooled funds.

## Project requirements

- Build or update an app that uses the **PayPal developer platform (free sandbox)** plus any AI tool, model, or platform. Venmo, Braintree, Xoom, Honey, Zettle, Paidy, and Hyperwallet all count as PayPal.
- Meaningfully integrate at least one PayPal API/SDK/product, and meaningfully incorporate AI.
- Must be a **working prototype**. A mockup, static prototype, or non-functional demo **fails**.
- New, or an existing project significantly updated during the period (and you must explain the update).
- You must be authorized to use any third-party API or data you integrate.

## What to submit

- [ ] Text description of features and functionality
- [ ] **Functional demo:** a hosted URL *or* complete setup/run instructions in the repo. Include sandbox test-account credentials/keys judges need, but **never commit secrets** (use env vars and give sandbox logins in the README or the submission form).
- [ ] List of AI tools/models used and how they're used
- [ ] **Public repo** (GitHub/GitLab/Bitbucket) with all source, assets, and instructions. **Open-source license detectable in the repo's About section.**
- [ ] **Demo video under 3 min**, public on YouTube, showing it running on the target device. No unlicensed music or third-party trademarks.
- [ ] Everything in English.
- Organizer tip: "Make PayPal and AI impossible to miss": name both in the description, the **Built With** field, and the video, and show them working.

## Judging

**Stage 1 (pass/fail):** fits the theme and reasonably applies the required APIs/SDKs.

**Stage 2:** five **equally weighted** criteria. Ties break in this order:

1. **Technological Implementation:** how thorough and skillful is the use of PayPal and AI? Is it non-trivial and working?
2. **Design:** a complete, coherent product experience, not just a technical PoC.
3. **Potential Impact:** a credible, *specific* real problem for a *real audience*, and the demo shows it being solved.
4. **Innovation/Idea:** novel, and different from existing concepts.
5. **Presentation:** the video shows it end-to-end and the pitch says what problem is solved, for whom, and why it matters.

Judging may use expert panels, peer review, and/or **automated AI-driven analysis**, so a clear README and description matter. Judges aren't required to run the project and may judge from the description and video alone.

Judges: 6 from PayPal (DevRel: Jo Franchetti, Eddie Jaoude, Marco Podien; Eng: Karthik Ravi, Himraj Singh; PM: Nathaniel Olson), plus one each from AG Grid, APIMatic, Bryntum, Channel3, Elastic, Postman, and Render.

## Prizes ($69,750 total)

| Tier | Prize | Amount |
|---|---|---|
| Grand | 1st / 2nd / 3rd | $12,000 / $8,000 / $5,000 |
| Honorable mention | Most Creative, Most Impactful, Best Demo Delivery, **Best Use of PayPal + AI**, **Best Use of Agentic Commerce** | $5,000 each |
| Sponsor | AG Grid 1st / 2nd / 3rd (×3) | $5,000 / $2,000 / $1,000 |
| Sponsor | APIMatic (×3) | $1,000 + 6 mo Business plan |
| Sponsor | Bryntum (×3) | $1,000 |
| Sponsor | Channel3 (×1) | $1,500 |
| Sponsor | Render 1st / 2nd / 3rd | $1,000 / $750 / $500 credits |

**Stacking rule:** at most **one Grand *or* one Honorable Mention, plus one Sponsor prize.** You can use several sponsor tools and be considered for each, but you can win only one sponsor prize.

## Sponsors — what each offers and how to access it

| Sponsor | What it is | Free access | Prize hook / relevance to a chat-commerce build |
|---|---|---|---|
| **Channel3** | One API + MCP server with normalized product data (titles, images, prices, variants, availability, buy links) for 100M+ products from 25k+ retailers | Sign up at trychannel3.com/developers, promo `PAYPAL-HACKATHON-2026` = 20k searches; top-ups in Discord | **Must actually call the API/MCP** for search, enrichment, or recs. This is the product catalog for a shopping agent. |
| **AG Grid** (AG Studio) | Embedded analytics: dashboards, charts, grids, data engine, cross-filtering, **Studio Agent Framework** (agents build and edit dashboards) | 45-day trial; boilerplate at `paypaldev/hackathon-paypal-ag-grid-boilerplate` | Rewards polish: custom widgets, theming, layout, and a custom agent talking to Studio's agents. Fits spend dashboards as in-chat widgets. **Largest sponsor pool ($10k across 5 prizes).** |
| **Bryntum** | Gantt, Scheduler, Calendar components | 45-day trial (`@bryntum/scheduler-trial`) | Timeline UIs, e.g. renewals, scheduled purchases, or an agent that reschedules on payment events |
| **Render** | Cloud hosting + **Render Workflows** (distributed task orchestration for agents/jobs) | $50 credits via claim portal | Host the demo and run long-lived/background agents (price watches, standing orders) |
| **APIMatic** | Context Plugin that feeds PayPal API context to coding agents (Claude Code etc.) | Free 1 mo Basic; winners get 6 mo Business | Easy box to tick, since we're already using Claude Code. Must mention usage. |
| **Elastic** | Elasticsearch + Jina embeddings, Agent Builder, Workflows, ES\|QL, A2A/MCP | 14-day serverless trial (+30-day self-extension) or run locally | Semantic product/purchase memory, hybrid search over orders. No sponsor prize listed. |
| **KERNEL** | Cloud headful browsers for agents, live view, durable auth | $50 credits (code `KERNELDEVPOST2026`) | Browser-use agents. ⚠️ Automating checkout on third-party retail sites raises ToS and "authorized use" risk under the rules. No prize listed. |
| **Astropods** | "Agent OS": declarative agent spec, deploy, observability, Slack connector | Free account | Agent hosting and observability. No prize listed. |
| **Postman** | API platform; official PayPal collection at postman.com/paypal | Free | Testing/docs. No prize listed. |
| **Zapier** | Zapier MCP: 9,000+ apps (incl. PayPal) for AI tools | 14-day Pro trial | Post-purchase actions (calendar, Sheets, Slack). No prize listed. |

All sponsor support runs through the **PayPal Discord** (<https://discord.gg/sJ2G6DyvSK>).

## PayPal tech we can lean on

**AI / agent tooling**
- **`@paypal/agent-toolkit`** ([GitHub](https://github.com/paypal/agent-toolkit)) works natively with the **Vercel AI SDK**, OpenAI Agents SDK, LangChain, and MCP. Tools are enabled per action in config, and `context: { sandbox: true }` turns on sandbox mode. Available tools:
  - Orders: `create_order`, `get_order`, `pay_order`, `create_refund`, `get_refund`
  - Invoices (20 tools), including recurring series, QR codes, and conditional rules
  - Subscriptions: plans plus create/update/cancel
  - Catalog: products
  - Shipment tracking
  - Disputes: list, get, accept
  - Reporting: `list_transactions`, `get_merchant_insights`
- **PayPal MCP server:** local via `npx @paypal/mcp`, or remote at `https://mcp.sandbox.paypal.com/{sse|http}`. Login-based OAuth is available on the remote server.
- **PayPal AI Toolkit** ([GitHub](https://github.com/paypal/AI-Toolkit)) is a coding-agent plugin: `/plugin install paypal@claude-plugins-official`, with commands `/paypal:setup`, `/paypal:doctor`, `/paypal:test-accounts`, and others.
- ⚠️ The toolkit is **merchant-side**: it creates orders and invoices. Buyer approval still has to happen in a PayPal UI (JS SDK v6 buttons/popup). There's no published buyer-side "agent pays" API in the sandbox.

**Payments primitives that matter for agentic purchasing**
- **Orders v2 + JS SDK v6:** create the order server-side, the user approves in a PayPal popup, then capture. This is the in-chat checkout widget.
- **Vault / Save payment methods** (Payment Method Tokens v3): save a PayPal wallet, card, or Venmo with or without a purchase, then charge **off-session**. This is what lets an agent buy without a popup *within a mandate*. Sandbox behavior needs early verification.
- **Subscriptions, Invoicing, Payouts, Pay Later, Disputes, Webhooks, Donations, Payment Links**: all listed in the resources.
- Industry context: PayPal's 2025 **Agentic Commerce Services** (Agent Ready, Store Sync) and its support for **ACP** (OpenAI Instant Checkout) and **AP2** (Google's mandate-based agent payments). AP2's "intent mandate → cart mandate" model is a good conceptual frame for fine-grained controls, and judges will recognize it.

## Webinars (recordings)

- Start building with PayPal (Oct 6): <https://www.youtube.com/watch?v=FFJfCW9z3Do>
- APIMatic Context Plugins (Oct 7): <https://youtu.be/zRWixN68tDg>
- Payments dashboard without building a dashboard (Oct 12): <https://www.youtube.com/watch?v=LGfG44i1Fj8>
- Start building with PayPal, APAC repeat (Oct 13): <https://youtu.be/ck_zyB66p_Y>

## Eligibility notes

- Age of majority required. Teams have no size cap and need one Representative. Organizations are allowed.
- **Excluded:** Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, and other OFAC-sanctioned regions. This applies to every team member. Also excluded: PayPal/Devpost staff and families, judges and their employers.
- Multiple submissions are allowed if each is substantially different.
- The project can't have had financial or preferential support from PayPal or Devpost.
- IP stays with entrants. PayPal gets a non-exclusive license for judging plus 3 years of promotional rights.
