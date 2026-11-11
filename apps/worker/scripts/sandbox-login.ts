/**
 * Log in with PayPal for creators, on the real sandbox, through the worker's own identity code
 * (`src/creators/identity.ts`, the same functions `/creators` calls).
 *
 *   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… npx tsx apps/worker/scripts/sandbox-login.ts url
 *     → prints the authorize URL. Approve it as a sandbox personal account; PayPal redirects to
 *       /creators/callback?code=…&state=… (the hosted page is simulated and will reject the code;
 *       copy it from the address bar).
 *   … sandbox-login.ts exchange <code>
 *     → exchanges the code and reads userinfo. Prints only whether a payer id came back and its
 *       shape; never the token, payer id or email.
 */
import { authorizeUrl, exchange } from "../src/creators/identity";
import type { Env } from "../src/env";

const ORIGIN = process.env.CITED_ORIGIN ?? "https://pact-worker.vincent-wesley-liem.workers.dev";
const env = {
  PAYPAL_MODE: "sandbox",
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
} as unknown as Env;

const [cmd, arg] = process.argv.slice(2);
if (cmd === "url") {
  const state = crypto.randomUUID();
  console.log(authorizeUrl(env, "sandbox", { origin: ORIGIN, state }));
} else if (cmd === "exchange" && arg) {
  const m = await exchange(env, "sandbox", { origin: ORIGIN, code: arg });
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      payerIdReturned: /^[A-Z0-9]{8,20}$/.test(m.payerId),
      payerIdLength: m.payerId.length,
      nameReturned: m.name !== "PayPal creator",
      emailReturned: Boolean(m.email),
    }),
  );
} else {
  console.error("usage: sandbox-login.ts url | exchange <code>");
  process.exit(2);
}
