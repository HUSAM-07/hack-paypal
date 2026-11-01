/**
 * One per user: passkey credentials, spending mandates and the spend ledger.
 * Vault ids / PayPal tokens will live here too and never leave the server.
 */
import { DurableObject } from "cloudflare:workers";
import { Mandate } from "@pact/protocol";
import type { LedgerEntry } from "../agent/tools";
import type { Env } from "../env";

export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  createdAt: string;
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
    `);
  }

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
}
