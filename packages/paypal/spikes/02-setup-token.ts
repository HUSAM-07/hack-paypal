/** Step 2: Vault setup token (save without purchase). Expect 201 PAYER_ACTION_REQUIRED, not NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE. */
import { startMandateSetup } from "../src/index";
import { client, probe, rid, saveState } from "./_lib";

const pp = client();

await probe("02-setup-token", "POST /v3/vault/setup-tokens", async () => {
  const res = await startMandateSetup(pp, {
    returnUrl: "https://example.com/pact/vault/return",
    cancelUrl: "https://example.com/pact/vault/cancel",
    requestId: rid("02", "setup"),
  });
  saveState({ setupTokenId: res.setupTokenId, approveUrl: res.approveUrl ?? "" });
  console.log(
    `\n  Approve as the sandbox BUYER (personal) account:\n  ${res.approveUrl}\n  then run 03-payment-token.ts`,
  );
  return {
    setupTokenId: res.setupTokenId,
    status: res.status,
    hasApproveUrl: Boolean(res.approveUrl),
  };
});
