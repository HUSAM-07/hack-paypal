/**
 * A stateful, in-memory PayPal for `PAYPAL_MODE=simulated`.
 *
 * It is a `fetch` implementation: hand `mock.fetch` to `createPayPal({ fetch })` and the
 * normal typed client talks to it exactly as it would to the sandbox. State covers what
 * CITED needs: OAuth token, Orders v2 (create / get / capture, `payee`, and create-and-capture
 * against a vaulted PayPal wallet), buyer approval, capture get and (partial) refunds,
 * disputes, Payouts batches, and the webhook events those
 * produce. Mutating calls honour `PayPal-Request-Id` (replays return the original
 * response). Webhooks are signed like PayPal's, so `verifyWebhookSelf` accepts them.
 *
 * Money stays integer minor units internally; PayPal decimal strings are produced only
 * at the edge with `toPayPalValue`.
 */
import { fromPayPalValue, type Money, toPayPalValue } from "@pact/protocol";
import { makeTestCert, signWebhook, type TestSigner } from "../testing/x509";

export const MOCK_API_BASE = "https://api-m.sandbox.paypal.com";
export const MOCK_WEB_BASE = "https://www.sandbox.paypal.com";
export const MOCK_CERT_URL = `${MOCK_API_BASE}/v1/notifications/certs/CERT-mock`;
export const MOCK_WEBHOOK_ID = "WH-MOCK-0001";

type Json = Record<string, unknown>;

export interface MockWebhookEvent {
  id: string;
  event_type: string;
  resource_type: string;
  resource_version: string;
  summary: string;
  create_time: string;
  resource: unknown;
  links: { href: string; rel: string; method: string }[];
}

export interface WebhookDelivery {
  event: MockWebhookEvent;
  rawBody: string;
  headers: Record<string, string>;
}

export type WebhookHandler = (d: WebhookDelivery) => void | Promise<void>;

export interface MockPayPalOptions {
  now?: () => number;
  /** The `webhookId` the engine verifies against. */
  webhookId?: string;
  /** Used to POST to registered callback URLs. Defaults to global fetch. */
  deliverFetch?: typeof fetch;
  /** Settle payout batches (and emit their events) right after creation. Default false. */
  autoSettlePayouts?: boolean;
  /** Fixed-rate PayPal fee: `bps` of the amount plus `fixedMinor`. Default 2.9% + 30. */
  fee?: { bps: number; fixedMinor: number };
  /**
   * Where the id counter starts (default 0). A mock that restarts while its earlier orders,
   * captures and events live on in a database must start past them, or ids repeat.
   */
  idOffset?: number;
}

interface StoredOrder {
  id: string;
  intent: string;
  status: "CREATED" | "APPROVED" | "COMPLETED";
  units: Json[];
  createTime: string;
  updateTime: string;
  captureIds: string[];
  /** Set when the order was paid with a vaulted PayPal wallet (no buyer approval step). */
  vaultId?: string;
}

export interface VaultedWallet {
  /** The `vault_id` a merchant or platform charges with `payment_source.paypal.vault_id`. */
  id: string;
  payerId: string;
  email: string;
}

/** The payee PayPal assumes when an order names none: the API caller's own account. */
export const MOCK_DEFAULT_PAYEE = {
  email_address: "merchant@example.com",
  merchant_id: "MOCKMERCHANT01",
};

interface StoredCapture {
  id: string;
  orderId: string;
  amount: Money;
  fee: Money;
  refunded: number;
  customId?: string;
  invoiceId?: string;
  /** Who received the money: the order's `payee`, else the caller. */
  payee: { email_address?: string; merchant_id?: string };
  refundIds: string[];
  createTime: string;
  updateTime: string;
}

interface StoredRefund {
  id: string;
  captureId: string;
  amount: Money;
  note?: string;
  createTime: string;
}

interface StoredPayoutItem {
  id: string;
  txId: string;
  req: Json;
  amount: Money;
  fee: Money;
  status: "PENDING" | "SUCCESS";
  processed?: string;
}

interface StoredBatch {
  id: string;
  header: Json;
  status: "PENDING" | "SUCCESS";
  items: StoredPayoutItem[];
  createTime: string;
  completeTime?: string;
}

export interface StoredInvoice {
  id: string;
  number: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_PAID" | "MARKED_AS_PAID" | "CANCELLED";
  currency: string;
  /** Sum of qty × unit price. */
  itemTotal: Money;
  /** Sum of item-level discounts. */
  discount: Money;
  /** itemTotal − discount: what the invoice asks for. */
  amount: Money;
  paid: Money;
  request: Json;
  payments: { paymentId: string; method: string; date: string; amount: Money; note?: string }[];
  createTime: string;
}

export interface Dispute {
  dispute_id: string;
  captureId: string;
  reason: string;
  amount: Money;
  status: "OPEN" | "RESOLVED";
  /** PayPal's `dispute_outcome.outcome_code`, once resolved. */
  outcome?: DisputeOutcome;
}

/** The outcome codes the mock can resolve a dispute with (PayPal `dispute_outcome.outcome_code`). */
export type DisputeOutcome = "RESOLVED_SELLER_FAVOUR" | "RESOLVED_BUYER_FAVOUR";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Json,
  ) {
    super(String(body.message ?? body.name));
  }
}

