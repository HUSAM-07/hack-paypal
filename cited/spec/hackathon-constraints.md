# Constraint sheet: PayPal AI Hackathon (Devpost, online)

Sources: the Devpost home, rules, resources and sponsor pages.

## Event
- URL: https://paypalaihackathon.devpost.com/. Online, global. 18,058 registrants (2026-10-22) → expect ~1,000–2,000 submissions.
- Submission: Oct 1 – **Thu Nov 12 2026, 12:00 PT** (= 20:00 UTC). Judging Dec 1–15. Winners ~Dec 21.
- Theme: none fixed. Only hard requirement: **meaningfully use both PayPal (sandbox) and AI**. "Build an agent, an app, an automation, a new payment experience, a business tool, a social product…" PayPal family counts (Venmo, Braintree, Xoom, Honey, Zettle, Paidy, Hyperwallet…).
- Stage 1 pass/fail: fits theme + reasonably applies required APIs. Stage 2: **5 equally weighted criteria**: Technological Implementation (PayPal + AI, non-trivial), Design (complete coherent product), Potential Impact (real problem, real audience, demonstrated), Innovation/Idea (novel vs existing), Presentation (video end-to-end, problem/who/why).
- Rules note: judging "may utilize … automated AI-driven analysis" → README, description and video must be legible to an LLM grader too.
- Submission: public repo + OSS licence visible; working build (hosted URL or full run instructions incl. sandbox creds); text description; tools used; **YouTube video < 3 min** showing it working.
- New or significantly updated during the period (Oct 1 onward).

## Prizes ($69,750 total)
- Grand: 1st $12k, 2nd $8k, 3rd $5k.
- Honorable mention ($5k each): Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce.
- Sponsor: AG Grid $5k / $2k / 3×$1k; APIMatic 3×$1k + 6 mo sub; Bryntum 3×$1k; Channel3 $1.5k; Render credits $1k/$750/$500.
- **Stacking: max one Grand OR one Honorable Mention, PLUS one Sponsor prize.** Best case = $12k + $5k (AG Grid 1st) = $17k.
- APIMatic prize = used their Context Plugin for Claude Code to build the PayPal integration (near-free to qualify, but only one sponsor prize counts).

## Sponsor tech
- **AG Grid (target, user choice 2026-10-22):** AG Studio = embedded analytics (dashboards, charts, grids in one component, built-in data engine, cross-filtering, end users build dashboards without code). Prize wants **polish (custom widgets, theming, layout tools — not plain AG Grid/AG Charts) AND Studio Agent Framework (custom agent talking to Studio's built-in agents, or swapped-in harness)**. 45-day free trial. Judge: Sylwia Vargas (AG Grid). Their idea list (= anti-list): storefront analytics, anomaly-alert agent on refunds, donation dashboard, NL finance "show revenue by segment", unpaid-invoice nudge-bot.
- PayPal AI: Agent Toolkit (github.com/paypal/AI-Toolkit), PayPal MCP server, docs.paypal.ai, REST APIs (Orders, Payments, Invoicing, Subscriptions, Payouts, Disputes, Webhooks, Pay Later, Vault), JS SDK v6.
- Others (one sponsor prize only, so incidental): Channel3 (100M+ products API/MCP), KERNEL (browser infra for agents), Elastic (search/vector, Agent Builder), Render (Workflows), Bryntum (Gantt/Scheduler/Calendar), Postman, Zapier, Astropods, APIMatic.

## Judges (13)
PayPal: Jo Franchetti, Eddie Jaoude, Marco Podien (Dev Advocates), Karthik Ravi (SWE), Himraj Singh (Eng Mgr), Nathaniel Olson (Sr PM). Sponsors: Sylwia Vargas (AG Grid), Ameer Hassan (APIMatic), Mats Bryntse (Bryntum CEO), Ignacio Valdez Bicard (Channel3), Carly Richmond (Elastic), Pooja Mistry (Postman), Shifra Williams (Render).

## Team
- 3 people: full-stack/web polish, agents/MCP tooling, fintech.
- Internal dates: feature freeze Mon 9 Nov, video Tue 10 Nov, submit Wed 11 Nov (hard deadline Thu 12 Nov, 12:00 PT).
