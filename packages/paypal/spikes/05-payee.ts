/** Step 5: purchase_units[].payee routing — business, personal, and multiple payees in one order (paid off-session via vault). */
import { client, env, loadState, probe, rid } from "./_lib";

const pp = client();
const { vaultId } = loadState();
if (!vaultId) throw new Error("run 03-payment-token.ts first");
const business2 = env("PAYPAL_SANDBOX_BUSINESS2_EMAIL");
const personal = env("PAYPAL_SANDBOX_RECIPIENT_EMAIL");
const amount = { amountMinor: 100, currency: "USD" };
const source = { paypal: { vault_id: vaultId } };

async function payTo(label: string, payees: string[]) {
  await probe("05-payee", label, async () => {
    const order = await pp.orders.create(
      {
        intent: "CAPTURE",
        purchase_units: payees.map((email, i) => ({
          reference_id: `pu${i}`,
          amount,
          payee: { email_address: email },
        })),
        payment_source: source,
      },
      { requestId: rid("05", label.replaceAll(" ", "_")) },
    );
    let final = order;
    if (order.status === "APPROVED")
      final = await pp.orders.capture(order.id, { requestId: rid("05", "cap") });
    return {
      statusOnCreate: order.status,
      finalStatus: final.status,
      captures: final.purchase_units?.map((u) => u.payments?.captures?.[0]?.status ?? "none"),
      orderId: order.id,
    };
  });
}

if (business2) await payTo("payee = second business account", [business2]);
else console.log("skip: PAYPAL_SANDBOX_BUSINESS2_EMAIL not set");
if (personal) await payTo("payee = personal account", [personal]);
else console.log("skip: PAYPAL_SANDBOX_RECIPIENT_EMAIL not set");
if (business2 && personal) await payTo("two payees in one order", [business2, personal]);
