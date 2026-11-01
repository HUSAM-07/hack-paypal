/** Step 6: Payouts to a sandbox personal email (PAYPAL wallet), then the Venmo wallet. */
import { sendP2P } from "../src/index";
import { client, env, probe, rid } from "./_lib";

const pp = client();
const receiver = env("PAYPAL_SANDBOX_RECIPIENT_EMAIL");
if (!receiver) throw new Error("set PAYPAL_SANDBOX_RECIPIENT_EMAIL");
const venmoPhone = env("PAYPAL_SANDBOX_VENMO_PHONE");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function payout(
  label: string,
  wallet: "PAYPAL" | "VENMO",
  recipient: string,
  type: "EMAIL" | "PHONE",
) {
  await probe("06-payouts", label, async () => {
    const batchId = `spike-${wallet.toLowerCase()}-${Date.now()}`;
    const sent = await sendP2P(pp, {
      receiver: recipient,
      recipientType: type,
      wallet,
      amount: { amountMinor: 100, currency: "USD" },
      senderBatchId: batchId,
      note: "Pact spike",
      requestId: rid("06", wallet),
    });
    let batch = await pp.payouts.getBatch(sent.payoutBatchId);
    for (
      let i = 0;
      i < 6 && ["PENDING", "PROCESSING"].includes(batch.batch_header.batch_status);
      i++
    ) {
      await sleep(5000);
      batch = await pp.payouts.getBatch(sent.payoutBatchId);
    }
    const item = batch.items[0];
    return {
      payoutBatchId: sent.payoutBatchId,
      initialStatus: sent.batchStatus,
      batchStatus: batch.batch_header.batch_status,
      itemStatus: item?.transaction_status,
      itemError: item?.errors?.name,
    };
  });
}

await payout("PAYPAL wallet → personal email", "PAYPAL", receiver, "EMAIL");
await payout("VENMO wallet", "VENMO", venmoPhone ?? receiver, venmoPhone ? "PHONE" : "EMAIL");
