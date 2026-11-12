# CITED UI revamp v2: sticker column (branch `feat/ui-redesign`, 2026-11-12)

Goal: every CITED page in the reference's style: a narrow bordered column, dashed section bands,
die-cut sticker illustrations (generated with Codex image_gen), DM Sans text, Instrument Serif
accents, Geist Mono labels, Caveat margin notes, cobalt accent, light-first with dark as a token swap.

- [x] Merge origin/main (47 commits; resolved site.ts, SiteHeader, Landing, index.html)
- [x] Fonts self-hosted (CSP font-src 'self'): DM Sans, Instrument Serif, Caveat in public/fonts
- [ ] Stickers: 13 Codex PNGs -> trimmed WebP in public/art/stickers
- [ ] Landing: sticker hero, section bands (problem, how, proof, payout, guardrails, try, real), sources
- [ ] /proof keeps the old base CSS (moved to proof/base.css), retokened to the new fonts/colours
- [ ] Shared header (SITE_HEADER_CSS) + SITE_THEME_CSS -> server pages (console, try, creators, mcp, ledger, 404)
- [ ] Studio tokens
- [ ] Verify: typecheck, lint, tests, build, screenshots light/dark/375px; tour anchors (#problem) intact

# CITED UI redesign (branch `feat/ui-redesign`, 2026-11-12)

Goal: one light, airy design system across every CITED page, with agentsUI blocks
(`npx shadcn add https://components.ihusam.tech/r/<name>.json`) for the agent surfaces.
Deadline is 2026-11-12 12:00 PT; the demo video was cut against the current UI, so
every beat in `cited/spec/CITED-packet.md` must still read the same numbers.

Design language
- White page, near-black text, Geist for text, Geist Mono for figures; large display headings at weight 400, slight negative tracking.
- Framed column: 1px vertical guide lines down the page, full-width horizontal rules between sections, alternating white / soft-grey bands.
- Hero: CSS-only sky gradient with soft cloud shapes (no copied imagery), centered headline, black pill CTA, an "app window" mockup of the agent shopping session.
- Small blue eyebrow links with a chevron above each section heading.
- Feature cards: pastel mesh-gradient panels with a real product snippet inside, caption below (bold lead-in + grey text).
- Trust grid: four cards (signed passport, void before pay, randomised holdout, batch payouts).
- Dark mode kept as a token swap.

Steps
- [x] Tokens + shared header (`apps/web/src/styles/tokens.css`, `SITE_HEADER_CSS` in `@pact/protocol`) so server-rendered pages follow
- [x] Landing `/`: hero, problem, how it works (4 cards), proof strip, trust grid, CTA footer
- [ ] (session `studio-redesign`) Studio `/studio`: app-window shell; always-on agents panel (Agent Inbox / Running Now / Away Summary over real engine data), Approval Card for Maya, Cited Answer for the Analyst, Usage Meter for the deposit
- [x] `/proof` restyle to the new tokens
- [x] Server-rendered pages (console, creators, try, payout, mcp): tokens + header only
- [ ] Verify: typecheck, lint, tests, e2e, `CITED_ENGINE=worker npm run demo:cited`, screenshots light/dark/mobile

Review (landing pass, 2026-11-12)
- Done: `17d9f61` tokens + shared bar, `de2607a` landing. typecheck, lint, all unit tests and the web prerender build pass; landing checked in light, dark and 375px (no horizontal scroll); /proof, /try, /creators, /console checked on the local worker.
- Not run: Playwright e2e (Chromium not installed locally; those specs cover `/app`, untouched) and `CITED_ENGINE=worker npm run demo:cited`.
- Local worker needed `wrangler d1 migrations apply pact --local` before /console would load.

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
- [x] Landing page (prerendered, separate entry from the app)
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

### Round 2 (Nov 2–3)
- Deployed to https://caaash.shipwith.si (`npm run deploy -w @pact/worker`; workers.dev is off), invite-only sign-up (`INVITE_CODE`), simulated PayPal in production. Agent hardening merged: live evals 97.9% overall, 100% red-team ×3.
- Redesign: light lavender theme (dark kept as a toggle), Geist, pill buttons, 24–32px cards; app restyled through the shared tokens in `apps/web/src/styles/tokens.css`.
- Landing at `/`: prerendered HTML with inlined CSS and its own small Tailwind build; the app loads from `app.html`, served by the worker for `/app*`. Art generated with fal.ai (`apps/web/scripts/gen-art.ts`, `optimize-art.ts`), 4–12 KB AVIF each.
- Lighthouse (local build): mobile 98/100/100/100 (LCP 2.1s on slow 4G, CLS 0, TBT 0); desktop 100/100/100/100 (LCP 0.5s).
- Open: price/schedule/quorum alarms → `PactDO.settle()`; PayPal sandbox in-app checkout (needs a buyer login); webhooks; OpenRouter; README, demo video.
- Landing v2 (Nov 3): chaptered page over a fixed WebGL2 film-grain scene (raw shader, starts after load), a 3D ring title in CSS, chapter dropdown and bottom chapter pill, 8 chapters with feature blocks, media frames and card grids. fal.ai media: 4 backdrops, 16 stills, 5 Seedance loops (0.7–1.05 MB H.264, play only in view, posters lazy); about $8.18 spent. Lighthouse (local build): mobile 97/100/100/100 (LCP 2.4s, 347 KB initial), desktop 100/100/100/100.