const fail = (status: number, name: string, message: string, issue?: string) =>
  new HttpError(status, {
    name,
    message,
    debug_id: "mock-debug-id",
    details: issue ? [{ issue, description: message }] : [],
    links: [],
  });

export function createMockPayPal(opts: MockPayPalOptions = {}) {
  const now = opts.now ?? Date.now;
  const webhookId = opts.webhookId ?? MOCK_WEBHOOK_ID;
  const feeRate = opts.fee ?? { bps: 290, fixedMinor: 30 };
  const deliverFetch: typeof fetch = opts.deliverFetch ?? ((i, init) => fetch(i, init));

  const orders = new Map<string, StoredOrder>();
  const captures = new Map<string, StoredCapture>();
  const refunds = new Map<string, StoredRefund>();
  const batches = new Map<string, StoredBatch>();
  const batchBySenderId = new Map<string, string>();
  const disputes = new Map<string, Dispute>();
  const invoices = new Map<string, StoredInvoice>();
  const wallets = new Map<string, VaultedWallet>();
  const idempotency = new Map<string, { status: number; body: Json; fingerprint: string }>();
  const targets: { url?: string; handler?: WebhookHandler }[] = [];
  const events: MockWebhookEvent[] = [];
  const failedDeliveries: { url: string; error: string }[] = [];
  const pending = new Set<Promise<unknown>>();
  let signer: Promise<TestSigner> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let seq = Math.max(0, Math.floor(opts.idOffset ?? 0));

  const iso = () => new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const id = (prefix: string, len = 17) =>
    `${prefix}${(++seq)
      .toString(36)
      .toUpperCase()
      .padStart(len - prefix.length, "0")}`;
  const amountJson = (m: Money) => ({ currency_code: m.currency, value: toPayPalValue(m) });
  const payoutJson = (m: Money) => ({ currency: m.currency, value: toPayPalValue(m) });
  const link = (rel: string, href: string, method = "GET") => ({ href, rel, method });

  function parseAmount(v: unknown, key: "currency_code" | "currency", where: string): Money {
    const a = v as Json | undefined;
    if (!a || typeof a[key] !== "string" || typeof a.value !== "string") {
      throw fail(422, "INVALID_REQUEST", `${where} is invalid.`, "MISSING_REQUIRED_PARAMETER");
    }
    try {
      const m = fromPayPalValue(a.value, a[key]);
      if (m.amountMinor <= 0) throw new Error("must be positive");
      return m;
    } catch {
      throw fail(422, "UNPROCESSABLE_ENTITY", `${where} is invalid.`, "INVALID_PARAMETER_VALUE");
    }
  }

  const feeFor = (m: Money): Money => ({
    amountMinor: Math.round((m.amountMinor * feeRate.bps) / 10_000) + feeRate.fixedMinor,
    currency: m.currency,
  });

  // ---------- webhooks ----------

  function registerWebhook(target: string | WebhookHandler) {
    targets.push(typeof target === "string" ? { url: target } : { handler: target });
  }

  async function sign(rawBody: string, eventId: string): Promise<Record<string, string>> {
    signer ??= makeTestCert({
      notBefore: new Date(now() - 86_400_000),
      notAfter: new Date(now() + 365 * 86_400_000),
    });
    return signWebhook(await signer, {
      rawBody,
      webhookId,
      transmissionId: eventId,
      transmissionTime: iso(),
      certUrl: MOCK_CERT_URL,
    });
  }

  function emit(event_type: string, resource_type: string, summary: string, resource: unknown) {
    const eventId = id("WH-", 20);
    const event: MockWebhookEvent = {
      id: eventId,
      event_type,
      resource_type,
      resource_version: event_type.startsWith("CUSTOMER.DISPUTE") ? "1.0" : "2.0",
      summary,
      create_time: iso(),
      resource,
      links: [link("self", `${MOCK_API_BASE}/v1/notifications/webhooks-events/${eventId}`)],
    };
    events.push(event);
    if (targets.length === 0) return;
    // Chained so events reach every target in the order they were emitted.
    const job = chain.then(async () => {
      const rawBody = JSON.stringify(event);
      const headers = {
        "content-type": "application/json",
        ...(await sign(rawBody, eventId)),
      };
      for (const t of targets) {
        try {
          if (t.handler) await t.handler({ event, rawBody, headers });
          else if (t.url) {
            const res = await deliverFetch(t.url, { method: "POST", headers, body: rawBody });
            if (!res.ok) failedDeliveries.push({ url: t.url, error: `HTTP ${res.status}` });
          }
        } catch (e) {
          failedDeliveries.push({
            url: t.url ?? "handler",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });
    chain = job.catch(() => {});
    pending.add(job);
    job.finally(() => pending.delete(job));
  }

  // ---------- resource renderers ----------

  function captureJson(c: StoredCapture): Json {
    const refunded = c.refunded;
    const status =
      refunded === 0
        ? "COMPLETED"
        : refunded >= c.amount.amountMinor
          ? "REFUNDED"
          : "PARTIALLY_REFUNDED";
    const net = {
      amountMinor: c.amount.amountMinor - c.fee.amountMinor,
      currency: c.amount.currency,
    };
    return {
      id: c.id,
      status,
      amount: amountJson(c.amount),
      final_capture: true,
      disbursement_mode: "INSTANT",
      seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED"] },
      seller_receivable_breakdown: {
        gross_amount: amountJson(c.amount),
        paypal_fee: amountJson(c.fee),
        net_amount: amountJson(net),
      },
      ...(c.customId ? { custom_id: c.customId } : {}),
      ...(c.invoiceId ? { invoice_id: c.invoiceId } : {}),
      links: [
        link("self", `${MOCK_API_BASE}/v2/payments/captures/${c.id}`),
        link("refund", `${MOCK_API_BASE}/v2/payments/captures/${c.id}/refund`, "POST"),
        link("up", `${MOCK_API_BASE}/v2/checkout/orders/${c.orderId}`),
      ],
      create_time: c.createTime,
      update_time: c.updateTime,
    };
  }

  function refundJson(r: StoredRefund): Json {
    return {
      id: r.id,
      status: "COMPLETED",
      amount: amountJson(r.amount),
      ...(r.note ? { note_to_payer: r.note } : {}),
      links: [
        link("self", `${MOCK_API_BASE}/v2/payments/refunds/${r.id}`),
        link("up", `${MOCK_API_BASE}/v2/payments/captures/${r.captureId}`),
      ],
      create_time: r.createTime,
      update_time: r.createTime,
    };
  }

  function orderJson(o: StoredOrder): Json {
    const links = [link("self", `${MOCK_API_BASE}/v2/checkout/orders/${o.id}`)];
    if (o.status === "CREATED") {
      links.push(
        link("approve", `${MOCK_WEB_BASE}/checkoutnow?token=${o.id}`),
        link("update", `${MOCK_API_BASE}/v2/checkout/orders/${o.id}`, "PATCH"),
        link("capture", `${MOCK_API_BASE}/v2/checkout/orders/${o.id}/capture`, "POST"),
      );
    } else if (o.status === "APPROVED") {
      links.push(link("capture", `${MOCK_API_BASE}/v2/checkout/orders/${o.id}/capture`, "POST"));
    }
    const caps = o.captureIds.map((cid) => captureJson(captures.get(cid) as StoredCapture));
    const units = o.units.map((u, i) => ({
      ...u,
      payee: (u.payee as Json | undefined) ?? MOCK_DEFAULT_PAYEE,
      ...(i === 0 && caps.length > 0 ? { payments: { captures: caps } } : {}),
    }));
    const wallet = o.vaultId ? wallets.get(o.vaultId) : undefined;
    const email = wallet?.email ?? "buyer@example.com";
    const payerId = wallet?.payerId ?? "MOCKPAYER0001";
    return {
      id: o.id,
      status: o.status,
      intent: o.intent,
      ...(o.status !== "CREATED"
        ? {
            payment_source: {
              paypal: {
                email_address: email,
                account_id: payerId,
                account_status: "VERIFIED",
                ...(wallet ? { attributes: { vault: { id: wallet.id, status: "VAULTED" } } } : {}),
              },
            },
            payer: {
              name: { given_name: "Mock", surname: "Buyer" },
              email_address: email,
              payer_id: payerId,
            },
          }
        : {}),
      purchase_units: units,
      create_time: o.createTime,
      update_time: o.updateTime,
      links,
    };
  }

  function batchHeader(b: StoredBatch): Json {
    const total = b.items.reduce((s, i) => s + i.amount.amountMinor, 0);
    const fees = b.items.reduce((s, i) => s + i.fee.amountMinor, 0);
    const cur = b.items[0]?.amount.currency ?? "USD";
    return {
      payout_batch_id: b.id,
      batch_status: b.status,
      time_created: b.createTime,
      ...(b.completeTime ? { time_completed: b.completeTime } : {}),
      sender_batch_header: b.header,
      amount: payoutJson({ amountMinor: total, currency: cur }),
      fees: payoutJson({ amountMinor: b.status === "SUCCESS" ? fees : 0, currency: cur }),
    };
  }

  function itemJson(b: StoredBatch, i: StoredPayoutItem): Json {
    return {
      payout_item_id: i.id,
      transaction_id: i.txId,
      activity_id: i.txId,
      transaction_status: i.status,
      payout_item_fee: payoutJson(i.status === "SUCCESS" ? i.fee : { ...i.fee, amountMinor: 0 }),
      payout_batch_id: b.id,
      payout_item: { ...i.req, amount: payoutJson(i.amount) },
      ...(i.processed ? { time_processed: i.processed } : {}),
      links: [link("self", `${MOCK_API_BASE}/v1/payments/payouts-item/${i.id}`)],
    };
  }

  // ---------- payouts settlement (test / demo control) ----------

  function settlePayouts(batchId?: string): void {
    for (const b of batches.values()) {
      if (b.status !== "PENDING" || (batchId && b.id !== batchId)) continue;
      b.status = "SUCCESS";
      b.completeTime = iso();
      for (const i of b.items) {
        i.status = "SUCCESS";
        i.processed = b.completeTime;
        emit(
          "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
          "payouts_item",
          "A payout item has succeeded.",
          itemJson(b, i),
        );
      }
      emit("PAYMENT.PAYOUTSBATCH.SUCCESS", "payouts", "Payouts batch completed successfully.", {
        batch_header: batchHeader(b),
      });
    }
  }

  // ---------- control surface (the buyer / the bank) ----------

  /** The buyer approves at PayPal. Emits `CHECKOUT.ORDER.APPROVED`. */
  function approveOrder(orderId: string): Json {
    const o = orders.get(orderId);
    if (!o)
      throw fail(
        404,
        "RESOURCE_NOT_FOUND",
        "The specified resource does not exist.",
        "INVALID_RESOURCE_ID",
      );
    if (o.status === "CREATED") {
      o.status = "APPROVED";
      o.updateTime = iso();
      emit(
        "CHECKOUT.ORDER.APPROVED",
        "checkout-order",
        "An order has been approved by buyer.",
        orderJson(o),
      );
    }
    return orderJson(o);
  }

  /**
   * The buyer links their PayPal to an agent once (in PayPal: approve a setup token, then
   * exchange it for a payment token). Returns the wallet whose `id` is the `vault_id`.
   */
  function vaultWallet(w: { email?: string; payerId?: string } = {}): VaultedWallet {
    const wallet: VaultedWallet = {
      id: id("VT-", 20),
      payerId: w.payerId ?? id("PAYER", 13),
      email: w.email ?? "buyer@example.com",
    };
    wallets.set(wallet.id, wallet);
    return wallet;
  }

  /**
   * Capture every purchase unit of an approved order and emit the capture events. With
   * `orderEvent`, `CHECKOUT.ORDER.COMPLETED` goes out first, so a listener has the line
   * items before the capture.
   */
  function captureNow(o: StoredOrder, orderEvent = false): void {
    const t = iso();
    for (const u of o.units) {
      const amt = parseAmount(u.amount, "currency_code", "amount");
      const cap: StoredCapture = {
        id: id("3C"),
        orderId: o.id,
        amount: amt,
        fee: feeFor(amt),
        refunded: 0,
        refundIds: [],
        createTime: t,
        updateTime: t,
        payee: (u.payee as StoredCapture["payee"] | undefined) ?? MOCK_DEFAULT_PAYEE,
        ...(typeof u.custom_id === "string" ? { customId: u.custom_id } : {}),
        ...(typeof u.invoice_id === "string" ? { invoiceId: u.invoice_id } : {}),
      };
      captures.set(cap.id, cap);
      o.captureIds.push(cap.id);
    }
    o.status = "COMPLETED";
    o.updateTime = t;
    if (orderEvent) {
      emit("CHECKOUT.ORDER.COMPLETED", "checkout-order", "Checkout Order Completed", orderJson(o));
    }
    for (const cid of o.captureIds) {
      emit("PAYMENT.CAPTURE.COMPLETED", "capture", "Payment completed for the order.", {
        ...captureJson(captures.get(cid) as StoredCapture),
        // Real capture webhooks carry the order id here; consumers join sales on it.
        supplementary_data: { related_ids: { order_id: o.id } },
      });
    }
  }

  function disputeJson(d: Dispute, c: StoredCapture) {
    return {
      dispute_id: d.dispute_id,
      reason: d.reason,
      status: d.status,
      dispute_amount: amountJson(d.amount),
      dispute_life_cycle_stage: d.status === "OPEN" ? "INQUIRY" : "CHARGEBACK",
      ...(d.outcome ? { dispute_outcome: { outcome_code: d.outcome } } : {}),
      disputed_transactions: [
        {
          seller_transaction_id: d.captureId,
          ...(c.customId ? { custom: c.customId } : {}),
          gross_amount: amountJson(c.amount),
        },
      ],
      create_time: iso(),
      update_time: iso(),
      links: [link("self", `${MOCK_API_BASE}/v1/customer/disputes/${d.dispute_id}`)],
    };
  }

  /** The buyer opens a dispute on a capture. Emits `CUSTOMER.DISPUTE.CREATED`. */
  function openDispute(captureId: string, d: { reason?: string; amount?: Money } = {}): Dispute {
    const c = captures.get(captureId);
    if (!c)
      throw fail(
        404,
        "RESOURCE_NOT_FOUND",
        "The specified resource does not exist.",
        "INVALID_RESOURCE_ID",
      );
    const dispute: Dispute = {
      dispute_id: id("PP-D-", 12),
      captureId,
      reason: d.reason ?? "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      amount: d.amount ?? c.amount,
      status: "OPEN",
    };
    disputes.set(dispute.dispute_id, dispute);
    emit(
      "CUSTOMER.DISPUTE.CREATED",
      "dispute",
      "A new dispute is created with Dispute ID.",
      disputeJson(dispute, c),
    );
    return dispute;
  }

  /** PayPal decides an open dispute. Emits `CUSTOMER.DISPUTE.RESOLVED` with the outcome. */
  function resolveDispute(disputeId: string, outcome: DisputeOutcome): Dispute {
    const d = disputes.get(disputeId);
    const c = d && captures.get(d.captureId);
    if (!d || !c)
      throw fail(
        404,
        "RESOURCE_NOT_FOUND",
        "The specified resource does not exist.",
        "INVALID_RESOURCE_ID",
      );
    if (d.status === "RESOLVED") return d;
    d.status = "RESOLVED";
    d.outcome = outcome;
    emit("CUSTOMER.DISPUTE.RESOLVED", "dispute", "A dispute was resolved.", disputeJson(d, c));
    return d;
  }

  // ---------- routing ----------

  type Ctx = { method: string; path: string; body: Json; headers: Headers };
  type Route = {
    method: string;
    re: RegExp;
    run: (m: RegExpMatchArray, c: Ctx) => { status: number; body: Json };
  };
  const ok = (body: Json, status = 200) => ({ status, body });
  const invoiceOf = (invoiceId: string) => {
    const inv = invoices.get(invoiceId);
    if (!inv) throw notFound();
    return inv;
  };
  const payerUrl = (inv: StoredInvoice) => `${MOCK_WEB_BASE}/invoice/p/#${inv.id}`;
  const invoiceJson = (inv: StoredInvoice): Json => {
    const req = inv.request;
    const due = {
      amountMinor: inv.amount.amountMinor - inv.paid.amountMinor,
      currency: inv.currency,
    };
    return {
      ...req,
      id: inv.id,
      status: inv.status,
      detail: {
        ...(req.detail as Json),
        invoice_number: inv.number,
        metadata: {
          create_time: inv.createTime,
          recipient_view_url: payerUrl(inv),
          invoicer_view_url: `${MOCK_WEB_BASE}/invoice/details/${inv.id}`,
        },
      },
      amount: {
        ...amountJson(inv.amount),
        breakdown: {
          item_total: amountJson(inv.itemTotal),
          discount: { item_discount: amountJson(inv.discount) },
        },
      },
      due_amount: amountJson(due),
      ...(inv.payments.length
        ? {
            payments: {
              paid_amount: amountJson(inv.paid),
              transactions: inv.payments.map((p) => ({
                payment_id: p.paymentId,
                type: "EXTERNAL",
                method: p.method,
                payment_date: p.date,
                amount: amountJson(p.amount),
                ...(p.note ? { note: p.note } : {}),
              })),
            },
          }
        : {}),
      links: [link("self", `${MOCK_API_BASE}/v2/invoicing/invoices/${inv.id}`)],
    };
  };
  const notFound = () =>
    fail(
      404,
      "RESOURCE_NOT_FOUND",
      "The specified resource does not exist.",
      "INVALID_RESOURCE_ID",
    );

  const routes: Route[] = [
    {
      method: "POST",
      re: /^\/v2\/checkout\/orders$/,
      run: (_m, c) => {
        const b = c.body;
        if (b.intent !== "CAPTURE" && b.intent !== "AUTHORIZE") {
          throw fail(
            422,
            "INVALID_REQUEST",
            "Request is not well-formed, syntactically incorrect, or violates schema.",
            "INVALID_PARAMETER_VALUE",
          );
        }
        if (b.intent === "AUTHORIZE") {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "The mock supports intent CAPTURE only.",
            "INTENT_NOT_SUPPORTED",
          );
        }
        const pus = b.purchase_units;
        if (!Array.isArray(pus) || pus.length === 0) {
          throw fail(
            422,
            "INVALID_REQUEST",
            "purchase_units is required.",
            "MISSING_REQUIRED_PARAMETER",
          );
        }
        const units = (pus as Json[]).map((u) => {
          const amt = parseAmount(u.amount, "currency_code", "purchase_units[].amount");
          if (typeof u.custom_id === "string" && u.custom_id.length > 127) {
            throw fail(
              422,
              "INVALID_REQUEST",
              "custom_id exceeds 127 characters.",
              "FIELD_SIZE_EXCEEDED",
            );
          }
          const items = u.items as Json[] | undefined;
          if (items) {
            for (const it of items) {
              if (typeof it.name !== "string" || !it.quantity) {
                throw fail(
                  422,
                  "INVALID_REQUEST",
                  "items[] needs name and quantity.",
                  "MISSING_REQUIRED_PARAMETER",
                );
              }
              parseAmount(it.unit_amount, "currency_code", "items[].unit_amount");
            }
          }
          const payee = u.payee as Json | undefined;
          if (
            payee !== undefined &&
            typeof payee?.merchant_id !== "string" &&
            typeof payee?.email_address !== "string"
          ) {
            throw fail(
              422,
              "INVALID_REQUEST",
              "payee needs merchant_id or email_address.",
              "MISSING_REQUIRED_PARAMETER",
            );
          }
          return { reference_id: "default", ...u, amount: amountJson(amt) };
        });
        const source = (b.payment_source as Json | undefined)?.paypal as Json | undefined;
        const vaultId = source?.vault_id;
        if (vaultId !== undefined && (typeof vaultId !== "string" || !wallets.has(vaultId))) {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "The vault_id is not a vaulted PayPal wallet for this merchant.",
            "INVALID_PAYMENT_TOKEN",
          );
        }
        const t = iso();
        const o: StoredOrder = {
          id: id("5O"),
          intent: "CAPTURE",
          status: "CREATED",
          units,
          createTime: t,
          updateTime: t,
          captureIds: [],
          ...(typeof vaultId === "string" ? { vaultId } : {}),
        };
        orders.set(o.id, o);
        if (o.vaultId) {
          // A vaulted wallet needs no buyer approval: PayPal creates and captures in one call.
          o.status = "APPROVED";
          captureNow(o, true);
        }
        return ok(orderJson(o), 201);
      },
    },
    {
      method: "GET",
      re: /^\/v2\/checkout\/orders\/([^/]+)$/,
      run: (m) => {
        const o = orders.get(m[1] as string);
        if (!o) throw notFound();
        return ok(orderJson(o));
      },
    },
    {
      // Not a PayPal route: how a shop/browser demo performs the buyer's approval over HTTP.
      method: "POST",
      re: /^\/mock\/v2\/checkout\/orders\/([^/]+)\/approve$/,
      run: (m) => ok(approveOrder(m[1] as string)),
    },
    {
      method: "POST",
      re: /^\/v2\/checkout\/orders\/([^/]+)\/capture$/,
      run: (m) => {
        const o = orders.get(m[1] as string);
        if (!o) throw notFound();
        if (o.status === "COMPLETED") {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "Order already captured.",
            "ORDER_ALREADY_CAPTURED",
          );
        }
        if (o.status !== "APPROVED") {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "Payer has not yet approved the Order for payment.",
            "ORDER_NOT_APPROVED",
          );
        }
        captureNow(o);
        return ok(orderJson(o), 201);
      },
    },
    {
      method: "GET",
      re: /^\/v2\/payments\/captures\/([^/]+)$/,
      run: (m) => {
        const c = captures.get(m[1] as string);
        if (!c) throw notFound();
        return ok(captureJson(c));
      },
    },
    {
      method: "POST",
      re: /^\/v2\/payments\/captures\/([^/]+)\/refund$/,
      run: (m, ctx) => {
        const c = captures.get(m[1] as string);
        if (!c) throw notFound();
        const remaining = c.amount.amountMinor - c.refunded;
        if (remaining <= 0) {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "The capture has already been fully refunded.",
            "CAPTURE_FULLY_REFUNDED",
          );
        }
        const amt = ctx.body.amount
          ? parseAmount(ctx.body.amount, "currency_code", "amount")
          : { amountMinor: remaining, currency: c.amount.currency };
        if (amt.currency !== c.amount.currency) {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "Refund currency must match the capture.",
            "REFUND_CURRENCY_MISMATCH",
          );
        }
        if (amt.amountMinor > remaining) {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "The refund amount must be less than or equal to the remaining capture amount.",
            "REFUND_AMOUNT_EXCEEDED",
          );
        }
        const r: StoredRefund = {
          id: id("1R"),
          captureId: c.id,
          amount: amt,
          createTime: iso(),
          ...(typeof ctx.body.note_to_payer === "string" ? { note: ctx.body.note_to_payer } : {}),
        };
        refunds.set(r.id, r);
        c.refunded += amt.amountMinor;
        c.refundIds.push(r.id);
        c.updateTime = r.createTime;
        emit(
          "PAYMENT.CAPTURE.REFUNDED",
          "refund",
          "A payment capture was refunded.",
          refundJson(r),
        );
        return ok(refundJson(r), 201);
      },
    },
    {
      method: "POST",
      re: /^\/v1\/payments\/payouts$/,
      run: (_m, c) => {
        const hdr = c.body.sender_batch_header as Json | undefined;
        const senderId = hdr?.sender_batch_id;
        if (typeof senderId !== "string" || senderId.length === 0 || senderId.length > 256) {
          throw fail(
            400,
            "INVALID_REQUEST",
            "sender_batch_header.sender_batch_id is required (max 256).",
            "MISSING_REQUIRED_PARAMETER",
          );
        }
        const items = c.body.items;
        if (!Array.isArray(items) || items.length === 0 || items.length > 15_000) {
          throw fail(
            400,
            "INVALID_REQUEST",
            "items must hold 1 to 15000 entries.",
            "INVALID_ARRAY_MAX_ITEMS",
          );
        }
        if (batchBySenderId.has(senderId)) {
          throw fail(
            400,
            "USER_BUSINESS_ERROR",
            "Batch with given sender_batch_id already exists.",
            "DUPLICATE_BATCH",
          );
        }
        const stored: StoredPayoutItem[] = (items as Json[]).map((it) => {
          if (typeof it.receiver !== "string") {
            throw fail(
              400,
              "INVALID_REQUEST",
              "items[].receiver is required.",
              "MISSING_REQUIRED_PARAMETER",
            );
          }
          const amount = parseAmount(it.amount, "currency", "items[].amount");
          const { amount: _a, ...req } = it;
          return {
            id: id("", 13),
            txId: id("0C"),
            req: { recipient_type: hdr?.recipient_type ?? "EMAIL", ...req },
            amount,
            fee: {
              amountMinor: Math.max(25, Math.round(amount.amountMinor / 100)),
              currency: amount.currency,
            },
            status: "PENDING",
          };
        });
        const b: StoredBatch = {
          id: id("", 13),
          header: hdr as Json,
          status: "PENDING",
          items: stored,
          createTime: iso(),
        };
        batches.set(b.id, b);
        batchBySenderId.set(senderId, b.id);
        emit("PAYMENT.PAYOUTSBATCH.PROCESSING", "payouts", "Payouts batch is processing.", {
          batch_header: { ...batchHeader(b), batch_status: "PROCESSING" },
        });
        if (opts.autoSettlePayouts) queueMicrotask(() => settlePayouts(b.id));
        return ok(
          {
            batch_header: {
              payout_batch_id: b.id,
              batch_status: "PENDING",
              sender_batch_header: b.header,
            },
            links: [link("self", `${MOCK_API_BASE}/v1/payments/payouts/${b.id}`)],
          },
          201,
        );
      },
    },
    {
      method: "GET",
      re: /^\/v1\/payments\/payouts\/([^/]+)$/,
      run: (m) => {
        const b = batches.get(m[1] as string);
        if (!b) throw notFound();
        return ok({
          batch_header: batchHeader(b),
          items: b.items.map((i) => itemJson(b, i)),
          total_items: b.items.length,
          total_pages: 1,
          links: [link("self", `${MOCK_API_BASE}/v1/payments/payouts/${b.id}`)],
        });
      },
    },
    {
      method: "GET",
      re: /^\/v1\/payments\/payouts-item\/([^/]+)$/,
      run: (m) => {
        for (const b of batches.values()) {
          const i = b.items.find((x) => x.id === m[1]);
          if (i) return ok(itemJson(b, i));
        }
        throw notFound();
      },
    },
    // ---------- Invoicing v2 (statements) ----------
    {
      method: "POST",
      re: /^\/v2\/invoicing\/invoices$/,
      run: (_m, { body }) => {
        const detail = body.detail as Json | undefined;
        const currency = detail?.currency_code;
        const items = body.items;
        if (typeof currency !== "string" || !Array.isArray(items) || items.length === 0) {
          throw fail(
            400,
            "INVALID_REQUEST",
            "detail.currency_code and items[] are required.",
            "MISSING_REQUIRED_PARAMETER",
          );
        }
        const nonNeg = (v: unknown, where: string): Money => {
          const a = v as Json | undefined;
          try {
            if (a?.currency_code !== currency || typeof a.value !== "string") throw new Error();
            return fromPayPalValue(a.value, currency);
          } catch {
            throw fail(
              422,
              "UNPROCESSABLE_ENTITY",
              `${where} is invalid.`,
              "INVALID_PARAMETER_VALUE",
            );
          }
        };
        let itemTotal = 0;
        let discount = 0;
        for (const it of items as Json[]) {
          const unit = nonNeg(it.unit_amount, "items[].unit_amount");
          const qty = Number(it.quantity ?? "1");
          if (!Number.isInteger(qty) || qty < 0) {
            throw fail(
              422,
              "UNPROCESSABLE_ENTITY",
              "items[].quantity is invalid.",
              "INVALID_PARAMETER_VALUE",
            );
          }
          const line = unit.amountMinor * qty;
          const d = it.discount
            ? nonNeg((it.discount as Json).amount, "items[].discount.amount").amountMinor
            : 0;
          if (d > line) {
            throw fail(
              422,
              "UNPROCESSABLE_ENTITY",
              "Item discount exceeds the item amount.",
              "INVALID_DISCOUNT",
            );
          }
          itemTotal += line;
          discount += d;
        }
        const number =
          typeof detail?.invoice_number === "string" ? detail.invoice_number : id("", 10);
        if ([...invoices.values()].some((x) => x.number === number)) {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "Invoice number already exists.",
            "DUPLICATE_INVOICE_NUMBER",
          );
        }
        const raw = id("", 16);
        const inv: StoredInvoice = {
          id: `INV2-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`,
          number,
          status: "DRAFT",
          currency,
          itemTotal: { amountMinor: itemTotal, currency },
          discount: { amountMinor: discount, currency },
          amount: { amountMinor: itemTotal - discount, currency },
          paid: { amountMinor: 0, currency },
          request: body,
          payments: [],
          createTime: iso(),
        };
        invoices.set(inv.id, inv);
        return ok(invoiceJson(inv), 201);
      },
    },
    {
      method: "GET",
      re: /^\/v2\/invoicing\/invoices\/([^/]+)$/,
      run: (m) => ok(invoiceJson(invoiceOf(m[1] as string))),
    },
    {
      method: "POST",
      re: /^\/v2\/invoicing\/invoices\/([^/]+)\/send$/,
      run: (m) => {
        const inv = invoiceOf(m[1] as string);
        if (inv.status !== "DRAFT") {
          throw fail(422, "UNPROCESSABLE_ENTITY", "Invoice is already sent.", "CANT_SEND_INVOICE");
        }
        inv.status = "SENT";
        return ok(link("payer-view", payerUrl(inv)), 200);
      },
    },
    {
      method: "POST",
      re: /^\/v2\/invoicing\/invoices\/([^/]+)\/payments$/,
      run: (m, { body }) => {
        const inv = invoiceOf(m[1] as string);
        if (inv.status !== "SENT" && inv.status !== "PARTIALLY_PAID") {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "A payment can only be recorded on a sent, unpaid invoice.",
            "CANNOT_PROCESS_PAYMENTS",
          );
        }
        const due = inv.amount.amountMinor - inv.paid.amountMinor;
        const amt =
          body.amount === undefined
            ? due
            : parseAmount(body.amount, "currency_code", "amount").amountMinor;
        if (amt > due || amt <= 0) {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "Payment exceeds the amount due.",
            "INVALID_PAYMENT_AMOUNT",
          );
        }
        const paymentId = `EXTR-${id("", 17)}`;
        inv.payments.push({
          paymentId,
          method: typeof body.method === "string" ? body.method : "OTHER",
          date: typeof body.payment_date === "string" ? body.payment_date : iso().slice(0, 10),
          amount: { amountMinor: amt, currency: inv.currency },
          ...(typeof body.note === "string" ? { note: body.note } : {}),
        });
        inv.paid = { amountMinor: inv.paid.amountMinor + amt, currency: inv.currency };
        inv.status =
          inv.paid.amountMinor === inv.amount.amountMinor ? "MARKED_AS_PAID" : "PARTIALLY_PAID";
        return ok({ payment_id: paymentId }, 200);
      },
    },
    {
      method: "POST",
      re: /^\/v2\/invoicing\/invoices\/([^/]+)\/cancel$/,
      run: (m) => {
        const inv = invoiceOf(m[1] as string);
        if (inv.status !== "SENT") {
          throw fail(
            422,
            "UNPROCESSABLE_ENTITY",
            "Only a sent, unpaid invoice can be cancelled.",
            "CANT_CANCEL_INVOICE",
          );
        }
        inv.status = "CANCELLED";
        return ok({}, 204);
      },
    },
  ];

  async function dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const respond = (status: number, body: Json | string) =>
      status === 204
        ? new Response(null, { status })
        : new Response(typeof body === "string" ? body : JSON.stringify(body), {
            status,
            headers: {
              "content-type": url.pathname.includes("/certs/")
                ? "application/x-pem-file"
                : "application/json",
              "paypal-debug-id": "mock-debug-id",
            },
          });

    if (url.pathname.startsWith("/v1/notifications/certs/") && method === "GET") {
      signer ??= makeTestCert({
        notBefore: new Date(now() - 86_400_000),
        notAfter: new Date(now() + 365 * 86_400_000),
      });
      return respond(200, (await signer).certPem);
    }
    if (url.pathname === "/v1/oauth2/token" && method === "POST") {
      if (!headers.get("authorization")?.startsWith("Basic ")) {
        return respond(401, {
          error: "invalid_client",
          error_description: "Client Authentication failed",
        });
      }
      return respond(200, {
        scope: "https://uri.paypal.com/services/payments/payment",
        access_token: `A21AAmock-${seq++}`,
        token_type: "Bearer",
        app_id: "APP-MOCK",
        expires_in: 32400,
        nonce: `${iso()}mock`,
      });
    }
    if (
      !url.pathname.startsWith("/mock/") &&
      !headers.get("authorization")?.startsWith("Bearer ")
    ) {
      return respond(401, {
        name: "AUTHENTICATION_FAILURE",
        message:
          "Authentication failed due to invalid authentication credentials or a missing Authorization header.",
        links: [],
      });
    }

    const route = routes.find((r) => r.method === method && r.re.test(url.pathname));
    if (!route) {
      return respond(404, {
        name: "RESOURCE_NOT_FOUND",
        message: `no mock route for ${method} ${url.pathname}`,
        links: [],
      });
    }

    let body: Json = {};
    if (typeof init?.body === "string" && init.body.trim()) {
      try {
        body = JSON.parse(init.body) as Json;
      } catch {
        return respond(400, {
          name: "MALFORMED_REQUEST_JSON",
          message: "Request body is not valid JSON.",
          links: [],
        });
      }
    }

    const reqId = headers.get("paypal-request-id");
    const idemKey = reqId && method !== "GET" ? `${method} ${url.pathname} ${reqId}` : undefined;
    const fingerprint = JSON.stringify(body);
    if (idemKey) {
      const hit = idempotency.get(idemKey);
      if (hit) return respond(hit.status, hit.body);
    }
    try {
      const m = url.pathname.match(route.re) as RegExpMatchArray;
      const out = route.run(m, { method, path: url.pathname, body, headers });
      if (idemKey) idempotency.set(idemKey, { ...out, fingerprint });
      return respond(out.status, out.body);
    } catch (e) {
      if (e instanceof HttpError) return respond(e.status, e.body);
      throw e;
    }
  }

  return {
    fetch: dispatch as typeof fetch,
    webhookId,
    registerWebhook,
    approveOrder,
    vaultWallet,
    openDispute,
    resolveDispute,
    settlePayouts,
    /** Await all in-flight webhook deliveries. */
    async flush(): Promise<void> {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    events,
    failedDeliveries,
    state: { orders, captures, refunds, batches, disputes, wallets, invoices },
  };
}

export type MockPayPal = ReturnType<typeof createMockPayPal>;
