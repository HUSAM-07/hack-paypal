# @pact/paypal

A typed PayPal REST client for Cloudflare Workers. It uses `fetch` and WebCrypto, with no Node SDKs and no `nodejs_compat`.

There's no policy logic in here. **Every caller of a mutating method or money flow must get `allow` from `authorize()` (`@pact/policy`) first.**

```ts
import { createPayPal, chargeMandate, idempotencyKey } from "@pact/paypal";

const pp = createPayPal({
  clientId: env.PAYPAL_CLIENT_ID,
  clientSecret: env.PAYPAL_CLIENT_SECRET,
  env: "sandbox",
  cache: kvStore(env.KV), // any { get, put(k, v, { ttlSeconds }), delete }
  onRequest: (l) => console.log(l.method, l.route, l.status, l.debugId), // route templates only
});

const decision = authorize(intent, mandate, ledger);
if (decision.outcome === "allow") {
  const res = await chargeMandate(pp, {
    vaultId,
    amount,
    customId: pactId,
    requestId: await idempotencyKey(pactId, runId, userId),
  });
}
```

## Surface

| Area | Calls |
|---|---|
| Orders | `pp.orders.create / get / authorize / capture`, `orderApproveUrl(order)` |
| Payments | `pp.authorizations.get / capture / void / reauthorize`, `pp.captures.get / refund` |
| Vault | `pp.vault.setupTokens.create / get`, `pp.vault.paymentTokens.create / get / list / delete` |
| Payouts | `pp.payouts.createBatch / getBatch / getItem` |
| Invoicing | `pp.invoicing.create / send / get / cancel`, `invoicePayerUrl(inv)` |
| Identity | `pp.identity.authorizeUrl / exchangeCode / refresh / userinfo`, `primaryEmail(info)` |
| JS SDK v6 | `pp.clientToken({ domains?, targetCustomerId?, vaultId? })` |
| Webhooks | `verifyWebhook({ strategy: "postback" \| "self", … })`, `pp.webhooks.verifyByPostback / verifySelf`, `parseWebhookEvent(raw)`, `createWebhookDeduper(store)` |
| Flows | `startMandateSetup`, `completeMandateSetup`, `chargeMandate`, `groupAuthorizeAll`, `captureAll`, `voidAll`, `sendP2P`, `requestP2P`, `idempotencyKey` |

## Conventions

- **Money:** amounts go in and come out as `Money` (integer minor units). PayPal decimal strings never leave the package, and float inputs are rejected before any request.
- **Shape:** request and response shapes mirror the REST docs (snake_case), except that amounts are `Money`.
- **Idempotency:** every mutating call requires `{ requestId }` (1–108 chars), sent as `PayPal-Request-Id`. Flows derive sub-step keys as `<requestId>:capture`, `<prefix>:<memberId>:void`, and so on.
- **Retries:** only on 429, 5xx and network errors, only for idempotent calls, and at most `maxRetries` (default 2). `Retry-After` is honored. A 401 on the app token drops the cached token and retries once.
- **Errors:** failures throw `PayPalError` with `status`, `code` (PayPal's `name`), `debugId`, `details[].issue`, and the `route` template. Echoed `details[].value` fields are dropped because they can contain vault IDs.
- **Mocks:** `{ mock: "INSTRUMENT_DECLINED" }` sets `PayPal-Mock-Response`. It works on sandbox only and is refused on live.
- **Vault IDs:** a vault ID returned by `completeMandateSetup` is a server-side secret. Store it behind `Mandate.fundingRef`.

## Webhooks in the worker

```ts
const raw = await req.text(); // verify the raw bytes before parsing
const v = await pp.webhooks.verifySelf({
  webhookId: env.PAYPAL_WEBHOOK_ID,
  headers: req.headers,
  rawBody: raw,
  certCache,
});
if (!v.ok) return new Response(v.reason, { status: 400 });
const parsed = parseWebhookEvent(raw);
const id = parsed.known ? parsed.event.id : parsed.id;
if (!(await dedupe.claim(id))) return new Response("dup");
```

## Spikes

These are sandbox verification scripts. They read `PAYPAL_*` from the nearest `.env` and live in `spikes/`. See "Verification status" in `docs/paypal-capabilities.md`.

```bash
npx tsx spikes/01-token.ts
```
