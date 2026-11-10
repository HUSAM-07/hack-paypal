# Creator onboarding (`/creators`)

A product reviewer connects PayPal with **Log in with PayPal** and publishes a test. Served by `pact-worker` (`apps/worker/src/creators`).

## Flow

1. **Connect PayPal.** `/creators/connect` sets a signed `state` cookie and redirects to PayPal's `/signin/authorize` (scopes `openid profile email https://uri.paypal.com/services/paypalattributes`). PayPal returns to `/creators/callback?code&state`; the worker checks `state`, exchanges the code (`POST /v1/oauth2/token`, `authorization_code`), reads `GET /v1/identity/oauth2/userinfo?schema=paypalv1.1` and keeps the `payer_id`. The user access token is used once and dropped. The payer id becomes the creator's Payouts receiver (`recipient_type: PAYPAL_ID`, `creators.paypal_id`).
2. **Publish a test.** The form builds two `VerifiedTest`s (the test, and a placebo on another topic) and validates them with the protocol schema. The worker posts them to the engine's `POST /api/tests` server-side, as an internal caller: the page never holds `CITED_API_TOKEN`. The post needs the page's own `Origin`, a form token bound to the creator's session, and passes a per-IP limit.
3. **Dashboard.** The confirmation draws the holdout schedule (`DEFAULT_SCHEDULE`: 50/50 for 7 days, then 5% held out) and links to `/studio/creator?creator=<id>`.

The creator id is `c-` plus 12 hex characters of `SHA-256("creator:" + payer_id)`: one PayPal account is always one creator, and it can never equal a demo creator's id. Onboarded creators and their tests are stored with `source = 'onboarding'` (migration `0007`); the engine refuses to write over a `demo` creator. The catalogue, the lift maths and the ledger read only the demo fixtures, so onboarded tests don't move the recorded numbers.

## Simulated mode (default)

With `CITED_PAYPAL_MODE=simulated`, "Connect PayPal" opens `/creators/paypal/simulated`, a consent page labelled **"Simulated PayPal sign-in"** in its banner and its card. "Agree and connect" returns a random code; the PayPal mock (`packages/paypal`) exchanges it and answers userinfo with a payer id derived from that code (`mockPayerId`). No PayPal account is involved and nothing to enter.

## Real sign-in in sandbox: what the dashboard owner enables

Set `CITED_PAYPAL_MODE=sandbox` with the app's `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (wrangler secrets). Then, in the PayPal Developer Dashboard → **Apps & Credentials → Sandbox → the CITED app**:

1. Under **Features**, tick **Log in with PayPal** and open its **Advanced settings**.
2. **Return URL**: add `https://pact-worker.vincent-wesley-liem.workers.dev/creators/callback` (and `http://localhost:8790/creators/callback` for `wrangler dev`). It must match exactly, path included.
3. **Information requested from customers**: tick **Full name**, **Email** and, under **Advanced attributes**, **PayPal account ID (payer ID)**. Without the payer id the callback refuses the sign-in ("PayPal did not return a payer id").
4. Fill in the **privacy policy** and **user agreement** URLs the dashboard asks for, then **Save**.

The sandbox member who signs in must be a sandbox **personal** or **business** account from Sandbox → Accounts. Payouts to their payer id land in that sandbox account.
