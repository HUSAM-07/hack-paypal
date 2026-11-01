/** Step 10: PayPal-Mock-Response negative tests on an authorization capture and a vault MIT order. */
import { chargeMandate } from "../src/index";
import { client, loadState, probe, rid } from "./_lib";

const pp = client();
const { vaultId } = loadState();
if (!vaultId) throw new Error("run 03-payment-token.ts first");
const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

await probe("10-mock-declines", "vault MIT order with INSTRUMENT_DECLINED", async () => {
  const res = await chargeMandate(pp, {
    vaultId,
    amount: usd(100),
    customId: "spike_mock",
    mock: "INSTRUMENT_DECLINED",
    requestId: rid("10", "mit"),
  });
  return { unexpected: "no error", outcome: res.outcome };
});

const auth = await chargeMandate(pp, {
  vaultId,
  amount: usd(100),
  customId: "spike_mock",
  intent: "AUTHORIZE",
  requestId: rid("10", "auth"),
});
const authorizationId = auth.authorization?.id;
if (authorizationId) {
  await probe("10-mock-declines", "authorization capture with INSTRUMENT_DECLINED", async () => {
    const cap = await pp.authorizations.capture(
      authorizationId,
      {},
      { requestId: rid("10", "cap"), mock: "INSTRUMENT_DECLINED" },
    );
    return { unexpected: "no error", status: cap.status };
  });
  await pp.authorizations.void(authorizationId, { requestId: rid("10", "void") });
}
