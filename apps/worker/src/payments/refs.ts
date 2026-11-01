import type { Env } from "../env";
import { nowIso } from "../ids";

export interface RefOwner {
  userId: string;
  threadId?: string | null;
  pactId?: string | null;
  paymentId?: string | null;
}

/** Lets a webhook about a PayPal resource find the user (and thread) it belongs to. */
export async function indexPayPalRef(env: Env, ref: string, owner: RefOwner): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO paypal_refs (ref, user_id, thread_id, pact_id, payment_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      ref,
      owner.userId,
      owner.threadId ?? null,
      owner.pactId ?? null,
      owner.paymentId ?? null,
      nowIso(),
    )
    .run();
}

export async function ownerOfRef(env: Env, ref: string): Promise<RefOwner | null> {
  const row = await env.DB.prepare(
    "SELECT user_id, thread_id, pact_id, payment_id FROM paypal_refs WHERE ref = ?",
  )
    .bind(ref)
    .first<{
      user_id: string;
      thread_id: string | null;
      pact_id: string | null;
      payment_id: string | null;
    }>();
  return row
    ? {
        userId: row.user_id,
        threadId: row.thread_id,
        pactId: row.pact_id,
        paymentId: row.payment_id,
      }
    : null;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
