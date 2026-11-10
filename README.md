# CITED

**PayPal's affiliate network, rebuilt for AI agents: it pays creators on proven lift, not last-click cookies.**

AI shopping agents read product tests but never click an affiliate link, so creators go unpaid when an agent buys on their verdict. CITED fixes that. Brands fund a category programme (say, air purifiers), never a verdict. In PayPal's agent catalogue (our mock of Store Sync), each shopping session randomly sees a creator's test, a placebo (other content from the same creator), or nothing; ranking never changes. A signed **Agent Affiliate Passport** rides in the PayPal Orders v2 `purchase_units[].custom_id`, so the sale joins back to its arm even at a different shop. The engine credits only the sales the test caused (80% lower bound, Shapley split across co-exposed creators), holds credits 30 days, voids them on refunds and disputes, then pays creators by batch Payouts and refunds the unspent deposit. AG Studio shows it to the brand and the creator.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Licensed [MIT](LICENSE). Everything runs with no API keys: PayPal is simulated and the shopper agents are scripted by default.

## Try it

Hosted demo (one Cloudflare Worker, `pact-worker`; Pact is the project's codename):

- <https://pact-worker.vincent-wesley-liem.workers.dev/shops>: the Northwind, Lumen and MegaMart storefronts
- <https://pact-worker.vincent-wesley-liem.workers.dev/console>: the demo console (two agents, side by side)
- <https://pact-worker.vincent-wesley-liem.workers.dev/api/cited/health>: the CITED engine's health check

### Run it locally in 3 lines

Needs Node 22+.

```bash
npm ci
npm run demo:cited     # the full demo in your terminal, 11 beats, self-checking
npm run dev:cited      # every app locally: shops, console, catalogue, agents, studio, engine
```

`npm run dev:cited` serves the shops at <http://localhost:8802> and the console at <http://localhost:8805>; each app answers `/health` (engine `:8800`, catalogue `:8801`, shops `:8802`, agents `:8803`, studio `:8804`, console `:8805`). It forces `PAYPAL_MODE=simulated` and `MODEL_PROVIDER=fake`, so no `.env` is needed. `npm run demo:cited` starts its own private stack (ports 8800 to 8805 must be free) and ends with ledger-versus-PayPal reconciliation checks. Flags: `npm run demo:cited -- --help`.

## What the demo shows

Purifier programme, price-matched, 147 scripted sessions (the same numbers as the [product card](cited/spec/CITED-card.md)):

| Beat | Result |
|---|---|
| Exposed agents buy Winix | 57 exposed sales, lift +94pp → **51 caused units** |
| Credit | 51 × $95.99 × 8% = **$391.64** credited to HouseFresh, held 30 days |
| A buyer returns one Winix | the refund webhook voids that pending credit: **−$7.68** |
| Day 30 payout | **$383.96** paid to the creator (batch Payouts); **$616.04** of Winix's $1,000 deposit returned |
| Levoit | lift bound below 0, 0 caused units: **$0** paid, the whole $1,000 returned |

Every number traces to a committed, pre-registered eval ([`packages/evals/results/cited*`](packages/evals/results)). Lumen's $4 discount, the deposits, equal Winix and Levoit prices and the Analyst approval are scripted assumptions of the demo.

## How PayPal is used

| API | Where | Use |
|---|---|---|
| Orders v2 | `apps/shops`, `apps/engine/src/programme.ts` | Shop checkout carries the signed passport in `purchase_units[].custom_id`, with `items[].upc`; brand deposits are `CAPTURE` orders |
| Webhooks | `apps/engine/src/webhooks` | Signature-verified intake; the capture is joined to its arm; refund and dispute events void pending credits |
| Payouts | `apps/engine/src/payouts.ts` | One batch to `PAYPAL_ID` recipients after the 30-day hold, split by Shapley value across co-exposed creators |
| Payments v2 `captures/{id}/refund` | `apps/engine/src/cycle.ts` | Returns each brand's unspent deposit |
| Store Sync (agent catalogue) | `apps/catalogue-mcp` | Our MCP mock of it: listings across 3 shops, per-session arm, signed passport |

Every mutating call sets a deterministic `PayPal-Request-Id`. Mode is `simulated` by default (an in-memory mock in `packages/paypal`). The deployed worker reads `CITED_PAYPAL_MODE`; locally it is `PAYPAL_MODE`. Set either to `sandbox` with the credentials from [`.env.example`](.env.example) to use the PayPal sandbox; for example `PAYPAL_MODE=sandbox npm run dev -w @cited/shops` (`npm run dev:cited` always forces simulated).

## Configuration

Defaults need no keys. [`.env.example`](.env.example) lists every variable (PayPal sandbox credentials and webhook id, `MODEL_PROVIDER`, LLM gateway, passport signing key, ports); the engine reads [`apps/engine/.dev.vars.example`](apps/engine/.dev.vars.example). Apps read `process.env`, so export what you change or run `node --env-file=.env <command>`. Checks: `npm test`, `npm run typecheck`, `npm run lint`.

## Architecture

- `packages/protocol`: the shared contract (arms, passport, credits, `Money`).
- `packages/attribution`: pure functions: attributable fraction, 80% lower bound, Shapley split, ledger rules.
- `packages/paypal`: fetch-based PayPal REST client (Orders, Payouts, webhooks) plus an in-memory mock.
- `apps/catalogue-mcp`: MCP server: `search_product`, arm assignment, signed passports.
- `apps/shops`: Northwind, Lumen and MegaMart storefronts with PayPal checkout.
- `apps/agents`: shopper agents (GPT, Gemini, Sonnet; scripted by default) and the demo runner.
- `apps/engine`: Hono + D1: webhooks, arm-checkout join, credit ledger, payouts, refunds, read API. Deployed inside `apps/worker` at `/api/cited`.
- `apps/studio`: AG Studio dashboards for brands and creators.
- `apps/console`: the demo console (two agents side by side, payout moment).
- `packages/evals`: the eval harness and committed results.

`apps/web` is placeholder code from an earlier project and is not part of CITED.

## Run the evals

```bash
npm run cited:summarize -w @pact/evals            # rebuild summary.md from committed results, no keys
npm run cited:summarize:price -w @pact/evals      # same for the price-matched study
# Re-run the sessions (needs LLM_BASE_URL and LLM_API_KEY, see .env.example):
npm run cited:run -w @pact/evals
npm run cited:run:price -w @pact/evals
```

Outputs are in `packages/evals/results/cited` and `packages/evals/results/cited-price-matched`.

## Links

- [Product card](cited/spec/CITED-card.md)
- [Workboard](cited/WORKBOARD.md)
- [Spec folder](cited/spec): [build plan](cited/spec/BUILD-PLAN.md), [demo packet](cited/spec/CITED-packet.md)
- [CITED folder overview](cited/README.md)

## License

[MIT](LICENSE), Copyright (c) 2026 Mohammed Husamuddin.
