# CITED

**PayPal's affiliate network, rebuilt for AI agents: it pays creators on proven lift, not last-click cookies.**

AI shopping agents read product tests but never click an affiliate link, so creators go unpaid when an agent buys on their verdict. CITED fixes that. Brands fund a category programme (say, air purifiers), never a verdict. In PayPal's agent catalogue (our mock of Store Sync), each shopping session randomly sees a creator's test, a placebo (other content from the same creator), or nothing; ranking never changes. A signed **Agent Affiliate Passport** rides in the PayPal Orders v2 `purchase_units[].custom_id`, so the sale joins back to its arm even when the agent pays a different seller. There are no storefronts: the agent checks out through PayPal itself, paying the seller's PayPal account from the wallet the buyer linked to it ([AGENT-CHECKOUT.md](cited/spec/AGENT-CHECKOUT.md)). The engine credits only the sales the test caused (80% lower bound, Shapley split across co-exposed creators), holds credits 30 days, voids them on refunds, freezes them while a dispute is open (voided if the buyer wins), then pays creators by batch Payouts and refunds the unspent deposit. AG Studio shows it to the brand and the creator.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Licensed [MIT](LICENSE). Everything runs with no API keys: PayPal is simulated and the shopper agents are scripted by default.

## Try it

Hosted demo (one Cloudflare Worker, `pact-worker`; Pact is the project's codename):

- <https://pact-worker.vincent-wesley-liem.workers.dev/>: the landing page
- <https://pact-worker.vincent-wesley-liem.workers.dev/console>: the demo console (two agents, side by side) and [`/console/payout`](https://pact-worker.vincent-wesley-liem.workers.dev/console/payout), the day-30 payout
- <https://pact-worker.vincent-wesley-liem.workers.dev/try>: run a shopping agent yourself (a live model when the host has a model key, scripted otherwise; the page says which)
- <https://pact-worker.vincent-wesley-liem.workers.dev/proof>: the pre-registered eval behind every number, with every session to download
- <https://pact-worker.vincent-wesley-liem.workers.dev/studio?view=first>: the AG Studio brand and creator dashboards, opened on the first payout
- <https://pact-worker.vincent-wesley-liem.workers.dev/creators>: creator onboarding (connect PayPal, publish a test)
- <https://pact-worker.vincent-wesley-liem.workers.dev/mcp>: the catalogue as a public MCP server (below)
- <https://pact-worker.vincent-wesley-liem.workers.dev/catalogue/offers>: the offers agents read, synced to PayPal by Northwind, Lumen and MegaMart
- <https://pact-worker.vincent-wesley-liem.workers.dev/api/cited/health>: the CITED engine's health check

### Use it from your agent

The catalogue is also a public remote MCP server, so your own agent can shop through it and the creator still gets credited only if the test caused the sale. URL: <https://pact-worker.vincent-wesley-liem.workers.dev/mcp> (Streamable HTTP, no sign-in, simulated PayPal: no real money moves). Open it in a browser for the config snippets.

```bash
claude mcp add --transport http cited https://pact-worker.vincent-wesley-liem.workers.dev/mcp
```

Claude Desktop: Settings → Connectors → Add custom connector with the URL (or `npx -y mcp-remote <url>` in `claude_desktop_config.json`). Cursor: `{"mcpServers":{"cited":{"url":"<url>"}}}`. Tools: `search_product` (offers, plus the creator content for your session's arm, with its FTC disclosure) and `checkout` (Orders v2, seller as payee, passport in `custom_id`). Each MCP session is one shopping session with its own passport. Your purchase shows at [`/api/cited/api/journeys?source=mcp`](https://pact-worker.vincent-wesley-liem.workers.dev/api/cited/api/journeys?source=mcp) with a credit verdict; these sales are kept out of the recorded demo numbers on `/console`. Limits: 60 requests a minute per IP, three orders per session.

### Run it locally in 3 lines

Needs Node 22+.

```bash
npm ci
npm run demo:cited     # the full demo in your terminal, 14 beats, self-checking
npm run dev:cited      # every app locally: console, catalogue, agents, studio, engine
```

`npm run dev:cited` serves the console at <http://localhost:8805>; each app answers `/health` (engine `:8800`, catalogue `:8801`, agents `:8803`, studio `:8804`, console `:8805`). It forces `PAYPAL_MODE=simulated` and `MODEL_PROVIDER=fake`, so no `.env` is needed. `npm run demo:cited` starts its own private stack (ports 8800 to 8805 must be free) and ends with ledger-versus-PayPal reconciliation checks. Flags: `npm run demo:cited -- --help`.

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
| Orders v2 | `apps/catalogue-mcp/src/checkout.ts`, `apps/engine/src/programme.ts` | The agent's checkout pays the seller (`purchase_units[].payee`) from the buyer's vaulted wallet (`payment_source.paypal.vault_id`), with the signed passport in `custom_id` and `items[].upc`; brand deposits are `CAPTURE` orders |
| Webhooks | `apps/engine/src/webhooks` | Signature-verified intake; the capture is joined to its arm; refund events void pending credits; a dispute freezes them until PayPal resolves it |
| Payouts | `apps/engine/src/payouts.ts` | One batch to `PAYPAL_ID` recipients after the 30-day hold, split by Shapley value across co-exposed creators |
| Payments v2 `captures/{id}/refund` | `apps/engine/src/cycle.ts` | Returns each brand's unspent deposit |
| Store Sync (agent catalogue) | `apps/catalogue-mcp` | Our MCP mock of it: offers from 3 sellers, per-session arm, signed passport, `checkout` |
| Vault (PayPal wallet) | `apps/catalogue-mcp`, `packages/paypal/src/vault.ts` | The buyer links PayPal to the agent once; every checkout charges that `vault_id` |
| Payments v2 `captures/{id}/refund` (seller) | `apps/catalogue-mcp` | A seller refunds a returned item; the refund webhook voids the credit |

The payout and the brand statement have also run once against the real PayPal sandbox with the demo's numbers: batch Payout `ME2KV57B7KYNS` ($383.96, `SUCCESS`) and invoice `INV2-TNXC-9GA6-W36V-WTF6` (`MARKED_AS_PAID`). Ids and statuses are in [cited/SANDBOX-EVIDENCE.md](cited/SANDBOX-EVIDENCE.md).

Every mutating call sets a deterministic `PayPal-Request-Id`. Mode is `simulated` by default (an in-memory mock in `packages/paypal`). The deployed worker reads `CITED_PAYPAL_MODE`; locally it is `PAYPAL_MODE`. Set either to `sandbox` with the credentials from [`.env.example`](.env.example) to use the PayPal sandbox; for example `PAYPAL_MODE=sandbox npm run dev -w @cited/catalogue-mcp` (`npm run dev:cited` always forces simulated).

## Configuration

Defaults need no keys. [`.env.example`](.env.example) lists every variable (PayPal sandbox credentials and webhook id, `MODEL_PROVIDER`, LLM gateway, passport signing key, ports); the engine reads [`apps/engine/.dev.vars.example`](apps/engine/.dev.vars.example). Apps read `process.env`, so export what you change or run `node --env-file=.env <command>`. Checks: `npm test`, `npm run typecheck`, `npm run lint`.

### Hosted worker

Reads (`GET /api/cited/api/*`, `/studio`, `/console`), `/try`, `/mcp` and PayPal webhooks are public. Every CITED write from outside (the engine's write API and the catalogue's seller refunds, mock disputes and demo clock) needs `Authorization: Bearer $CITED_API_TOKEN`; with no token set they answer `503`, never open. Locally, `CITED_OPEN_API=1` (worker `.dev.vars`) or `ENGINE_OPEN_API=1` (standalone engine, set by `npm run dev`) opts in to keyless writes; no deployed config sets it.

The deploy job pushes these GitHub secrets to the worker with `wrangler secret put`, each only when set:

- `CITED_API_TOKEN`: bearer token for CITED writes; `reseed-hosted.yml` sends it too
- `AG_STUDIO_LICENSE_KEY`: AG Studio licence key (watermark without it)
- `ANTHROPIC_API_KEY`: model key for `/try` and the Studio agents (scripted without it)

**Refreshing the hosted data.** Run the `reseed-hosted` workflow (manual only). By default it replays the demo against a local `wrangler dev` of the worker inside the job, checks the locked numbers, and swaps the CITED tables in production D1 with one atomic `wrangler d1 execute --file` (Pact's tables are never touched), so the site is never empty. It then checks the hosted API and pages (`apps/worker/scripts/verify-cited.mjs`) and fails if a number is off. `mode: replay` keeps the old wipe-and-replay path, which leaves the site empty for 10+ minutes. To build the file yourself: `node apps/worker/scripts/cited-snapshot.mjs --out cited-snapshot.sql`.

**Deploy freeze.** Set the repository variable `DEPLOY_FREEZE` to `true` to freeze the hosted demo (for example during judging): pushes to `main` still run the checks but skip the deploy, and `reseed-hosted` refuses to run. To deploy or reseed anyway, run the `ci` or `reseed-hosted` workflow manually with `force: true`. Unset it, or set it to anything else, to resume.

## Architecture

- `packages/protocol`: the shared contract (arms, passport, credits, `Money`).
- `packages/attribution`: pure functions: attributable fraction, 80% lower bound, Shapley split, ledger rules.
- `packages/paypal`: fetch-based PayPal REST client (Orders, Payouts, webhooks) plus an in-memory mock.
- `apps/catalogue-mcp`: MCP server: `search_product` over the sellers' offers, arm assignment, signed passports, and `checkout` through PayPal; the sellers' refund action.
- `apps/agents`: shopper agents (GPT, Gemini, Sonnet; scripted by default) and the demo runner.
- `apps/engine`: Hono + D1: webhooks, arm-checkout join, credit ledger, payouts, refunds, read API. Deployed inside `apps/worker` at `/api/cited`.
- `apps/studio`: the API behind the AG Studio dashboards (`/studio`, `/studio/creator`) and the Analyst; the page is `apps/web/studio.html`. See [cited/STUDIO.md](cited/STUDIO.md).
- `apps/console`: the demo console (two agents side by side, payout moment).
- `packages/evals`: the eval harness and committed results.
- Scale: [cited/BENCHMARK.md](cited/BENCHMARK.md): the engine at 50k agent sessions (8,006 signed captures at ~300/s, full recompute in 0.64 s) with the ledger reconciled to PayPal; `npm run bench:cited`.

- `apps/web`: the static pages the worker serves: the landing (`/`), `/proof` and the AG Studio page (`studio.html`), prerendered by Vite. It also still holds the original Pact chat app (`app.html`, `/app`), which CITED does not use.

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
- [Sandbox evidence](cited/SANDBOX-EVIDENCE.md): the real PayPal sandbox payout and invoice
- [Agent checkout](cited/spec/AGENT-CHECKOUT.md), [creator onboarding](cited/spec/CREATOR-ONBOARDING.md), [AG Studio](cited/STUDIO.md)
- [CITED folder overview](cited/README.md)

## License

[MIT](LICENSE), Copyright (c) 2026 Mohammed Husamuddin.
