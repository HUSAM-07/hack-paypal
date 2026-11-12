# Shop vertical: workboard (branch `feat/shop`)

Spec: [spec/SHOP-SPEC.md](spec/SHOP-SPEC.md). Contracts: `packages/agent-protocol/src/protocol.ts`, `packages/commerce/src/contract.ts`.

- [x] Contract: spec, protocol, product contract, package scaffolds
- [x] A shop-harness: ShopperAgent (Agents SDK), Codex-style protocol server, turn runner, OpenRouter via AI Gateway + fake model, AG-UI SSE adapter
- [x] B shop-commerce: Exa search, PayPal sellers, price checks, watches, mandates, checkout (authorize → cooling-off → capture/void), PayPal simulator
- [x] C shop-ui: genui widget kit + registry, shop-web SPA (chat, browser pane, watchlist, orders, settings)
- [x] D shop-platform: Google sign-in, migration 0011, bindings, shop CSP, SHOP_ENABLED
- [x] Integrate: /api/shop + /shop in pact-worker, commerce ↔ agent adapter, simulator state survives hibernation, CITED demo green

## Verified (2026-11-12)
- `npm test`, `npm run typecheck`, `npm run lint`, web build, deploy dry-runs (workers-dev, shipwith).
- `CITED_ENGINE=worker npm run demo:cited`: all checks ok.
- Browser, local worker, real OpenRouter + Exa, simulated PayPal: search → approval card → authorize → cooling-off → undo (voided) after the agent hibernated.

## Open
- Browser pane: `browser/takeControl|handBack` return methodNotFound; no Live View sessions are created yet.
- Step-up approvals (total ≥ $500) can't pass: nothing verifies a passkey assertion for the shop yet.
- `inbox/added` is broadcast, not stored: a user with no open tab misses it (state still updates).
- Exa web offers often come back without a structured price, so most results are PayPal sellers.
- Opt-in Cloudflare extras: `SHOP_EXTRAS=1` deploys the SHOP_CACHE KV; Browser Run needs `CF_BROWSER_RUN_TOKEN`. Workflows/R2/cron were dropped for v1 (checkout durability is the agent's own schedules).
- Theme: shop-web carries a copy of the CITED light theme until feat/ui-redesign's shared tokens land.
- To turn it on in a deploy: set SHOP_ENABLED="true" and the secrets OPENROUTER_API_KEY, EXA_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET per target.
