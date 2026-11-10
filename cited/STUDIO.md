# CITED Studio: the AG Studio dashboards and the Analyst

`/studio` (Maya, Winix's brand manager) and `/studio/creator` (HouseFresh; `?creator=airlab` for AirLab) are one AG Studio app (`ag-studio` + `ag-studio-react`), served by `pact-worker`.

- **Page:** `apps/web/studio.html` → `apps/web/src/studio/`. Built with the web app; the worker serves it from its assets under a strict CSP (no inline script, no CDN).
- **API:** `apps/studio` (`createStudioApp`), mounted by the worker at `/studio/api`:
  - `GET /config`: licence keys, which model the Analyst uses, the table schema.
  - `GET /data`: the engine read API (`/api/cited/api/{clock,lift,deposits,credits,journeys,payouts}`) as Studio tables. The page polls it every 2 s and applies the difference as Studio transactions, so widgets update in place (a refund void shows without a reload).
  - `GET /analyst?brand=winix`: the cap recommendation, computed from engine numbers (no model).
  - `POST /analyst/approve`: Maya's Approve button. The amount comes from a fresh recommendation, never from the request, and the approval id must match the card she saw. Calls the engine's `POST /api/approvals/:approvalId/approve`.
  - `POST /llm`: one model turn for the Studio agents, streamed. Same-origin only, rate-limited per IP and overall, request and output capped. Keys never reach the browser.

## What each view shows

**Brand** (`/studio`): the "+N extra Winix sales" tile at the 80% lower bound (N from the engine), Levoit's $0 beside it; Winix share by arm (test / same-creator placebo / held out); the programme deposit (paid, reserved, left, returned, approved top-ups); cross-store journeys with the Shapley split (master-detail AG Grid: expand a row for the store hop and each creator's share); and the credits held for review by the abuse guard (after the guard beat: HouseFresh's $7.68 self-purchase, waiting for a reviewer). The header toggle switches money between **First payout** (beat 8: 51 caused of 57 exposed, $391.64 credited − $7.68 voided = $383.96 paid, $616.04 returned) and **Programme to date** (62 of 69, $468.43 paid).

**Creator** (`/studio/creator`): pending, frozen, held-for-review, voided and paid tiles; every credit with its void reason, why it is held, hold date, payout batch and the co-exposure split (AirLab + HouseFresh); paid per PayPal Payouts batch; the review flags on the creator's credits.

## The Analyst

A custom agent in AG Studio's Agent Framework (`apps/web/src/studio/agents/analyst.tsx`). It delegates to the built-in **Data** agent (reads the tables), the **Page** agent (adds a chart widget) and the **Widget** agent (configures it as a bar chart: paid out vs deposit left per brand). AG Studio has no separate "Chart" agent; the Widget agent configures charts. Then it calls `draft_cap_top_up`, which returns the engine's recommendation with every figure it used and its source, and shows Maya an **Approve** button in the tool's detail panel. Nothing moves money until she presses it. (Studio's own harness cannot pause a tool for approval yet, `agAiChat.d.ts`: "Studio's own harness does not pause for approval yet", so the approval is that button.)

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
4. At "Waiting for Maya to approve the top-up in AG Studio", toggle **First payout** to show beat 8's numbers, then ask the Analyst "Should we raise the purifier cap?". It builds its chart and drafts a $500.00 top-up. Expand "Drafted a cap top-up for Maya to approve" and press **Approve**: the deposit meter shows the top-up within 2 s and the demo continues.
5. Toggle back to **Programme to date** for the Shapley and dispute beats (62 caused, $468.43 paid), then switch to **Creator** for HouseFresh's credits.

## Production settings

- `AG_STUDIO_LICENSE_KEY` (wrangler secret): without it AG Studio shows its watermark. `AG_GRID_LICENSE_KEY` covers the journeys grid; it falls back to the Studio key.
- `ANTHROPIC_API_KEY` (wrangler secret) for the Analyst; otherwise it runs scripted.
