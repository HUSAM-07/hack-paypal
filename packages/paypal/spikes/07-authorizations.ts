/** Step 7: AUTHORIZE (via vault), partial capture with final_capture:false, then void the rest. */
import { chargeMandate } from "../src/index";
import { client, loadState, probe, rid } from "./_lib";

const pp = client();
const { vaultId } = loadState();
if (!vaultId) throw new Error("run 03-payment-token.ts first");
const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

const auth = await probe("07-authorizations", "AUTHORIZE $5 off-session", async () => {
  const res = await chargeMandate(pp, {
    vaultId,
    amount: usd(500),
    customId: "spike_split",
    intent: "AUTHORIZE",
    requestId: rid("07", "auth"),
  });
  return {
    outcome: res.outcome,
    orderStatus: res.orderStatus,
    authorizationId: res.authorization?.id,
    authStatus: res.authorization?.status,
    expirationTime: res.authorization?.expiration_time,
  };
});
const authorizationId = auth?.authorizationId as string | undefined;
if (!authorizationId) process.exit(1);

await probe("07-authorizations", "partial capture $2 final_capture:false", async () => {
  const cap = await pp.authorizations.capture(
    authorizationId,
    { amount: usd(200), final_capture: false },
    { requestId: rid("07", "cap") },
  );
  const after = await pp.authorizations.get(authorizationId);
  return { captureStatus: cap.status, captured: cap.amount, authStatusAfter: after.status };
});

await probe("07-authorizations", "void remainder", async () => {
  const v = await pp.authorizations.void(authorizationId, { requestId: rid("07", "void") });
  const after = await pp.authorizations.get(authorizationId);
  return { voidBody: v ? v.status : "204 empty", authStatusAfter: after.status };
});

await probe(
  "07-authorizations",
  "void again (idempotency / already-voided issue name)",
  async () => {
    const v = await pp.authorizations.void(authorizationId, { requestId: rid("07", "void2") });
    return { voidBody: v ? v.status : "204 empty" };
  },
);
