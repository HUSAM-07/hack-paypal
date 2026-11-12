# Shop vertical: workboard (branch `feat/shop`)

Spec: [spec/SHOP-SPEC.md](spec/SHOP-SPEC.md). Contracts: `packages/agent-protocol/src/protocol.ts`, `packages/commerce/src/contract.ts`.

- [x] Contract: spec, protocol, product contract, package scaffolds, deps in the lockfile
- [ ] A shop-harness: ShopperAgent, protocol server, turn runner, OpenRouter/AI Gateway, AG-UI adapter
- [ ] B shop-commerce: tools, pricing, watches, mandates, checkout (authorize → cooling-off → capture/void)
- [ ] C shop-ui: genui kit + registry, shop-web SPA (chat, browser pane, watchlist, orders)
- [ ] D shop-platform: Google sign-in, migration, bindings on both targets, CSP, SHOP_ENABLED
- [ ] Integrate: mount /api/shop + /shop, wire tools ↔ widgets, e2e (simulated + fake), CITED demo still green, PR
