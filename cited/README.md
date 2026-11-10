# CITED

PayPal's affiliate network, rebuilt for AI agents: it pays creators on proven lift, not last-click cookies.

**CITED is the product we're shipping.** The Pact code elsewhere in this repo is a placeholder. This folder holds the CITED specs.

| File | What it is |
|---|---|
| [WORKBOARD.md](WORKBOARD.md) | Every build task, by Backend / Frontend / AG Grid, linked to its GitHub issue |
| [spec/CITED-card.md](spec/CITED-card.md) | The locked product card |
| [spec/CITED-packet.md](spec/CITED-packet.md) | README intro and the 3-minute video script |
| [spec/BUILD-PLAN.md](spec/BUILD-PLAN.md) | Components, owners, schedule, risks |
| [spec/hackathon-constraints.md](spec/hackathon-constraints.md) | Rules, criteria, prizes, judges, sponsor tech |
| [spec/paypal-and-sponsor-apis.md](spec/paypal-and-sponsor-apis.md) | PayPal and sponsor API notes |
| [paypal-openapi/](paypal-openapi/) | Official PayPal OpenAPI specs (Orders v2, Payments v2, Payouts, Invoicing) and Agent Toolkit notes, for the mock layer |
| [eval-reference/](eval-reference/) | Earlier eval scripts and results behind the card's "Measured" numbers |

## Running CITED

Needs Node 22+. The root [README](../README.md) has the full run, config and eval instructions; variables are in [`.env.example`](../.env.example).

```bash
npm ci
npm run dev:cited   # starts every app; PAYPAL_MODE=simulated and MODEL_PROVIDER=fake, no keys needed
```

| App | Port | Check |
|---|---|---|
| `apps/engine` (Worker, Hono + D1) | 8800 | `curl localhost:8800/health` |
| `apps/catalogue-mcp` | 8801 | `curl localhost:8801/health` |
| `apps/agents` | 8803 | `curl localhost:8803/health` |
| `apps/studio` | 8804 | `curl localhost:8804/health` |

Run one app with `npm run dev -w @cited/<name>`. Root checks: `npm test`, `npm run typecheck`, `npm run lint`.
