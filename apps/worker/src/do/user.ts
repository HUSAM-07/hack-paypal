/**
 * One per user: passkey credentials, spending mandates, the spend ledger, and the
 * user's PayPal funding. Vault ids live only in this object's storage: they leave it
 * solely as arguments to PayPal calls made from the server, never in a response to a client.
 */
import { DurableObject } from "cloudflare:workers";
import { authorize } from "@pact/policy";
import { Mandate, type Money, type SpendIntent } from "@pact/protocol";
import type { LedgerEntry } from "../agent/tools";
import type { Env } from "../env";
import { newId, nowIso } from "../ids";
import { type ChargeOutcome, chargeVault, type PayoutOutcome, payout } from "../payments/charge";
import { maskEmail } from "../payments/pacts";
import { indexPayPalRef, sha256Hex } from "../payments/refs";

export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  createdAt: string;
}

type PaymentKind = "spend" | "order" | "settlement" | "payout";
type PaymentStatus = "pending" | "charged" | "failed" | "refunded" | "sent";

type PaymentRow = {
  id: string;
  kind: PaymentKind;
  mandate_id: string | null;
  funding_id: string | null;
  amount_minor: number;
  currency: string;
  status: PaymentStatus;
  paypal_ref: string | null;
  order_id: string | null;
  reason: string | null;
  title: string;
  thread_id: string | null;
  pact_id: string | null;
  at: string;
};

type FundingRow = {
  id: string;
  vault_id: string;
  customer_id: string;
  payer_email: string | null;
};

export interface SetupRecord {
  setupTokenId: string;
  threadId: string;
  pactId: string;
  cap: Money;
  mandateId: string | null;
}

export interface OrderRecord {
  orderId: string;
  threadId: string;
  pactId: string;
  amount: Money;
  status: "created" | "captured" | "pending" | "declined";
}

/** What a payment update means for the thread it belongs to. */
export interface PaymentChange {
  paymentId: string;
  kind: PaymentKind;
  status: PaymentStatus;
  userId: string;
  threadId: string | null;
  pactId: string | null;
  amount: Money;
  paypalRef: string | null;
}

export interface WalletView {
  funding: { label: string; linked: boolean };
  mandates: { mandate: Mandate; spent: Money; label?: string }[];
  activity: {
    id: string;
    at: string;
    title: string;
    subtitle?: string;
    kind: "charged" | "refunded" | "payoutSent" | "payoutFailed" | "chargeFailed";
    amount: Money;
    direction: "out";
  }[];
}

