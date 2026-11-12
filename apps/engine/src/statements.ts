/**
 * Brand statements through PayPal Invoicing v2.
 *
 * When a cycle closes, each brand gets an invoice that states what its deposit paid for:
 * one line per creator (commission credited on the sales that creator's test caused), the
 * credits voided by refunds or lost disputes taken off each line as an item discount, and the
 * unspent deposit returned in the note. The invoice total is exactly what was paid out.
 *
 * The brand prepaid through its deposit, so the invoice must not ask for money again: it is
 * sent without notifying anyone and then marked paid against the deposit capture with
 * `invoices/{id}/payments` (an external payment), leaving $0 due. A brand with nothing paid
 * gets a statement row with no PayPal invoice (PayPal will not issue a zero-total invoice).
 *
 * A statement covers the paid and voided credits no earlier statement covered, plus this
 * close's refunds. Its id, invoice number and every `PayPal-Request-Id` derive from those, so a
 * retried close repeats the same calls and never issues a second invoice.
 */
import { type CreateInvoiceInput, invoicePayerUrl, type PayPalClient } from "@pact/paypal";
import { nowOf } from "./clock";
import { loadStoredCredits, type StoredCredit } from "./credits";
import type { CycleBrandResult } from "./cycle";
import type { Env } from "./env";
import { loadWallets } from "./payout-wallet";
import { getPayPal } from "./paypal";
import { getBrand, listDeposits } from "./programme";

type Row = Record<string, unknown>;

export interface StatementLine {
  creatorId: string;
  name: string;
  creditedMinor: number;
  voidedMinor: number;
  paidMinor: number;
  credits: number;
  /** Set when this creator is paid to Venmo; absent means PayPal, as before. */
  wallet?: "VENMO";
}

