# CITED workboard

Every build task for CITED, from [spec/BUILD-PLAN.md](spec/BUILD-PLAN.md), [spec/CITED-card.md](spec/CITED-card.md) and [spec/CITED-packet.md](spec/CITED-packet.md). Each row is a GitHub issue (label `cited`, milestone **CITED feature freeze**).

**Decision (5 Nov):** we ship CITED; Pact is a placeholder. B1 decides whether CITED reuses this repo's TS/Cloudflare scaffolding (e.g. `packages/paypal`, `packages/evals`) or follows the build plan's Go + docker layout.

**Dates:** feature freeze Mon 9 Nov · video Tue 10 Nov · submit Wed 11 Nov · hard deadline Thu 12 Nov, 12:00 PT.

Owners are suggestions from the build plan (Agents/MCP, Fintech, Full-stack). Tick a box when the issue closes.

## Backend (24)

| | ID | Task | Owner | Depends on | Issue |
|---|---|---|---|---|---|
| [ ] | B1 | Repo skeleton and one-command `docker compose up` | Fintech | — | [#1](https://github.com/HUSAM-07/hack-paypal/issues/1) |
| [ ] | B2 | PayPal sandbox apps and accounts | Fintech | — | [#2](https://github.com/HUSAM-07/hack-paypal/issues/2) |
| [ ] | B3 | PayPal mock layer from the official OpenAPI specs (env toggle) | Fintech | B1 [#1](https://github.com/HUSAM-07/hack-paypal/issues/1) | [#3](https://github.com/HUSAM-07/hack-paypal/issues/3) |
| [ ] | B4 | Creator content fixtures as structured verified-test objects | Agents/MCP | — | [#4](https://github.com/HUSAM-07/hack-paypal/issues/4) |
| [ ] | B5 | Catalogue MCP server (mock Store Sync) with `search_product` | Agents/MCP | B4 [#4](https://github.com/HUSAM-07/hack-paypal/issues/4) | [#5](https://github.com/HUSAM-07/hack-paypal/issues/5) |
| [ ] | B6 | Arm assignment and holdout schedule | Agents/MCP | B5 [#5](https://github.com/HUSAM-07/hack-paypal/issues/5) | [#6](https://github.com/HUSAM-07/hack-paypal/issues/6) |
| [ ] | B7 | Agent Affiliate Passport (signed session token) | Agents/MCP | B5 [#5](https://github.com/HUSAM-07/hack-paypal/issues/5) | [#7](https://github.com/HUSAM-07/hack-paypal/issues/7) |
| [ ] | B8 | Shopper agents (GPT, Gemini, Sonnet) | Agents/MCP | B5 [#5](https://github.com/HUSAM-07/hack-paypal/issues/5), B7 [#7](https://github.com/HUSAM-07/hack-paypal/issues/7), B9 [#9](https://github.com/HUSAM-07/hack-paypal/issues/9) | [#8](https://github.com/HUSAM-07/hack-paypal/issues/8) |
| [ ] | B9 | Shop checkout backend: Orders v2 with passport + UPC | Full-stack | B2 [#2](https://github.com/HUSAM-07/hack-paypal/issues/2), B7 [#7](https://github.com/HUSAM-07/hack-paypal/issues/7) | [#9](https://github.com/HUSAM-07/hack-paypal/issues/9) |
| [ ] | B10 | Webhook receiver with signature verification | Fintech | B2 [#2](https://github.com/HUSAM-07/hack-paypal/issues/2) | [#10](https://github.com/HUSAM-07/hack-paypal/issues/10) |
| [ ] | B11 | Real arm-checkout join (no mocked join) | Fintech | B7 [#7](https://github.com/HUSAM-07/hack-paypal/issues/7), B9 [#9](https://github.com/HUSAM-07/hack-paypal/issues/9), B10 [#10](https://github.com/HUSAM-07/hack-paypal/issues/10) | [#11](https://github.com/HUSAM-07/hack-paypal/issues/11) |
| [ ] | B12 | Attribution maths: attributable fraction at the 80% lower bound | Fintech | B11 [#11](https://github.com/HUSAM-07/hack-paypal/issues/11) | [#12](https://github.com/HUSAM-07/hack-paypal/issues/12) |
| [ ] | B13 | Multi-affiliate Shapley splitter | Fintech | B12 [#12](https://github.com/HUSAM-07/hack-paypal/issues/12) | [#13](https://github.com/HUSAM-07/hack-paypal/issues/13) |
| [ ] | B14 | Credit ledger: 30-day hold, demo time-travel clock, network fee | Fintech | B12 [#12](https://github.com/HUSAM-07/hack-paypal/issues/12) | [#14](https://github.com/HUSAM-07/hack-paypal/issues/14) |
| [ ] | B15 | Voids on refunds and disputes | Fintech | B10 [#10](https://github.com/HUSAM-07/hack-paypal/issues/10), B14 [#14](https://github.com/HUSAM-07/hack-paypal/issues/14) | [#15](https://github.com/HUSAM-07/hack-paypal/issues/15) |
| [ ] | B16 | Brand programme funding (deposits) and cap top-ups | Fintech | B9 [#9](https://github.com/HUSAM-07/hack-paypal/issues/9) | [#16](https://github.com/HUSAM-07/hack-paypal/issues/16) |
| [ ] | B17 | Creator payouts: multi-recipient batch Payouts to `PAYPAL_ID` | Fintech | B13 [#13](https://github.com/HUSAM-07/hack-paypal/issues/13), B14 [#14](https://github.com/HUSAM-07/hack-paypal/issues/14) | [#17](https://github.com/HUSAM-07/hack-paypal/issues/17) |
| [ ] | B18 | Return unspent deposit via `captures/{id}/refund` | Fintech | B16 [#16](https://github.com/HUSAM-07/hack-paypal/issues/16), B17 [#17](https://github.com/HUSAM-07/hack-paypal/issues/17) | [#18](https://github.com/HUSAM-07/hack-paypal/issues/18) |
| [ ] | B19 | Engine read API for AG Studio | Fintech | B12 [#12](https://github.com/HUSAM-07/hack-paypal/issues/12), B13 [#13](https://github.com/HUSAM-07/hack-paypal/issues/13), B14 [#14](https://github.com/HUSAM-07/hack-paypal/issues/14) | [#19](https://github.com/HUSAM-07/hack-paypal/issues/19) |
| [ ] | B20 | `eval/`: re-run the 2 pre-registered evals in-repo | Agents/MCP | B4 [#4](https://github.com/HUSAM-07/hack-paypal/issues/4), B5 [#5](https://github.com/HUSAM-07/hack-paypal/issues/5), B8 [#8](https://github.com/HUSAM-07/hack-paypal/issues/8) | [#20](https://github.com/HUSAM-07/hack-paypal/issues/20) |
| [ ] | B21 | Lock the card and packet numbers to the eval output | Agents/MCP | B20 [#20](https://github.com/HUSAM-07/hack-paypal/issues/20) | [#21](https://github.com/HUSAM-07/hack-paypal/issues/21) |
| [ ] | B22 | End-to-end run: 200 agent sessions → credits → payout → refund | Fintech | B8 [#8](https://github.com/HUSAM-07/hack-paypal/issues/8), B11 [#11](https://github.com/HUSAM-07/hack-paypal/issues/11), B15 [#15](https://github.com/HUSAM-07/hack-paypal/issues/15), B17 [#17](https://github.com/HUSAM-07/hack-paypal/issues/17), B18 [#18](https://github.com/HUSAM-07/hack-paypal/issues/18) | [#22](https://github.com/HUSAM-07/hack-paypal/issues/22) |
| [ ] | B23 | One-command demo runner (scripted scenario) | Agents/MCP | B22 [#22](https://github.com/HUSAM-07/hack-paypal/issues/22) | [#23](https://github.com/HUSAM-07/hack-paypal/issues/23) |
| [ ] | B24 | `.env.example` and run instructions | Fintech | B1 [#1](https://github.com/HUSAM-07/hack-paypal/issues/1), B3 [#3](https://github.com/HUSAM-07/hack-paypal/issues/3) | [#24](https://github.com/HUSAM-07/hack-paypal/issues/24) |

## Frontend (10)

| | ID | Task | Owner | Depends on | Issue |
|---|---|---|---|---|---|
| [ ] | F1 | Northwind storefront (Shopify-style) with PayPal checkout | Full-stack | B9 [#9](https://github.com/HUSAM-07/hack-paypal/issues/9) | [#25](https://github.com/HUSAM-07/hack-paypal/issues/25) |
| [ ] | F2 | Lumen storefront (WooCommerce-style), Winix $4 cheaper | Full-stack | B9 [#9](https://github.com/HUSAM-07/hack-paypal/issues/9) | [#26](https://github.com/HUSAM-07/hack-paypal/issues/26) |
| [ ] | F3 | MegaMart storefront with PayPal checkout | Full-stack | B9 [#9](https://github.com/HUSAM-07/hack-paypal/issues/9) | [#27](https://github.com/HUSAM-07/hack-paypal/issues/27) |
| [ ] | F4 | Demo console: side-by-side agent runs | Full-stack | B8 [#8](https://github.com/HUSAM-07/hack-paypal/issues/8), B23 [#23](https://github.com/HUSAM-07/hack-paypal/issues/23) | [#28](https://github.com/HUSAM-07/hack-paypal/issues/28) |
| [ ] | F5 | Creator payout moment (HouseFresh notification) | Full-stack | B17 [#17](https://github.com/HUSAM-07/hack-paypal/issues/17) | [#29](https://github.com/HUSAM-07/hack-paypal/issues/29) |
| [ ] | F6 | README intro from the packet | Full-stack | B24 [#24](https://github.com/HUSAM-07/hack-paypal/issues/24) | [#30](https://github.com/HUSAM-07/hack-paypal/issues/30) |
| [ ] | F7 | Public repo, OSS licence and hosted demo or run instructions | Full-stack | B24 [#24](https://github.com/HUSAM-07/hack-paypal/issues/24), F6 [#30](https://github.com/HUSAM-07/hack-paypal/issues/30) | [#31](https://github.com/HUSAM-07/hack-paypal/issues/31) |
| [ ] | F8 | Demo dry run | Full-stack | B23 [#23](https://github.com/HUSAM-07/hack-paypal/issues/23), F4 [#28](https://github.com/HUSAM-07/hack-paypal/issues/28), F5 [#29](https://github.com/HUSAM-07/hack-paypal/issues/29), G13 [#47](https://github.com/HUSAM-07/hack-paypal/issues/47) | [#32](https://github.com/HUSAM-07/hack-paypal/issues/32) |
| [ ] | F9 | Record and upload the 3-minute video | Full-stack | F8 [#32](https://github.com/HUSAM-07/hack-paypal/issues/32) | [#33](https://github.com/HUSAM-07/hack-paypal/issues/33) |
| [ ] | F10 | Devpost submission | Full-stack | F7 [#31](https://github.com/HUSAM-07/hack-paypal/issues/31), F9 [#33](https://github.com/HUSAM-07/hack-paypal/issues/33) | [#34](https://github.com/HUSAM-07/hack-paypal/issues/34) |

## AG Grid (13)

| | ID | Task | Owner | Depends on | Issue |
|---|---|---|---|---|---|
| [ ] | G1 | AG Studio trial, project setup and theming | Full-stack | — | [#35](https://github.com/HUSAM-07/hack-paypal/issues/35) |
| [ ] | G2 | Connect AG Studio to the engine read API | Full-stack | B19 [#19](https://github.com/HUSAM-07/hack-paypal/issues/19), G1 [#35](https://github.com/HUSAM-07/hack-paypal/issues/35) | [#36](https://github.com/HUSAM-07/hack-paypal/issues/36) |
| [ ] | G3 | Prototype the custom-agent handoff to built-in Data and Chart agents | Full-stack | G1 [#35](https://github.com/HUSAM-07/hack-paypal/issues/35) | [#37](https://github.com/HUSAM-07/hack-paypal/issues/37) |
| [ ] | G4 | Brand view: arm strip widget | Full-stack | G2 [#36](https://github.com/HUSAM-07/hack-paypal/issues/36) | [#38](https://github.com/HUSAM-07/hack-paypal/issues/38) |
| [ ] | G5 | Brand view: '+102 extra Winix' tile | Full-stack | G2 [#36](https://github.com/HUSAM-07/hack-paypal/issues/36) | [#39](https://github.com/HUSAM-07/hack-paypal/issues/39) |
| [ ] | G6 | Brand view: deposit meter widget | Full-stack | G2 [#36](https://github.com/HUSAM-07/hack-paypal/issues/36), B16 [#16](https://github.com/HUSAM-07/hack-paypal/issues/16) | [#40](https://github.com/HUSAM-07/hack-paypal/issues/40) |
| [ ] | G7 | Cross-Store Journey & Shapley Split master-detail grid | Full-stack | G2 [#36](https://github.com/HUSAM-07/hack-paypal/issues/36), B13 [#13](https://github.com/HUSAM-07/hack-paypal/issues/13) | [#41](https://github.com/HUSAM-07/hack-paypal/issues/41) |
| [ ] | G8 | Creator view: pending, voided, paid and co-exposure splits | Full-stack | G2 [#36](https://github.com/HUSAM-07/hack-paypal/issues/36) | [#42](https://github.com/HUSAM-07/hack-paypal/issues/42) |
| [ ] | G9 | Custom Analyst agent delegating to built-in Data and Chart agents | Agents/MCP | G3 [#37](https://github.com/HUSAM-07/hack-paypal/issues/37), G2 [#36](https://github.com/HUSAM-07/hack-paypal/issues/36) | [#43](https://github.com/HUSAM-07/hack-paypal/issues/43) |
| [ ] | G10 | Approval flow: Maya approves → cap top-up | Full-stack | G9 [#43](https://github.com/HUSAM-07/hack-paypal/issues/43), B16 [#16](https://github.com/HUSAM-07/hack-paypal/issues/16) | [#44](https://github.com/HUSAM-07/hack-paypal/issues/44) |
| [ ] | G11 | Live refund void in the grids | Full-stack | G7 [#41](https://github.com/HUSAM-07/hack-paypal/issues/41), G8 [#42](https://github.com/HUSAM-07/hack-paypal/issues/42), B15 [#15](https://github.com/HUSAM-07/hack-paypal/issues/15) | [#45](https://github.com/HUSAM-07/hack-paypal/issues/45) |
| [ ] | G12 | Dashboard layout for the video's AG Studio beat | Full-stack | G4 [#38](https://github.com/HUSAM-07/hack-paypal/issues/38), G5 [#39](https://github.com/HUSAM-07/hack-paypal/issues/39), G6 [#40](https://github.com/HUSAM-07/hack-paypal/issues/40), G7 [#41](https://github.com/HUSAM-07/hack-paypal/issues/41), G8 [#42](https://github.com/HUSAM-07/hack-paypal/issues/42), G9 [#43](https://github.com/HUSAM-07/hack-paypal/issues/43) | [#46](https://github.com/HUSAM-07/hack-paypal/issues/46) |
| [ ] | G13 | AG Studio surfaces wired into the demo runner | Full-stack | G12 [#46](https://github.com/HUSAM-07/hack-paypal/issues/46), B23 [#23](https://github.com/HUSAM-07/hack-paypal/issues/23) | [#47](https://github.com/HUSAM-07/hack-paypal/issues/47) |

## Critical path

B2 → B7 → B9 → B11 → B12 → B14 → B17 → B22 → B23 → F8 → F9 → F10. Start G3 (Studio agent handoff) and B3 (mock layer) early: they are the two biggest risks.
