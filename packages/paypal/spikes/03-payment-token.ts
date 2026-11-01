/** Step 3: after buyer approval, exchange the setup token for a vault payment token. */
import { completeMandateSetup } from "../src/index";
import { client, loadState, mask, probe, rid, saveState } from "./_lib";

const pp = client();
const { setupTokenId } = loadState();
if (!setupTokenId) throw new Error("run 02-setup-token.ts first");

await probe("03-payment-token", "setup token status after approval", async () => {
  const st = await pp.vault.setupTokens.get(setupTokenId);
  return { status: st.status };
});

await probe("03-payment-token", "POST /v3/vault/payment-tokens", async () => {
  const f = await completeMandateSetup(pp, { setupTokenId, requestId: rid("03", "pt") });
  saveState({ vaultId: f.vaultId, customerId: f.customerId });
  const list = await pp.vault.paymentTokens.list({ customer_id: f.customerId });
  return {
    vaultId: mask(f.vaultId),
    customerId: mask(f.customerId),
    payerEmailReturned: Boolean(f.payerEmail),
    payerIdReturned: Boolean(f.payerId),
    tokensForCustomer: list.payment_tokens.length,
  };
});
