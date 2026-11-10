/**
 * Real PayPal sandbox proof: issue Winix's first-cycle statement through Invoicing v2 with the
 * same code the engine runs at cycle close, using the demo's numbers ($391.64 credited, $7.68
 * voided, $383.96 paid in sandbox Payouts batch ME2KV57B7KYNS, $616.04 of $1,000 returned).
 *
 *   npx tsx apps/engine/scripts/sandbox-statement.ts path/to/.env
 *
 * The env file needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_SANDBOX_MERCHANT_EMAIL (the
 * invoicer) and PAYPAL_SANDBOX_BUYER_EMAIL (standing in for the brand). Prints ids and statuses
 * only, never credentials, and masks emails. A re-run repeats the same request ids.
 */
import { readFileSync } from "node:fs";
import { createPayPal } from "@pact/paypal";
import { type Statement, settleStatementInvoice } from "../src/statements";

const file = process.argv[2];
if (!file) throw new Error("usage: sandbox-statement.ts <env file>");
const vars = new Map<string, string>();
for (const line of readFileSync(file, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  // A value may carry a note after a space: the first token is the value.
  if (m?.[1] && m[2] !== undefined) {
    vars.set(m[1], m[2].replace(/^["']|["']$/g, "").split(/\s+/)[0] ?? "");
  }
}
const need = (k: string) => {
  const v = vars.get(k);
  if (!v) throw new Error(`${k} missing from the env file`);
  return v;
};
const mask = (email: string) => email.replace(/^(.{2})[^@]*@.*$/, "$1***@***");

const st: Statement = {
  id: "stmt-sandbox-winix-cycle1",
  brandId: "winix",
  invoiceNumber: "CITED-WINIX-CYCLE1",
  invoiceId: null,
  status: "PENDING",
  currency: "USD",
  creditedMinor: 39_164,
  voidedMinor: 768,
  paidMinor: 38_396,
  returnedMinor: 61_604,
  depositedMinor: 100_000,
  reservedMinor: 0,
  invoiceTotalMinor: null,
  invoicePaidMinor: null,
  invoiceDueMinor: null,
  lines: [
    {
      creatorId: "housefresh",
      name: "HouseFresh",
      creditedMinor: 39_164,
      voidedMinor: 768,
      paidMinor: 38_396,
      credits: 51,
    },
  ],
  payoutBatchIds: ["ME2KV57B7KYNS"],
  refundIds: [],
  creditIds: [],
  recipientViewUrl: null,
  invoicerViewUrl: null,
  error: null,
  createdAt: new Date().toISOString(),
};

const paypal = createPayPal({
  clientId: need("PAYPAL_CLIENT_ID"),
  clientSecret: need("PAYPAL_CLIENT_SECRET"),
  env: "sandbox",
});
const invoicer = need("PAYPAL_SANDBOX_MERCHANT_EMAIL");
const recipient = need("PAYPAL_SANDBOX_BUYER_EMAIL");

await settleStatementInvoice(paypal, st, {
  brandName: "Winix",
  captureIds: [],
  day: new Date().toISOString().slice(0, 10),
  invoicerEmail: invoicer,
  recipientEmail: recipient,
  notifyRecipient: true,
});

const usd = (m: number | null) => (m === null ? "?" : `$${(m / 100).toFixed(2)}`);
console.log(
  JSON.stringify(
    {
      invoiceId: st.invoiceId,
      invoiceNumber: st.invoiceNumber,
      status: st.status,
      invoiced: usd(st.invoiceTotalMinor),
      recordedPaid: usd(st.invoicePaidMinor),
      due: usd(st.invoiceDueMinor),
      invoicer: mask(invoicer),
      recipient: mask(recipient),
      ledgerMatches:
        st.invoiceTotalMinor === st.paidMinor &&
        st.invoicePaidMinor === st.paidMinor &&
        st.invoiceDueMinor === 0,
    },
    null,
    2,
  ),
);
