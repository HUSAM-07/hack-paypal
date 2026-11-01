/**
 * Shared spike plumbing. Credentials come from the nearest `.env` walking up from here
 * (the main checkout's, for worktrees) or from `PAYPAL_ENV_FILE`. Nothing secret is
 * printed: tokens never, vault ids masked. Results land in `results.json` for the doc.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPayPal, type PayPalClient, PayPalError } from "../src/index";

const HERE = new URL(".", import.meta.url).pathname;
const STATE = `${HERE}.state.json`;
const RESULTS = `${HERE}results.json`;

export const REQUIRED_SETUP = `
PayPal sandbox credentials are missing. To run the spikes:

1. https://developer.paypal.com/dashboard/applications/sandbox → "Create App"
   (type: Merchant, name: Pact). Open the app and under "Features" tick:
   - Vault  (Save payment methods)
   - Payouts
   - Log in with PayPal (add return URL http://localhost:8790/auth/paypal/callback,
     and tick "Email" + "PayPal account ID (payer ID)" under advanced settings)
2. https://developer.paypal.com/dashboard/accounts → make sure you have:
   - the app's default Business account (the platform/merchant)
   - 1 extra Business account (a second "retailer" for payee routing)
   - 2 Personal accounts (buyer + P2P recipient; the default personal can be the buyer)
3. Paste into /Users/mohammedhusamuddin/codebase-core/hack-paypal/.env:
   PAYPAL_CLIENT_ID=<app client id>
   PAYPAL_CLIENT_SECRET=<app secret>
   PAYPAL_SANDBOX_BUYER_EMAIL=<personal #1 email>        # approves vault setup
   PAYPAL_SANDBOX_RECIPIENT_EMAIL=<personal #2 email>    # payouts / payee tests
   PAYPAL_SANDBOX_BUSINESS2_EMAIL=<extra business email> # payee routing
`;

function findEnvFile(): string | undefined {
  if (process.env.PAYPAL_ENV_FILE) return process.env.PAYPAL_ENV_FILE;
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    const candidate = `${dir}.env`;
    if (existsSync(candidate) && /^PAYPAL_CLIENT_ID=\S+/m.test(readFileSync(candidate, "utf8"))) {
      return candidate;
    }
    dir = dir.replace(/[^/]+\/$/, "");
  }
  return undefined;
}

export function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function client(): PayPalClient {
  const file = findEnvFile();
  if (file) process.loadEnvFile(file);
  const clientId = env("PAYPAL_CLIENT_ID");
  const clientSecret = env("PAYPAL_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error(REQUIRED_SETUP);
    process.exit(2);
  }
  return createPayPal({
    clientId,
    clientSecret,
    env: "sandbox",
    onRequest: (l) =>
      console.log(
        `  ↳ ${l.method} ${l.route} → ${l.status}${l.debugId ? ` debug_id=${l.debugId}` : ""}`,
      ),
  });
}

export function mask(id: string | undefined): string {
  if (!id) return "-";
  return id.length <= 4 ? "****" : `${id.slice(0, 2)}…${id.slice(-2)}`;
}

export function rid(step: string, label = ""): string {
  return `spike:${step}:${label}:${Date.now()}`;
}

type State = Record<string, string>;

export function loadState(): State {
  return existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as State) : {};
}

export function saveState(patch: State): void {
  writeFileSync(STATE, JSON.stringify({ ...loadState(), ...patch }, null, 2));
}

/** Append a non-secret observation for docs/paypal-capabilities.md. */
export function record(step: string, observation: Record<string, unknown>): void {
  const all = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, "utf8")) as unknown[]) : [];
  all.push({ step, at: new Date().toISOString(), ...observation });
  writeFileSync(RESULTS, JSON.stringify(all, null, 2));
  console.log(`  ✎ ${step}:`, JSON.stringify(observation));
}

/** Run one probe; PayPal errors are recorded as outcomes, not crashes. */
export async function probe(
  step: string,
  label: string,
  fn: () => Promise<Record<string, unknown>>,
) {
  console.log(`\n▶ ${step} — ${label}`);
  try {
    const out = await fn();
    record(step, { label, ok: true, ...out });
    return out;
  } catch (e) {
    if (e instanceof PayPalError) {
      record(step, {
        label,
        ok: false,
        status: e.status,
        name: e.code,
        issues: e.issues,
        debugId: e.debugId,
      });
    } else {
      record(step, { label, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return undefined;
  }
}

/**
 * Raw token response, for the two spikes that need what the client deliberately hides
 * (scopes; webhook-management endpoints the client doesn't wrap). Never print `access_token`.
 */
export async function rawToken(): Promise<{
  access_token: string;
  scope?: string;
  expires_in?: number;
  app_id?: string;
  status: number;
}> {
  const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env("PAYPAL_CLIENT_ID")}:${env("PAYPAL_CLIENT_SECRET")}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  return { ...((await res.json()) as { access_token: string }), status: res.status };
}
