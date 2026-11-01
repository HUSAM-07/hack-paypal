# @pact/web

The Pact web app: a React 19 + Vite SPA with an OpenUI generative-UI renderer.

```bash
npm run dev -w @pact/web          # http://localhost:5180/app (mock server, scripted demo)
npm test -w @pact/web             # Vitest: protocol client, ref binding, money, actions
npm run e2e -w @pact/web          # Playwright smoke tests over the mock demo
SCREENSHOTS=1 npm run e2e -w @pact/web   # also writes screenshots/ for 4 theme/viewport combos
```

Add `?speed=3` to run the scripted demo faster, `?devtools` to show OpenUI's Inspect widget.
`window.__pactMock.dropAll()` (dev only) simulates a network drop to watch reconnect + replay.

## Config (`.env.example`)
- `VITE_PACT_WS_URL`: unset runs the in-browser mock server; set it to the worker's WebSocket URL to go live.
- `VITE_PACT_API_URL`: base for REST calls (defaults to same origin).
- `VITE_PAYPAL_CLIENT_ID`: public sandbox client id. When set, the commit sheet loads the real
  PayPal JS SDK v6; otherwise a stand-in button walks the same endpoint sequence offline.

## Layout
- `src/protocol`: `PactClient` (JSON-RPC lite, per-thread `seq`, reconnect + `thread/resume`) and `ThreadStore`.
- `src/mock`: in-browser server speaking the same protocol, scripted turns, REST stubs.
- `src/genui`: OpenUI library bound to `@pact/catalog`, ref resolution (`refs.ts`), all catalog components.
- `src/host`: host-only renderers (ApprovalSheet, Receipt, PactTimeline, SystemNotice, tool steps).
- `src/paypal`: commit sheet (v6 save-payment + one-time sessions).
- `src/components/spectrumui`, `src/components/motion`: Spectrum UI components (Apache-2.0), lightly adapted.

## Worker contract assumed
- WebSocket: `@pact/protocol` as-is. Agent text = prose plus ```` ```openui-lang ```` fences; `refs[id] = { kind, data }`.
- Ref `data` shapes the UI reads are in `src/genui/refs.ts` (product, pact, mandate, transfer, activity).
- REST: `GET /api/wallet`, `POST /api/mandates/:id/revoke`, `GET /api/paypal/client-token`,
  `POST /api/paypal/setup-token`, `POST /api/paypal/payment-token`, `POST /api/paypal/orders`,
  `POST /api/paypal/orders/:id/capture`. See `src/lib/api.ts` for bodies.
