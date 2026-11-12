# CITED Studio: the AG Studio dashboards and the Analyst

`/studio` (Maya, Winix's brand manager; its Programmes page is `/studio?page=programmes`) and `/studio/creator` (HouseFresh; `?creator=airlab` for AirLab) are one AG Studio app (`ag-studio` + `ag-studio-react`), served by `pact-worker`.

- **Page:** `apps/web/studio.html` → `apps/web/src/studio/`. Built with the web app; the worker serves it from its assets under a strict CSP (no inline script, no CDN).
- **API:** `apps/studio` (`createStudioApp`), mounted by the worker at `/studio/api`:
  - `GET /config`: licence keys, which model the Analyst uses, the table schema.
  - `GET /data`: the engine read API (`/api/cited/api/{clock,lift,deposits,credits,journeys,payouts}`) as Studio tables. The page polls it every 15 s while the tab is visible and in use (paused when hidden, stopped after 10 min without input, backing off after failures) and applies the difference as Studio transactions, so widgets update in place (a refund void shows without a reload).
  - `GET /analyst?brand=winix`: the cap recommendation, computed from engine numbers (no model).
  - `GET /creator-analyst?creator=housefresh&topic=earned|voided|held|shared|earn_more|overview`: the Creator Analyst's figures from the same tables, each with its source (no model). Read only: it has no write counterpart.
  - `POST /analyst/approve`: Maya's Approve button. The amount comes from a fresh recommendation, never from the request, and the approval id must match the card she saw. Calls the engine's `POST /api/approvals/:approvalId/approve`.
  - `POST /programmes`: a brand's "Start a programme" (needs the `x-studio: programme` header). The terms (a catalogue product, a deposit in cents, a commission rate in basis points) are checked with the engine's own rules (`checkProgrammeTerms` in `@pact/protocol`). Locally (`CITED_OPEN_API=1`) it calls the engine's `POST /api/programmes`, which creates the programme and captures its Orders v2 deposit. On the hosted worker, where engine writes are locked behind the CITED token, it does what Approve does: the programme is kept in the visitor's own cookie and replayed over the engine's reads for 30 minutes. No PayPal order is made and the shared ledger does not change.
  - `POST /llm`: one model turn for the Studio agents, streamed. Same-origin only, rate-limited per IP and overall, request and output capped. Keys never reach the browser.

## What each view shows

**Brand** (`/studio`): the "+N extra Winix sales" tile at the 80% lower bound (N from the engine), Levoit's $0 beside it; Winix share by arm (test / same-creator placebo / held out); the programme deposit (paid, reserved, left, returned, approved top-ups); cross-store journeys with the Shapley split (master-detail AG Grid: expand a row for the store hop and each creator's share); and the credits held for review by the abuse guard (after the guard beat: HouseFresh's $7.68 self-purchase, waiting for a reviewer), with **Release** (paid at the next payout run) and **Void** (asks once more; voided for good) buttons. The header toggle switches money between **First payout** (beat 8: 51 caused of 57 exposed, $391.64 credited − $7.68 voided = $383.96 paid, $616.04 returned) and **Programme to date** (62 of 69, $468.43 paid). The URL carries the toggle: `/studio?view=first` or `?view=total` opens on that view, and `?clean=1` alone opens on First payout.

**Programmes** (`/studio?page=programmes`, or the Programmes button in the header): every programme with its deposit meter (paid, reserved, left, returned), its commission rate and how many sales its test caused, and **Start a programme** beside it. A brand picks a category the catalogue can test (air purifiers or robot vacuums) and one of its products, sets a deposit ($100 to $10,000) and a commission rate (1% to 20%), reads a plain summary and confirms. The summary says: you fund the category, never a verdict; you pay only for sales a creator's test caused, at the 80% lower bound; unspent money comes back through a PayPal refund. Each product has one programme, so a product that already has one cannot be started again and no sale is ever paid for twice. The new programme shows up at once, empty until sales arrive. On the hosted demo the page says so before you confirm ("Demo mode") and after: the programme stays in your browser. On a phone the two widgets stack and the Filters tab is hidden. State logic: `apps/web/src/studio/programmeForm.ts`.

**Creator** (`/studio/creator`): pending, frozen, held-for-review, voided and paid tiles; every credit with its void reason, why it is held, hold date, payout batch and the co-exposure split (AirLab + HouseFresh); paid per PayPal Payouts batch; the review flags on the creator's credits.

**Trust** (`/studio?page=trust`, or the Trust button in the header): every credit the abuse guard or PayPal has stopped, in plain words. A summary sets held, frozen and voided money against paid, then each stopped credit shows the amount, creator, sale date, status and reason: "Creator bought through their own PayPal", "Same buyer bought repeatedly", "Sudden spike in sales", "Buyer refunds often" (the guard's four holds), "Open dispute: frozen until PayPal decides", "Refund voided this credit", "Part of the sale was refunded", "Buyer won a dispute, so this credit was voided" and "A reviewer voided this credit". Reason chips narrow the list. Held credits keep the same **Release** and **Void** buttons. It reads the existing credits and review flags (the `trust` table in `apps/studio/src/trust.ts`); no new endpoint and no new write.

## The Analyst

A custom agent in AG Studio's Agent Framework (`apps/web/src/studio/agents/analyst.tsx`). It delegates to the built-in **Data** agent (reads the tables), the **Page** agent (adds a chart widget) and the **Widget** agent (configures it as a bar chart: paid out vs deposit left per brand). AG Studio has no separate "Chart" agent; the Widget agent configures charts. Then it calls `draft_cap_top_up`, which returns the engine's recommendation with every figure it used and its source, and shows Maya an **Approve** button in the tool's detail panel. Nothing moves money until she presses it. (Studio's own harness cannot pause a tool for approval yet, `agAiChat.d.ts`: "Studio's own harness does not pause for approval yet", so the approval is that button.)

## The Creator Analyst

A second custom agent in the Agent Framework, on the creator view (`apps/web/src/studio/agents/creatorAnalyst.tsx`; its figures come from `apps/studio/src/creator.ts`). It answers "Why did I earn $383.96?", "Why was $7.68 voided?", "Why is a credit held?", "How did the Shapley split work?" and "What would earn me more?" from the creator's own tables, with question chips like the brand view's. For "why did I earn" it delegates to the same built-in team: the **Data** agent reads the credits, the **Page** and **Widget** agents add a "Your credits by state" bar chart. Then it calls `explain_creator_credits`, whose only effect is a `GET`, and cites each figure with its table.

It is read only by construction: it is offered no approve, release, void, payout or top-up tool (tests pin the tool list, the `GET`-only call and that the endpoint refuses every write verb), and it says so if asked. Its advice stays honest: a creator earns more by publishing tests with clear, accurate verdicts in categories brands fund, never by gaming the holdout, buying their own products or changing a verdict to favour a funder (those credits are held or voided). It uses the same model route as the brand Analyst, and the same scripted fallback (labelled) when no key is set. The AI panel is on the creator view on screens wider than a phone; switching between Brand and Creator reopens the page so the right agent and chips load.

Model, chosen by the worker:
1. `LLM_BASE_URL` + `LLM_API_KEY` (an OpenAI-compatible gateway, for local runs);
2. else `ANTHROPIC_API_KEY` (production);
3. else a scripted Analyst, labelled as such, that runs the same steps without a model.

`CITED_STUDIO_MODEL` overrides the model (default `claude-sonnet-5-5`).

## Run it locally

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # add LLM_BASE_URL / LLM_API_KEY for a real Analyst
npm run dev -w @pact/worker                              # worker on :8790
```

For the dashboards with hot reload, also run the web dev server (`npm run dev -w @pact/web`, port 5180; it proxies `/studio/api` to the worker) and open <http://localhost:5180/studio>. Without it, build once (`npm run build -w @pact/web`) and open <http://localhost:8790/studio>.

## Record the beat

1. Start from an empty engine (locally: stop the worker, `rm -rf apps/worker/.wrangler/state`, `npx wrangler d1 migrations apply pact --local`, start it again; hosted: the wipe step of the `reseed-hosted` workflow).
2. Open `/studio` at 1920×1080 and start recording.
3. Replay the demo, pausing at the Analyst beat for Maya:
   ```bash
   npm run demo:cited -- --use-running --engine-url http://localhost:8790/api/cited --catalogue-url http://localhost:8790/catalogue --approve-in-studio --pace 4000
   ```
   (Hosted: the deployed URL for both.) The tiles fill as sales land; the refund void ($7.68) appears without a reload; day 30 pays $383.96.
4. At "Waiting for Maya to approve the top-up in AG Studio", toggle **First payout** to show beat 8's numbers, then ask the Analyst "Should we raise the purifier cap?". It builds its chart and drafts a $500.00 top-up. Expand "Drafted a cap top-up for Maya to approve" and press **Approve**: the deposit meter shows the top-up within 15 s and the demo continues.
5. Toggle back to **Programme to date** for the Shapley and dispute beats (62 caused, $468.43 paid), then switch to **Creator** for HouseFresh's credits.

## Production settings

- `AG_STUDIO_LICENSE_KEY` (wrangler secret): without it AG Studio shows its watermark. `AG_GRID_LICENSE_KEY` covers the journeys grid; it falls back to the Studio key.
- `ANTHROPIC_API_KEY` (wrangler secret) for the Analyst; otherwise it runs scripted.
