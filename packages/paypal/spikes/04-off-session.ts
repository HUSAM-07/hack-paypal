/** Step 4: off-session (MIT) order with vault_id, with and without stored_credential. */
import { chargeMandate, MIT_UNSCHEDULED } from "../src/index";
import { client, loadState, probe, rid } from "./_lib";

const pp = client();
const { vaultId } = loadState();
if (!vaultId) throw new Error("run 03-payment-token.ts first");
const amount = { amountMinor: 100, currency: "USD" };

for (const [label, storedCredential] of [
  ["with stored_credential", MIT_UNSCHEDULED],
  ["without stored_credential", false],
] as const) {
  await probe("04-off-session", `CAPTURE ${label}`, async () => {
    const create = await pp.orders.create(
      {
        intent: "CAPTURE",
        purchase_units: [{ amount, custom_id: "spike_pact" }],
        payment_source: {
          paypal: {
            vault_id: vaultId,
            ...(storedCredential ? { stored_credential: storedCredential } : {}),
          },
        },
      },
      { requestId: rid("04", label.replaceAll(" ", "_")) },
    );
    const createStatus = create.status;
    // Same path the worker uses: capture only if PayPal didn't complete on create.
    const res = await chargeMandate(pp, {
      vaultId,
      amount,
      customId: "spike_pact",
      storedCredential,
      requestId: rid("04", `flow_${label.replaceAll(" ", "_")}`),
    });
    return {
      statusOnCreate: createStatus,
      flowOutcome: res.outcome,
      flowOrderStatus: res.orderStatus,
      captureStatus: res.capture?.status,
      orderId: res.orderId,
    };
  });
}
