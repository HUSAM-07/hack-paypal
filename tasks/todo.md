# Pact — Build Plan

Spec: [docs/spec.md](../docs/spec.md). Deadline: **Nov 12, 12:00pm PT**. Early check: **Nov 5**.

## Phase 0 — Unblock (Nov 1–2)
- [ ] User: PayPal sandbox app credentials → `.env` (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`)
- [ ] User: Channel3 key → `.env`; `wrangler login`
- [ ] Decide Pro components: license vs. original
- [ ] Monorepo scaffold (pnpm, TS strict, Biome, Vitest), MIT LICENSE, CI
- [ ] **PayPal spikes** (scripts in `packages/paypal/spikes`):
  - [ ] Vault without purchase → off-session charge
  - [ ] Payouts to a sandbox personal account
  - [ ] Order with `payee` = second sandbox merchant
  - [ ] Webhook verification on Workers
  - [ ] JS SDK v6 in a React card

## Phase 1 — Core rails (Nov 2–4)
- [ ] `packages/protocol`: Thread/Turn/Item + approval schemas, JSON Schema export
- [ ] `apps/worker`: Hono + ThreadDO (agent loop, Anthropic adapter, event log, WebSocket replay)
- [ ] `packages/policy`: mandates + `authorize()` + property tests
- [ ] `packages/paypal`: token cache, orders, vault, payouts, invoices, webhooks, idempotency
- [ ] `apps/web`: shell, auth (passkeys), chat with streaming items, OpenUI renderer + first 4 catalog components
- [ ] **Nov 5: deploy to workers.dev + submit draft for the early eligibility check**

## Phase 2 — Pacts (Nov 5–8)
- [ ] PactDO state machine + alarms (price watch via Channel3, schedules)
- [ ] Group threads (multi-member sockets, per-member approvals)
- [ ] Member commit flow (vault approval → MandateCard)
- [ ] Settlement Workflow (charge shares → buy → payout → ledger) + webhook reconciliation
- [ ] P2P: send/request/settle via TransferFundsCard
- [ ] Full catalog (PactCard, PriceWatch, SplitBreakdown, ApprovalSheet, Receipt, ScheduleCard…)

## Phase 3 — Quality (Nov 8–10)
- [ ] Eval harness + 40 scenarios (parsing, tool choice, amount fidelity, red-team) gated in CI
- [ ] Playwright multi-user E2E
- [ ] Security pass: CSP, rate limits, Turnstile, step-up, audit log, secret scan
- [ ] Landing page
- [ ] OpenRouter provider adapter

## Phase 4 — Ship (Nov 10–12)
- [ ] README (judge quickstart, sandbox test logins, architecture diagram, AI tools used)
- [ ] Demo video < 3 min, Devpost copy, "Built With"
- [ ] Submit by Nov 12 12:00pm PT

## Parallel sessions (after plan approval)
Each runs in its own worktree. Shared contracts land first (protocol + catalog specs) so sessions don't collide.
1. **Worker + agent protocol** (ThreadDO, PactDO, Workflows)
2. **Web app + design system + OpenUI catalog**
3. **PayPal package + spikes + webhooks**
4. **Policy engine + evals harness**
5. **Landing page** (starts Phase 2)

## Review
**2026-11-01, integration round 1**
- Merged into main: protocol/policy/catalog base, `packages/paypal`, `apps/worker`, `packages/evals`, `apps/web`, agent hardening (eval findings), PayPal wiring. 234 tests, lint, typecheck, eval gate green.
- Web runs against the real worker (`dev:live`): passkey/dev sign-in, per-thread sockets, approval → charge → resumed turn, replay, wallet. Verified in the browser with the fake model and simulated PayPal.
- Fixed: pact-scoped mandates hard-denied unrelated spends (`341f0d2`).
- Blocked: Anthropic key hit its usage limit (returns 2026-12-01, after the deadline): raise the limit or add an OpenRouter key. No PayPal sandbox credentials yet, so nothing has run against the sandbox.
- Open: nothing triggers `PactDO.settle()` yet (price/schedule/quorum alarms); full live eval suite unmeasured (red-team 98% ×3); landing page; deploy.