export class UserDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY, public_key BLOB NOT NULL, counter INTEGER NOT NULL,
        transports TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mandates (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mandate_id TEXT NOT NULL, amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL, at TEXT NOT NULL, intent_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS mandate_labels (id TEXT PRIMARY KEY, label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS funding (
        id TEXT PRIMARY KEY, vault_id TEXT NOT NULL UNIQUE, vault_hash TEXT NOT NULL,
        customer_id TEXT NOT NULL, payer_email TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS setups (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, pact_id TEXT NOT NULL, cap TEXT NOT NULL,
        mandate_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, pact_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, mandate_id TEXT, funding_id TEXT,
        amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
        paypal_ref TEXT, order_id TEXT, reason TEXT, title TEXT NOT NULL, thread_id TEXT,
        pact_id TEXT, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS payments_ref ON payments(paypal_ref);
      CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);
    `);
  }

  // ── Passkeys ──

  listCredentials(): StoredCredential[] {
    return this.sql
      .exec<{
        id: string;
        public_key: ArrayBuffer;
        counter: number;
        transports: string;
        created_at: string;
      }>("SELECT * FROM credentials")
      .toArray()
      .map((r) => ({
        id: r.id,
        publicKey: new Uint8Array(r.public_key),
        counter: r.counter,
        transports: JSON.parse(r.transports) as string[],
        createdAt: r.created_at,
      }));
  }

  getCredential(id: string): StoredCredential | undefined {
    return this.listCredentials().find((c) => c.id === id);
  }

  addCredential(c: StoredCredential): void {
    this.sql.exec(
      "INSERT INTO credentials (id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?)",
      c.id,
      c.publicKey,
      c.counter,
      JSON.stringify(c.transports),
      c.createdAt,
    );
  }

  /** WebAuthn signature counters must only move forward; a regression signals a cloned key. */
  bumpCounter(id: string, counter: number): void {
    this.sql.exec(
      "UPDATE credentials SET counter = ? WHERE id = ? AND counter <= ?",
      counter,
      id,
      counter,
    );
  }

  // ── Mandates & ledger ──

  listMandates(): Mandate[] {
    return this.sql
      .exec<{ json: string }>("SELECT json FROM mandates")
      .toArray()
      .map((r) => Mandate.parse(JSON.parse(r.json)));
  }

  putMandate(input: unknown): Mandate {
    const m = Mandate.parse(input);
    this.sql.exec(
      "INSERT OR REPLACE INTO mandates (id, json) VALUES (?, ?)",
      m.id,
      JSON.stringify(m),
    );
    return m;
  }

  /** Revokes one of this user's mandates. False when the id isn't theirs. */
  revokeMandate(id: string): boolean {
    const m = this.listMandates().find((x) => x.id === id);
    if (!m) return false;
    if (m.status !== "revoked") this.putMandate({ ...m, status: "revoked" });
    return true;
  }

  ledger(): LedgerEntry[] {
    return this.sql
      .exec<{ mandate_id: string; amount_minor: number; currency: string; at: string }>(
        "SELECT mandate_id, amount_minor, currency, at FROM ledger ORDER BY id",
      )
      .toArray()
      .map((r) => ({
        mandateId: r.mandate_id,
        amountMinor: r.amount_minor,
        currency: r.currency,
        at: r.at,
      }));
  }

  /** Idempotent per intent: a retried settlement can't double-count against a mandate. */
  recordCharge(intentId: string, entry: LedgerEntry): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO ledger (mandate_id, amount_minor, currency, at, intent_id) VALUES (?, ?, ?, ?, ?)",
      entry.mandateId,
      entry.amountMinor,
      entry.currency,
      entry.at,
      intentId,
    );
  }

  policyState(): { mandates: Mandate[]; ledger: LedgerEntry[] } {
    return { mandates: this.listMandates(), ledger: this.ledger() };
  }

  // ── Funding (PayPal vault) ──

  /** The vault customer id lets the v6 SDK show this user's saved wallet. Not a secret. */
  customerId(): string | null {
    return this.activeFunding()?.customer_id ?? null;
  }

  beginSetup(r: Omit<SetupRecord, "mandateId">): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO setups (id, thread_id, pact_id, cap, mandate_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
      r.setupTokenId,
      r.threadId,
      r.pactId,
      JSON.stringify(r.cap),
      nowIso(),
    );
  }

  /** Only setup tokens this user minted resolve; anyone else's id is unknown here. */
  setup(setupTokenId: string): SetupRecord | null {
    const row = this.sql
      .exec<{
        id: string;
        thread_id: string;
        pact_id: string;
        cap: string;
        mandate_id: string | null;
      }>("SELECT * FROM setups WHERE id = ?", setupTokenId)
      .toArray()[0];
    if (!row) return null;
    return {
      setupTokenId: row.id,
      threadId: row.thread_id,
      pactId: row.pact_id,
      cap: JSON.parse(row.cap) as Money,
      mandateId: row.mandate_id,
    };
  }

  /**
   * Stores the vault token and issues the pact-scoped mandate in one step. Any earlier
   * mandate for the same pact is revoked so a member never has two live caps on it.
   */
  async completeSetup(input: {
    setupTokenId: string;
    userId: string;
    vaultId: string;
    customerId: string;
    payerEmail: string | undefined;
    mandate: Mandate;
    label: string;
  }): Promise<Mandate> {
    const vaultHash = await sha256Hex(input.vaultId);
    const fundingId =
      this.sql
        .exec<{ id: string }>("SELECT id FROM funding WHERE vault_id = ?", input.vaultId)
        .toArray()[0]?.id ?? newId("fund");
    this.sql.exec(
      `INSERT INTO funding (id, vault_id, vault_hash, customer_id, payer_email, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)
       ON CONFLICT(vault_id) DO UPDATE SET status = 'active', payer_email = excluded.payer_email`,
      fundingId,
      input.vaultId,
      vaultHash,
      input.customerId,
      input.payerEmail ?? null,
      nowIso(),
    );
    const mandate = Mandate.parse({ ...input.mandate, fundingRef: fundingId });
    for (const m of this.listMandates()) {
      if (m.pactId === mandate.pactId && m.status === "active") {
        this.putMandate({ ...m, status: "revoked" });
      }
    }
    this.putMandate(mandate);
    this.sql.exec(
      "INSERT OR REPLACE INTO mandate_labels (id, label) VALUES (?, ?)",
      mandate.id,
      input.label.slice(0, 120),
    );
    this.sql.exec("UPDATE setups SET mandate_id = ? WHERE id = ?", mandate.id, input.setupTokenId);
    await indexPayPalRef(this.env, `vault:${vaultHash}`, { userId: input.userId });
    return mandate;
  }

  /** PayPal told us the vault token is gone: its mandates can no longer be charged. */
  fundingDeleted(vaultHash: string): number {
    const row = this.sql
      .exec<{ id: string }>("SELECT id FROM funding WHERE vault_hash = ?", vaultHash)
      .toArray()[0];
    if (!row) return 0;
    this.sql.exec("UPDATE funding SET status = 'deleted' WHERE id = ?", row.id);
    let revoked = 0;
    for (const m of this.listMandates()) {
      if (m.fundingRef === row.id && m.status === "active") {
        this.putMandate({ ...m, status: "revoked" });
        revoked++;
      }
    }
    return revoked;
  }

  /** Where P2P payouts to this user go. Server-side only. */
  payoutReceiver(): string | null {
    return this.activeFunding()?.payer_email ?? null;
  }

  // ── Charges ──

  /**
   * The single place a member's vaulted wallet is charged. Re-runs `authorize()` against
   * this object's own ledger and reserves the amount before the PayPal call, so two
   * concurrent spends can't both fit under one cap (the DO may interleave requests
   * while the fetch is in flight). Replays of the same intent id return the first
   * result, or retry PayPal with the same `PayPal-Request-Id` if it was left pending.
   */
  async chargeSpend(input: {
    intent: SpendIntent;
    mandateId: string;
    authorizedBy: "mandate" | "member_approval" | "settlement";
    threadId: string;
  }): Promise<ChargeOutcome & { paymentId: string }> {
    const { intent } = input;
    const prior = this.payment(intent.id);
    if (prior && prior.status !== "pending") return { ...outcomeOf(prior), paymentId: prior.id };

    let fundingId = prior?.funding_id ?? null;
    if (!prior) {
      const decision = authorize(intent, this.listMandates(), this.ledger());
      const permitted =
        input.authorizedBy === "member_approval"
          ? decision.outcome !== "deny"
          : decision.outcome === "allow";
      if (!permitted) {
        const reason =
          decision.outcome === "allow" ? "policy" : `policy:${decision.reasons.join(",")}`;
        this.insertPayment(intent, input, null, "failed", reason.slice(0, 120));
        return { status: "failed", reason, simulated: false, paymentId: intent.id };
      }
      fundingId = this.fundingFor(input.mandateId)?.id ?? null;
      this.recordCharge(intent.id, {
        mandateId: input.mandateId,
        amountMinor: intent.amount.amountMinor,
        currency: intent.amount.currency,
        at: intent.at,
      });
      this.insertPayment(intent, input, fundingId, "pending", null);
    }

    const vaultId = fundingId ? (this.fundingById(fundingId)?.vault_id ?? null) : null;
    const out = await chargeVault(this.env, {
      vaultId,
      amount: intent.amount,
      customId: intent.pactId ?? intent.id,
      description: intent.description,
      requestId: `spend:${intent.id}`,
    });
    this.settlePayment(intent.id, out.status, out);
    await this.indexRefs(intent.userId, input.threadId, intent.pactId, intent.id, out);
    return { ...out, paymentId: intent.id };
  }

  /**
   * Group settlement, step 1: policy check + reservation for one member's share. Returns
   * the vault id to the PactDO, which places the hold. Unattended, so only `allow` passes.
   */
  prepareSettlement(input: {
    intent: SpendIntent;
    threadId: string;
  }): { ok: true; vaultId: string | null } | { ok: false; reason: string } {
    const { intent } = input;
    const prior = this.payment(intent.id);
    if (prior?.status === "charged") return { ok: false, reason: "already_settled" };
    if (!prior || prior.status === "failed") {
      const decision = authorize(intent, this.listMandates(), this.ledger());
      if (decision.outcome !== "allow") {
        return { ok: false, reason: `policy:${decision.reasons.join(",")}`.slice(0, 120) };
      }
      const fundingId = this.fundingFor(decision.mandateId)?.id ?? null;
      this.sql.exec("DELETE FROM payments WHERE id = ?", intent.id);
      this.recordCharge(intent.id, {
        mandateId: decision.mandateId,
        amountMinor: intent.amount.amountMinor,
        currency: intent.amount.currency,
        at: intent.at,
      });
      this.insertPayment(
        intent,
        { mandateId: decision.mandateId, threadId: input.threadId, kind: "settlement" },
        fundingId,
        "pending",
        null,
      );
    }
    const fundingId = this.payment(intent.id)?.funding_id;
    const vaultId = fundingId ? (this.fundingById(fundingId)?.vault_id ?? null) : null;
    return { ok: true, vaultId };
  }

  /** Group settlement, step 2: the hold was captured (charged) or voided (failed). */
  async finishSettlement(
    intentId: string,
    userId: string,
    result: { status: "charged" | "failed"; paypalRef?: string; reason?: string },
  ): Promise<void> {
    // Only a reservation this run made can be settled; never touch a finished charge.
    if (this.payment(intentId)?.status !== "pending") return;
    this.settlePayment(intentId, result.status, result);
    const p = this.payment(intentId);
    if (p && result.paypalRef) {
      await indexPayPalRef(this.env, result.paypalRef, {
        userId,
        threadId: p.thread_id,
        pactId: p.pact_id,
        paymentId: intentId,
      });
    }
  }

  /** P2P send, only after the funding charge for `chargeId` succeeded. */
  async sendPayout(input: {
    chargeId: string;
    userId: string;
    receiver: string;
    amount: Money;
    note: string;
    title: string;
  }): Promise<PayoutOutcome> {
    const charge = this.payment(input.chargeId);
    if (charge?.status !== "charged") {
      return { status: "failed", reason: "sender_not_charged", simulated: false };
    }
    const payoutId = `p2p:${input.chargeId}`;
    const prior = this.payment(payoutId);
    if (prior) {
      return {
        status: prior.status === "failed" ? "failed" : "sent",
        ...(prior.paypal_ref ? { paypalRef: prior.paypal_ref } : {}),
        ...(prior.reason ? { reason: prior.reason } : {}),
        simulated: prior.paypal_ref?.startsWith("SIMULATED-") ?? false,
      };
    }
    const out = await payout(this.env, {
      receiver: input.receiver,
      amount: input.amount,
      note: input.note,
      batchId: payoutId,
    });
    this.sql.exec(
      `INSERT INTO payments (id, kind, mandate_id, funding_id, amount_minor, currency, status,
         paypal_ref, order_id, reason, title, thread_id, pact_id, at)
       VALUES (?, 'payout', NULL, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      payoutId,
      input.amount.amountMinor,
      input.amount.currency,
      out.status,
      out.paypalRef ?? null,
      out.reason ?? null,
      input.title.slice(0, 200),
      charge.thread_id,
      charge.pact_id,
      nowIso(),
    );
    if (out.paypalRef && !out.simulated) {
      await indexPayPalRef(this.env, out.paypalRef, {
        userId: input.userId,
        threadId: charge.thread_id,
        pactId: charge.pact_id,
        paymentId: payoutId,
      });
    }
    return out;
  }

  // ── One-time orders (buyer approves in the browser) ──

  recordOrder(o: Omit<OrderRecord, "status">): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO orders (id, thread_id, pact_id, amount_minor, currency, status, created_at) VALUES (?, ?, ?, ?, ?, 'created', ?)",
      o.orderId,
      o.threadId,
      o.pactId,
      o.amount.amountMinor,
      o.amount.currency,
      nowIso(),
    );
  }

  /** Only orders this user created resolve. */
  order(orderId: string): OrderRecord | null {
    const r = this.sql
      .exec<{
        id: string;
        thread_id: string;
        pact_id: string;
        amount_minor: number;
        currency: string;
        status: OrderRecord["status"];
      }>("SELECT * FROM orders WHERE id = ?", orderId)
      .toArray()[0];
    if (!r) return null;
    return {
      orderId: r.id,
      threadId: r.thread_id,
      pactId: r.pact_id,
      amount: { amountMinor: r.amount_minor, currency: r.currency },
      status: r.status,
    };
  }

  /** True when this user already paid (or is paying) their share of the pact. */
  paidPact(pactId: string): boolean {
    return (
      this.sql
        .exec(
          "SELECT 1 FROM payments WHERE pact_id = ? AND kind IN ('order','spend','settlement') AND status IN ('charged','pending')",
          pactId,
        )
        .toArray().length > 0
    );
  }

  async orderCaptured(input: {
    orderId: string;
    userId: string;
    status: OrderRecord["status"];
    captureId?: string;
    reason?: string;
  }): Promise<void> {
    const o = this.order(input.orderId);
    if (!o) return;
    this.sql.exec("UPDATE orders SET status = ? WHERE id = ?", input.status, input.orderId);
    if (input.status === "created") return;
    const status: PaymentStatus =
      input.status === "captured" ? "charged" : input.status === "pending" ? "pending" : "failed";
    const id = `order:${input.orderId}`;
    this.sql.exec(
      `INSERT INTO payments (id, kind, mandate_id, funding_id, amount_minor, currency, status,
         paypal_ref, order_id, reason, title, thread_id, pact_id, at)
       VALUES (?, 'order', NULL, NULL, ?, ?, ?, ?, ?, ?, 'Pact share', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, paypal_ref = excluded.paypal_ref,
         reason = excluded.reason`,
      id,
      o.amount.amountMinor,
      o.amount.currency,
      status,
      input.captureId ?? input.orderId,
      input.orderId,
      input.reason ?? null,
      o.threadId,
      o.pactId,
      nowIso(),
    );
    if (input.captureId) {
      await indexPayPalRef(this.env, input.captureId, {
        userId: input.userId,
        threadId: o.threadId,
        pactId: o.pactId,
        paymentId: id,
      });
    }
  }

  // ── Webhook updates ──

  /**
   * Applies an asynchronous PayPal status (pending capture completed, capture denied,
   * refund, payout result). Returns the change, or null when nothing changed, so a
   * redelivered or out-of-order event never emits twice.
   */
  applyPaymentUpdate(input: {
    paypalRef: string;
    status: PaymentStatus;
    userId: string;
  }): PaymentChange | null {
    const p = this.sql
      .exec<PaymentRow>(
        "SELECT * FROM payments WHERE paypal_ref = ? OR order_id = ? LIMIT 1",
        input.paypalRef,
        input.paypalRef,
      )
      .toArray()[0];
    if (!p || p.status === input.status) return null;
    // Terminal states only move forward: charged → refunded, nothing un-fails.
    if (p.status === "failed" || p.status === "refunded") return null;
    if (p.status === "charged" && input.status !== "refunded") return null;
    this.settlePayment(p.id, input.status, {});
    return {
      paymentId: p.id,
      kind: p.kind,
      status: input.status,
      userId: input.userId,
      threadId: p.thread_id,
      pactId: p.pact_id,
      amount: { amountMinor: p.amount_minor, currency: p.currency },
      paypalRef: p.paypal_ref,
    };
  }

  // ── Wallet ──

  wallet(): WalletView {
    const f = this.activeFunding();
    const ledger = this.ledger();
    const labels = new Map(
      this.sql
        .exec<{ id: string; label: string }>("SELECT id, label FROM mandate_labels")
        .toArray()
        .map((r) => [r.id, r.label]),
    );
    const mandates = this.listMandates()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((mandate) => {
        const spentMinor = ledger
          .filter((e) => e.mandateId === mandate.id)
          .reduce((s, e) => s + e.amountMinor, 0);
        const label = labels.get(mandate.id);
        return {
          mandate,
          spent: { amountMinor: spentMinor, currency: mandate.maxTotal.currency },
          ...(label ? { label } : {}),
        };
      });
    const activity = this.sql
      .exec<PaymentRow>("SELECT * FROM payments ORDER BY at DESC LIMIT 50")
      .toArray()
      .map((p) => {
        const subtitle =
          p.status === "pending" ? "Pending at PayPal" : p.reason ? p.reason : undefined;
        return {
          id: p.id,
          at: p.at,
          title: p.title,
          ...(subtitle ? { subtitle } : {}),
          kind: activityKind(p),
          amount: { amountMinor: p.amount_minor, currency: p.currency },
          direction: "out" as const,
        };
      });
    const email = maskEmail(f?.payer_email);
    return {
      funding: f
        ? { label: email ? `PayPal · ${email}` : "PayPal", linked: true }
        : { label: "PayPal not linked", linked: false },
      mandates,
      activity,
    };
  }

  // ── Internals ──

  private activeFunding(): FundingRow | undefined {
    return this.sql
      .exec<FundingRow>(
        "SELECT id, vault_id, customer_id, payer_email FROM funding WHERE status = 'active' ORDER BY created_at DESC LIMIT 1",
      )
      .toArray()[0];
  }

  private fundingById(id: string): FundingRow | undefined {
    return this.sql
      .exec<FundingRow>(
        "SELECT id, vault_id, customer_id, payer_email FROM funding WHERE id = ? AND status = 'active'",
        id,
      )
      .toArray()[0];
  }

  /**
   * A mandate charges the wallet it was set up with, and nothing else if that wallet is
   * gone. A one-off approval without a mandate uses the member's current wallet.
   */
  private fundingFor(mandateId: string): FundingRow | undefined {
    const m = this.listMandates().find((x) => x.id === mandateId);
    if (m?.fundingRef) return this.fundingById(m.fundingRef);
    return this.activeFunding();
  }

  private payment(id: string): PaymentRow | undefined {
    return this.sql.exec<PaymentRow>("SELECT * FROM payments WHERE id = ?", id).toArray()[0];
  }

  private insertPayment(
    intent: SpendIntent,
    ctx: { mandateId: string; threadId: string; kind?: PaymentKind },
    fundingId: string | null,
    status: PaymentStatus,
    reason: string | null,
  ): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO payments (id, kind, mandate_id, funding_id, amount_minor, currency,
         status, paypal_ref, order_id, reason, title, thread_id, pact_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
      intent.id,
      ctx.kind ?? "spend",
      ctx.mandateId,
      fundingId,
      intent.amount.amountMinor,
      intent.amount.currency,
      status,
      reason,
      intent.description.slice(0, 200),
      ctx.threadId,
      intent.pactId ?? null,
      intent.at,
    );
  }

  /** A failed or refunded charge gives its reservation back to the mandate. */
  private settlePayment(
    id: string,
    status: PaymentStatus,
    out: { paypalRef?: string; orderId?: string; reason?: string },
  ): void {
    this.sql.exec(
      `UPDATE payments SET status = ?, paypal_ref = COALESCE(?, paypal_ref),
         order_id = COALESCE(?, order_id), reason = COALESCE(?, reason) WHERE id = ?`,
      status,
      out.paypalRef ?? null,
      out.orderId ?? null,
      out.reason?.slice(0, 120) ?? null,
      id,
    );
    if (status === "failed" || status === "refunded") {
      this.sql.exec("DELETE FROM ledger WHERE intent_id = ?", id);
    }
  }

  private async indexRefs(
    userId: string,
    threadId: string,
    pactId: string | undefined,
    paymentId: string,
    out: ChargeOutcome,
  ): Promise<void> {
    if (out.simulated) return;
    const owner = { userId, threadId, pactId: pactId ?? null, paymentId };
    for (const ref of new Set([out.orderId, out.captureId])) {
      if (ref) await indexPayPalRef(this.env, ref, owner);
    }
  }
}

function outcomeOf(p: PaymentRow): ChargeOutcome {
  return {
    status: p.status === "charged" ? "charged" : p.status === "pending" ? "pending" : "failed",
    ...(p.paypal_ref ? { paypalRef: p.paypal_ref } : {}),
    ...(p.order_id ? { orderId: p.order_id } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
    simulated: p.paypal_ref?.startsWith("SIMULATED-") ?? false,
  };
}

function activityKind(p: PaymentRow): WalletView["activity"][number]["kind"] {
  if (p.kind === "payout") return p.status === "failed" ? "payoutFailed" : "payoutSent";
  if (p.status === "failed") return "chargeFailed";
  if (p.status === "refunded") return "refunded";
  return "charged";
}
