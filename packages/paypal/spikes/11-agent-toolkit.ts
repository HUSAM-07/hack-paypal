/**
 * Step 11: the PayPal Agent Toolkit against the real sandbox, through our client's auth.
 *
 * 1. The toolkit's own `create_order` (buyer-approval order), then `get_order` and `pay_order`.
 * 2. The agent-checkout order shape (custom_id, items[].upc, and payee when
 *    PAYPAL_SANDBOX_BUSINESS2_EMAIL is set) created with our client, read
 *    back with the toolkit's `get_order`, then `pay_order`. Without a vaulted wallet the order
 *    waits for the buyer (PAYER_ACTION_REQUIRED); with `vaultId` in .state.json it is paid.
 */
import { MIT_UNSCHEDULED } from "../src/index";
import { client, env, loadState, mask, probe, rid } from "./_lib";

const pp = client();
const { vaultId } = loadState();
const payeeEmail = env("PAYPAL_SANDBOX_BUSINESS2_EMAIL");
const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

let toolkitOrderId: string | undefined;
await probe("11-agent-toolkit", "toolkit create_order (its own buyer-approval order)", async () => {
  const out = (await pp.agentToolkit.run(
    "create_order",
    {
      currencyCode: "USD",
      items: [{ name: "Winix A230", quantity: 1, itemCost: 95.99, itemTotal: 95.99 }],
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
    },
    { requestId: rid("11", "toolkit-create") },
  )) as { id: string; status: string; links?: { rel: string }[] };
  toolkitOrderId = out.id;
  return { status: out.status, links: out.links?.map((l) => l.rel) };
});

if (toolkitOrderId) {
  const id = toolkitOrderId;
  await probe("11-agent-toolkit", "toolkit get_order on it", async () => {
    const o = await pp.agentToolkit.getOrder(id);
    return { status: o.status };
  });
  await probe("11-agent-toolkit", "toolkit pay_order before the buyer approved", async () => {
    const o = await pp.agentToolkit.payOrder(id, { requestId: rid("11", "toolkit-pay") });
    return { status: o.status };
  });
}

const passport = "spike11.v1.not-a-real-passport";
let checkoutOrderId: string | undefined;
await probe(
  "11-agent-toolkit",
  `agent-checkout shape with our client (${payeeEmail ? "payee, " : ""}custom_id, upc; ${vaultId ? `vault ${mask(vaultId)}` : "no vault: buyer approval"})`,
  async () => {
    const o = await pp.orders.create(
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "lumen",
            ...(payeeEmail ? { payee: { email_address: payeeEmail } } : {}),
            custom_id: passport,
            amount: usd(9599),
            items: [
              {
                name: "Winix A230",
                quantity: 1,
                unit_amount: usd(9599),
                upc: "012345678905",
                category: "PHYSICAL_GOODS",
              },
            ],
          },
        ],
        payment_source: vaultId
          ? { paypal: { vault_id: vaultId, stored_credential: MIT_UNSCHEDULED } }
          : {
              paypal: {
                experience_context: {
                  return_url: "https://example.com/return",
                  cancel_url: "https://example.com/cancel",
                  user_action: "PAY_NOW",
                  shipping_preference: "NO_SHIPPING",
                },
              },
            },
      },
      { requestId: rid("11", "checkout-create") },
    );
    checkoutOrderId = o.id;
    return { status: o.status, payee: payeeEmail ? "second business account" : "app account" };
  },
);

if (checkoutOrderId) {
  const id = checkoutOrderId;
  await probe("11-agent-toolkit", "toolkit get_order: what PayPal holds", async () => {
    const o = await pp.agentToolkit.getOrder(id);
    const unit = o.purchase_units?.[0] as
      | { custom_id?: string; reference_id?: string; items?: { upc?: unknown }[] }
      | undefined;
    return {
      status: o.status,
      customIdKept: unit?.custom_id === passport,
      referenceId: unit?.reference_id,
      upc: unit?.items?.[0]?.upc ?? null,
    };
  });
  await probe("11-agent-toolkit", "toolkit pay_order", async () => {
    const o = await pp.agentToolkit.payOrder(id, { requestId: rid("11", "checkout-pay") });
    return { status: o.status };
  });
}
