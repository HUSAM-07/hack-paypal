import { nowOf } from "./clock";
import type { Env } from "./env";
import {
  type PayoutMethodInput,
  parseVenmoReceiver,
  type VenmoReceiver,
  type VenmoReceiverType,
  venmoLabel,
} from "./payout-method";

type Row = Record<string, unknown>;

/** How one creator is paid, as the payout run reads it. */
export interface CreatorWallet {
  paypalId: string | null;
  venmo: VenmoReceiver | null;
}

/** Every creator's payout destination in one read. A Venmo choice without a receiver is PayPal. */
export async function loadWallets(env: Env): Promise<Map<string, CreatorWallet>> {
  const rows = (
    await env.DB.prepare(
      "SELECT creator_id, paypal_id, payout_wallet, venmo_receiver, venmo_receiver_type FROM creators",
    ).all<Row>()
  ).results;
  return new Map(
    rows.map((r) => [
      r.creator_id as string,
      {
        paypalId: (r.paypal_id as string | null) ?? null,
        venmo:
          r.payout_wallet === "VENMO" && r.venmo_receiver && r.venmo_receiver_type
            ? {
                receiver: r.venmo_receiver as string,
                type: r.venmo_receiver_type as VenmoReceiverType,
              }
            : null,
      },
    ]),
  );
}

export type SetPayoutResult =
  | { ok: true; method: "PAYPAL" | "VENMO"; label: string | null }
  | { ok: false; status: 400 | 409; error: string };

/**
 * An onboarded creator chooses PayPal or Venmo. Never a demo creator's row, and the receiver is
 * checked here too: the engine is the one place that decides what a payout item may hold.
 */
export async function setPayoutMethod(
  env: Env,
  input: PayoutMethodInput,
): Promise<SetPayoutResult> {
  const { creator, method } = input;
  let venmo: VenmoReceiver | null = null;
  if (method === "VENMO") {
    const parsed = parseVenmoReceiver(input.venmo);
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    venmo = parsed.value;
  }
  const existing = await env.DB.prepare("SELECT source FROM creators WHERE creator_id = ?")
    .bind(creator.creatorId)
    .first<{ source: string }>();
  if (existing && existing.source !== "onboarding")
    return { ok: false, status: 409, error: "creator_reserved" };
  const at = await nowOf(env);
  await env.DB.prepare(
    `INSERT INTO creators (creator_id, name, paypal_id, source, created_at, payout_wallet, venmo_receiver, venmo_receiver_type)
     VALUES (?, ?, ?, 'onboarding', ?, ?, ?, ?)
     ON CONFLICT (creator_id) DO UPDATE SET name = excluded.name, paypal_id = excluded.paypal_id,
       payout_wallet = excluded.payout_wallet, venmo_receiver = excluded.venmo_receiver,
       venmo_receiver_type = excluded.venmo_receiver_type`,
  )
    .bind(
      creator.creatorId,
      creator.name,
      creator.paypalId,
      at,
      method,
      venmo?.receiver ?? null,
      venmo?.type ?? null,
    )
    .run();
  return { ok: true, method, label: venmo ? venmoLabel(venmo) : null };
}

/** What /creators shows back: the method and a masked label, never the full receiver. */
export async function getPayoutMethod(
  env: Env,
  creatorId: string,
): Promise<{ method: "PAYPAL" | "VENMO"; label: string | null }> {
  const w = (await loadWallets(env)).get(creatorId);
  return w?.venmo
    ? { method: "VENMO", label: venmoLabel(w.venmo) }
    : { method: "PAYPAL", label: null };
}