export interface Statement {
  id: string;
  brandId: string;
  invoiceNumber: string;
  /** PayPal invoice id; null when nothing was paid (no invoice is issued). */
  invoiceId: string | null;
  /** PayPal invoice status (MARKED_AS_PAID once settled), NO_CHARGE, or FAILED. */
  status: string;
  currency: string;
  creditedMinor: number;
  voidedMinor: number;
  paidMinor: number;
  returnedMinor: number;
  depositedMinor: number;
  /** Pending credits still in their hold: not on this statement, carried to the next. */
  reservedMinor: number;
  /** What PayPal says: invoice total, recorded payment, amount due. */
  invoiceTotalMinor: number | null;
  invoicePaidMinor: number | null;
  invoiceDueMinor: number | null;
  lines: StatementLine[];
  payoutBatchIds: string[];
  refundIds: string[];
  creditIds: string[];
  recipientViewUrl: string | null;
  invoicerViewUrl: string | null;
  error: string | null;
  createdAt: string;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const usd = (minor: number, currency: string) =>
  `${currency === "USD" ? "$" : `${currency} `}${(minor / 100).toFixed(2)}`;

/** Per-creator lines from the credits a statement covers. Pure: the tests pin it. */
export function statementLines(
  credits: readonly Pick<StoredCredit, "creatorId" | "amount" | "state">[],
  names: ReadonlyMap<string, string>,
  venmo: ReadonlySet<string> = new Set(),
): StatementLine[] {
  const by = new Map<string, StatementLine>();
  for (const c of credits) {
    const l = by.get(c.creatorId) ?? {
      creatorId: c.creatorId,
      name: names.get(c.creatorId) ?? c.creatorId,
      creditedMinor: 0,
      voidedMinor: 0,
      paidMinor: 0,
      credits: 0,
      ...(venmo.has(c.creatorId) ? { wallet: "VENMO" as const } : {}),
    };
    l.creditedMinor += c.amount.amountMinor;
    if (c.state === "voided") l.voidedMinor += c.amount.amountMinor;
    if (c.state === "paid") l.paidMinor += c.amount.amountMinor;
    l.credits += 1;
    by.set(c.creatorId, l);
  }
  return [...by.values()].sort((a, b) => (a.creatorId < b.creatorId ? -1 : 1));
}

function toStatement(r: Row): Statement {
  const json = <T>(k: string) => JSON.parse((r[k] as string) ?? "[]") as T;
  return {
    id: r.id as string,
    brandId: r.brand_id as string,
    invoiceNumber: r.invoice_number as string,
    invoiceId: (r.invoice_id as string | null) ?? null,
    status: r.status as string,
    currency: r.currency as string,
    creditedMinor: r.credited_minor as number,
    voidedMinor: r.voided_minor as number,
    paidMinor: r.paid_minor as number,
    returnedMinor: r.returned_minor as number,
    depositedMinor: r.deposited_minor as number,
    reservedMinor: r.reserved_minor as number,
    invoiceTotalMinor: (r.invoice_total_minor as number | null) ?? null,
    invoicePaidMinor: (r.invoice_paid_minor as number | null) ?? null,
    invoiceDueMinor: (r.invoice_due_minor as number | null) ?? null,
    lines: json<StatementLine[]>("lines_json"),
    payoutBatchIds: json<string[]>("payout_batch_ids_json"),
    refundIds: json<string[]>("refund_ids_json"),
    creditIds: json<string[]>("credit_ids_json"),
    recipientViewUrl: (r.recipient_view_url as string | null) ?? null,
    invoicerViewUrl: (r.invoicer_view_url as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export async function listStatements(env: Env, brandId?: string): Promise<Statement[]> {
  const q = brandId
    ? env.DB.prepare("SELECT * FROM brand_statements WHERE brand_id = ? ORDER BY rowid").bind(
        brandId,
      )
    : env.DB.prepare("SELECT * FROM brand_statements ORDER BY rowid");
  return (await q.all<Row>()).results.map(toStatement);
}

const FINAL = new Set(["MARKED_AS_PAID", "PAID", "NO_CHARGE"]);

/** Issue (or finish issuing) one statement per brand in a cycle close. Never throws. */
export async function issueStatements(
  env: Env,
  cycle: readonly CycleBrandResult[],
): Promise<Statement[]> {
  const credits = await loadStoredCredits(env);
  const names = new Map(
    (await env.DB.prepare("SELECT creator_id, name FROM creators").all<Row>()).results.map((r) => [
      r.creator_id as string,
      r.name as string,
    ]),
  );
  const venmo = new Set(
    [...(await loadWallets(env))].filter(([, w]) => w.venmo).map(([creatorId]) => creatorId),
  );
  const out: Statement[] = [];
  for (const b of cycle) {
    const s = await issueOne(env, b, credits, names, venmo);
    if (s) out.push(s);
  }
  return out;
}

async function issueOne(
  env: Env,
  b: CycleBrandResult,
  credits: readonly StoredCredit[],
  names: ReadonlyMap<string, string>,
  venmo: ReadonlySet<string>,
): Promise<Statement | null> {
  const brand = await getBrand(env, b.brandId);
  if (!brand) return null;
  const prior = await listStatements(env, b.brandId);
  const stated = new Set(prior.flatMap((s) => s.creditIds));
  const covered = credits.filter(
    (c) => c.brandId === b.brandId && c.state !== "pending" && !stated.has(c.id),
  );
  const refundIds = b.refunds.map((r) => r.refundId);
  if (covered.length === 0 && refundIds.length === 0) return null;

  const creditIds = covered.map((c) => c.id).sort();
  const hash = await sha256Hex(`${b.brandId}|${creditIds.join(",")}|${refundIds.join(",")}`);
  const id = `stmt-${hash.slice(0, 24)}`;
  const existing = prior.find((s) => s.id === id);
  if (existing && FINAL.has(existing.status)) return existing;

  // Venmo takes US dollars only; a creator paid in another currency was paid through PayPal.
  const lines = statementLines(covered, names, brand.currency === "USD" ? venmo : new Set());
  const sum = (k: "creditedMinor" | "voidedMinor" | "paidMinor") =>
    lines.reduce((a, l) => a + l[k], 0);
  const now = await nowOf(env);
  const tag = b.brandId
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
  const st: Statement = existing ?? {
    id,
    brandId: b.brandId,
    invoiceNumber: `CITED-${tag}-${hash.slice(0, 8).toUpperCase()}`,
    invoiceId: null,
    status: "PENDING",
    currency: brand.currency,
    creditedMinor: sum("creditedMinor"),
    voidedMinor: sum("voidedMinor"),
    paidMinor: sum("paidMinor"),
    returnedMinor: b.returnedNow,
    depositedMinor: b.deposited,
    reservedMinor: b.reserved,
    invoiceTotalMinor: null,
    invoicePaidMinor: null,
    invoiceDueMinor: null,
    lines,
    payoutBatchIds: [
      ...new Set(covered.flatMap((c) => (c.payoutBatchId ? [c.payoutBatchId] : []))),
    ].sort(),
    refundIds,
    creditIds,
    recipientViewUrl: null,
    invoicerViewUrl: null,
    error: null,
    createdAt: now,
  };

  if (st.paidMinor === 0) {
    st.status = "NO_CHARGE";
  } else {
    try {
      await invoiceStatement(env, st, brand.name, now);
    } catch (e) {
      st.status = "FAILED";
      st.error = (e as Error).message.slice(0, 500);
    }
  }
  await save(env, st, now);
  return st;
}

async function invoiceStatement(env: Env, st: Statement, brandName: string, now: string) {
  const deposits = (await listDeposits(env, st.brandId)).filter((d) => d.captureId);
  await settleStatementInvoice(getPayPal(env).paypal, st, {
    brandName,
    captureIds: deposits.map((d) => d.captureId as string),
    day: now.slice(0, 10),
    recipientEmail: env.STATEMENT_RECIPIENT_EMAIL ?? `billing@${st.brandId}.example.com`,
  });
}

export interface StatementInvoiceOptions {
  brandName: string;
  /** The deposit captures the statement is settled against. */
  captureIds: readonly string[];
  /** yyyy-MM-dd */
  day: string;
  recipientEmail: string;
  /** The PayPal account issuing it; PayPal defaults to the API caller's. */
  invoicerEmail?: string;
  /** Email the statement to the recipient. Off by default: nothing is due, so nobody is billed. */
  notifyRecipient?: boolean;
}

/** The Invoicing v2 body for a statement: one line per creator, voids as item discounts. */
export function statementInvoice(st: Statement, o: StatementInvoiceOptions): CreateInvoiceInput {
  const cur = st.currency;
  const money = (amountMinor: number) => ({ amountMinor, currency: cur });
  return {
    detail: {
      currency_code: cur,
      invoice_number: st.invoiceNumber,
      invoice_date: o.day,
      reference: `CITED programme statement · ${o.brandName}`.slice(0, 120),
      note: statementNote(st, o.captureIds).slice(0, 4000),
      memo: `CITED ${st.id}`.slice(0, 500),
    },
    ...(o.invoicerEmail ? { invoicer: { email_address: o.invoicerEmail } } : {}),
    primary_recipients: [{ billing_info: { email_address: o.recipientEmail } }],
    items: st.lines
      .filter((l) => l.creditedMinor > 0)
      .slice(0, 100)
      .map((l) => ({
        name: `Commission credited: ${l.name}`.slice(0, 200),
        description: (
          `${l.credits} credit${l.credits === 1 ? "" : "s"} on sales ${l.name}'s test caused (lift at the 80% lower bound)` +
          (l.voidedMinor
            ? `; ${usd(l.voidedMinor, cur)} voided by refunds or lost disputes, taken off as a discount`
            : "") +
          `; ${usd(l.paidMinor, cur)} paid through PayPal Payouts${l.wallet === "VENMO" ? " to Venmo" : ""}.`
        ).slice(0, 1000),
        quantity: "1",
        unit_amount: money(l.creditedMinor),
        ...(l.voidedMinor ? { discount: { amount: money(l.voidedMinor) } } : {}),
        item_date: o.day,
      })),
  };
}

/**
 * Create, send and mark paid the statement's invoice, resuming wherever an earlier attempt
 * stopped. Every call carries a request id derived from the statement id.
 */
export async function settleStatementInvoice(
  paypal: PayPalClient,
  st: Statement,
  o: StatementInvoiceOptions,
): Promise<void> {
  if (!st.invoiceId) {
    const created = await paypal.invoicing.create(statementInvoice(st, o), {
      requestId: `cited-stmt-create:${st.id}`,
    });
    st.invoiceId = created.id;
    st.status = created.status;
  }
  const id = st.invoiceId;
  let inv = await paypal.invoicing.get(id);
  if (inv.status === "DRAFT") {
    // A statement, not a bill: by default nobody is emailed and nothing asks for payment.
    await paypal.invoicing.send(
      id,
      { send_to_invoicer: false, send_to_recipient: o.notifyRecipient === true },
      { requestId: `cited-stmt-send:${st.id}` },
    );
    inv = await paypal.invoicing.get(id);
  }
  if (inv.status === "SENT" || inv.status === "UNPAID" || inv.status === "PARTIALLY_PAID") {
    await paypal.invoicing.recordPayment(
      id,
      {
        method: "OTHER",
        payment_date: o.day,
        amount: { amountMinor: st.paidMinor, currency: st.currency },
        note: (o.captureIds.length
          ? `Settled from the prepaid CITED programme deposit (PayPal capture ${o.captureIds.join(", ")}).`
          : "Settled from the prepaid CITED programme deposit."
        ).slice(0, 2000),
      },
      { requestId: `cited-stmt-pay:${st.id}` },
    );
    inv = await paypal.invoicing.get(id);
  }
  st.status = inv.status;
  st.invoiceTotalMinor = inv.amount?.amountMinor ?? null;
  st.invoicePaidMinor = inv.payments?.paid_amount?.amountMinor ?? 0;
  st.invoiceDueMinor = inv.due_amount?.amountMinor ?? null;
  st.recipientViewUrl = invoicePayerUrl(inv) ?? null;
  st.invoicerViewUrl = inv.detail?.metadata?.invoicer_view_url ?? null;
  st.error = null;
}

export function statementNote(
  st: Pick<
    Statement,
    | "currency"
    | "creditedMinor"
    | "voidedMinor"
    | "paidMinor"
    | "returnedMinor"
    | "depositedMinor"
    | "reservedMinor"
    | "payoutBatchIds"
    | "refundIds"
  >,
  captureIds: readonly string[],
): string {
  const u = (m: number) => usd(m, st.currency);
  return [
    "CITED pays creators only for the sales their tests caused. This statement is settled from your prepaid programme deposit: nothing is due.",
    `Programme deposit: ${u(st.depositedMinor)}${captureIds.length ? ` (PayPal capture ${captureIds.join(", ")})` : ""}.`,
    `Commission credited: ${u(st.creditedMinor)}. Voided by refunds or lost disputes: −${u(st.voidedMinor)}. Paid to creators: ${u(st.paidMinor)}${st.payoutBatchIds.length ? ` (PayPal Payouts ${st.payoutBatchIds.join(", ")})` : ""}.`,
    `Unspent deposit returned this cycle: ${u(st.returnedMinor)}${st.refundIds.length ? ` (PayPal refund ${st.refundIds.join(", ")})` : ""}.`,
    ...(st.reservedMinor
      ? [`Still in the 30-day hold, carried to the next statement: ${u(st.reservedMinor)}.`]
      : []),
  ].join("\n");
}

async function save(env: Env, st: Statement, now: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO brand_statements (id, brand_id, invoice_number, invoice_id, status, currency,
       credited_minor, voided_minor, paid_minor, returned_minor, deposited_minor, reserved_minor,
       invoice_total_minor, invoice_paid_minor, invoice_due_minor, lines_json,
       payout_batch_ids_json, refund_ids_json, credit_ids_json, recipient_view_url,
       invoicer_view_url, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET invoice_id = excluded.invoice_id, status = excluded.status,
       invoice_total_minor = excluded.invoice_total_minor,
       invoice_paid_minor = excluded.invoice_paid_minor,
       invoice_due_minor = excluded.invoice_due_minor,
       recipient_view_url = excluded.recipient_view_url,
       invoicer_view_url = excluded.invoicer_view_url, error = excluded.error,
       updated_at = excluded.updated_at`,
  )
    .bind(
      st.id,
      st.brandId,
      st.invoiceNumber,
      st.invoiceId,
      st.status,
      st.currency,
      st.creditedMinor,
      st.voidedMinor,
      st.paidMinor,
      st.returnedMinor,
      st.depositedMinor,
      st.reservedMinor,
      st.invoiceTotalMinor,
      st.invoicePaidMinor,
      st.invoiceDueMinor,
      JSON.stringify(st.lines),
      JSON.stringify(st.payoutBatchIds),
      JSON.stringify(st.refundIds),
      JSON.stringify(st.creditIds),
      st.recipientViewUrl,
      st.invoicerViewUrl,
      st.error,
      st.createdAt,
      now,
    )
    .run();
}
