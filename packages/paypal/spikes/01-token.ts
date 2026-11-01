/** Step 1: app token works, and the app has Vault / Payouts / Log in with PayPal enabled (via token scopes). */
import { client, probe, rawToken } from "./_lib";

const pp = client();

await probe("01-token", "client_credentials token + feature scopes", async () => {
  const body = await rawToken();
  const scopes = (body.scope ?? "").split(" ");
  const has = (needle: string) => scopes.some((s) => s.includes(needle));
  return {
    status: body.status,
    expiresIn: body.expires_in,
    appId: body.app_id,
    vault: has("vault"),
    payouts: has("payouts"),
    identity: has("openid") || has("identity"),
    invoicing: has("invoicing"),
    scopeCount: scopes.length,
  };
});

await probe("01-token", "client methods authenticate (GET unknown order → 404)", async () => {
  try {
    await pp.orders.get("DOES-NOT-EXIST");
    return { unexpected: "order found" };
  } catch (e) {
    return {
      authenticated: (e as { status?: number }).status === 404,
      status: (e as { status?: number }).status,
    };
  }
});
