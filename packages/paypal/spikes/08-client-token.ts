/**
 * Step 8 (server half): mint v6 client tokens. Eligibility (Venmo / Pay Later) and
 * clientId-vs-clientToken in the save session need a browser page; the web app verifies those.
 */
import { client, loadState, probe } from "./_lib";

const pp = client();

await probe("08-client-token", "client_token (no params)", async () => {
  const t = await pp.clientToken();
  return {
    ttlSeconds: Math.round((t.expiresAt - Date.now()) / 1000),
    looksLikeJwt: t.token.split(".").length === 3,
  };
});

await probe("08-client-token", "client_token with domains[]", async () => {
  const t = await pp.clientToken({ domains: ["localhost", "example.com"] });
  return { ttlSeconds: Math.round((t.expiresAt - Date.now()) / 1000) };
});

const { customerId } = loadState();
if (customerId) {
  await probe("08-client-token", "client_token with target_customer_id", async () => {
    const t = await pp.clientToken({ targetCustomerId: customerId });
    return { ttlSeconds: Math.round((t.expiresAt - Date.now()) / 1000) };
  });
}
