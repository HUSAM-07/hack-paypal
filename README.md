# CITED

**PayPal's affiliate network, rebuilt for AI agents: it pays creators on proven lift, not last-click cookies.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Runs locally with no API keys: PayPal is simulated and the shopper agents are scripted by default.

## Problem

US affiliate spend ($13.81B/year, eMarketer) pays per click. AI shopping agents read creators' tests but never click. Meta's Muse sold on Vacuum Wars' tests, unpaid (Fast Company, 13 Oct 2026).

## Who it is for

US product-testing creators and the brands they review.

## What it does

Agent Search Optimisation measurement, not ads.

- Brands fund a category programme (say, purifiers), never a verdict. Creators pick rivals and write verdicts.
- In PayPal's agent catalogue, sessions randomly get the test, a same-creator placebo, or nothing: 50/50 for a new test's first 7 days, then a permanent 5% holdout. Only the test is withheld; organic reviews remain; ranking never changes. Agents reading the test elsewhere only shrink measured lift, so pay is a conservative floor.
- Creators earn 8% on units the test caused (cautious 80% lower bound); $0 on no lift. Each brand pays only for its own lifted units, so an honest "buy the rival" verdict still earns. Credits are held 30 days and voided on refunds and disputes.
- Only PayPal combines an affiliate network (Honey), the agent catalogue (Store Sync) and creator Payouts to PayPal/Venmo. PayPal earns a network fee plus settlement volume.

## Evidence

Every number comes from a committed, pre-registered eval ([`packages/evals/results/cited*`](packages/evals/results), pre-registrations in [`packages/evals/scenarios/cited`](packages/evals/scenarios/cited)). Three models (GPT, Gemini, Sonnet), 963 sessions across the studies. Labels: **measured** = observed in the eval, **derived** = computed from measured numbers, **scripted** = a fixed assumption of the demo.

- **Measured, price-matched (headline; Levoit priced like Winix at every shop):** purifiers, 147 forced-buy sessions. Winix share: exposed 57/57 (100%), placebo 3/54 (6%), nothing 3/36 (8%). Lift +94pp (80% lower bound +90.3pp), positive in all three models. Agents otherwise default to Levoit and flip when shown a test that names Winix, so this mostly measures deference to an explicit verdict. With Levoit $4 cheaper: +96pp (bound +92.6pp). Abstain allowed: +82pp (bound +77.2pp).
- **Measured, Winix already cheaper (catalogue prices):** 147 sessions, share 100% / 76% / 69%, lift +24pp (bound +18.8pp). Price decided most picks, so exposure had little to add. Narrow verdict (81 sessions): lift 0, bound −6.0pp, $0.
- **Derived:** 57 exposed sales × 90.3% = 51 units × $95.99 × 8% = $391.64 to the creator; $608.36 of the $1,000 deposit returns.
- **Scripted:** Lumen's $4 discount, the $1,000 deposit, equal Winix and Levoit prices, the Analyst approval.

Full details and caveats: [`cited/spec/CITED-card.md`](cited/spec/CITED-card.md).

## Run it in 3 lines

Needs Node 22+.

```bash
git clone https://github.com/HUSAM-07/hack-paypal.git && cd hack-paypal
npm ci
npm run dev:cited      # no .env needed: PAYPAL_MODE=simulated, MODEL_PROVIDER=fake
```

Then open the shops at <http://localhost:8802> (Northwind, Lumen, MegaMart). Health checks: engine `:8800`, catalogue `:8801`, shops `:8802`, agents `:8803`, studio `:8804` (`curl localhost:<port>/health`).

Coming from open PRs: `npm run demo:cited` (one-command demo runner, `apps/agents`) and the demo console (`apps/console`).

Checks: `npm test`, `npm run typecheck`, `npm run lint`.

### Configuration

Defaults need no keys. [`.env.example`](.env.example) lists every variable (PayPal sandbox credentials and webhook id, `PAYPAL_MODE=simulated|sandbox`, `MODEL_PROVIDER`, LLM gateway, passport signing key, ports); the engine reads [`apps/engine/.dev.vars.example`](apps/engine/.dev.vars.example). Apps read `process.env`, so export what you change or run `node --env-file=.env <command>`. `npm run dev:cited` always forces simulated mode; to try the PayPal sandbox run one app, for example `PAYPAL_MODE=sandbox npm run dev -w @cited/shops`.

## Architecture

- `packages/protocol`: the shared contract (arms, passport, credits, `Money`).
- `packages/attribution`: pure functions: attributable fraction, 80% lower bound, Shapley split, ledger rules.
- `packages/paypal`: fetch-based PayPal REST client (Orders, Payouts, webhooks) plus an in-memory mock.
- `apps/catalogue-mcp`: MCP server (our mock of Store Sync): `search_product`, arm assignment, signed passports.
- `apps/shops`: Northwind, Lumen and MegaMart storefronts with PayPal checkout.
- `apps/agents`: shopper agents (GPT, Gemini, Sonnet; scripted by default).
- `apps/engine`: Worker (Hono + D1): webhooks, arm-checkout join, credit ledger, payouts, refunds, read API.
- `apps/studio`: AG Studio dashboards for brands and creators.
- `packages/evals`: the eval harness and committed results.

`apps/web` and `apps/worker` are placeholder code from an earlier project (Pact) and are not part of CITED.

## PayPal APIs used

| API | Where | Use |
|---|---|---|
| Store Sync (agent catalogue) | `apps/catalogue-mcp` | Our MCP mock of it: listings across 3 shops, per-session arm, signed Agent Affiliate Passport |
| Orders v2 | `apps/shops`, `apps/engine/src/programme.ts` | Shop checkout carries the passport in `purchase_units[].custom_id` with `items[].upc`; brand deposits are `CAPTURE` orders |
| Payments v2 `captures/{id}/refund` | `apps/engine/src/cycle.ts` | Refunds each brand's unspent deposit |
| Webhooks | `apps/engine/src/webhooks` | Signature-verified intake; the capture is joined to its arm; refund and dispute events void pending credits |
| Payouts | `apps/engine/src/payouts.ts` | Batch payout to `PAYPAL_ID` recipients after the 30-day hold, split by Shapley value across co-exposed creators |

Every mutating call sets a deterministic `PayPal-Request-Id`. In `simulated` mode these go to the in-memory mock in `packages/paypal`.

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

MIT
