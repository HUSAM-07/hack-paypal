import { depositBalance } from "@pact/attribution";
import { nowOf } from "./clock";
import { loadCredits } from "./credits";
import type { Env } from "./env";
import { getPayPal } from "./paypal";
import { aggregateDeposit, listBrands, listDeposits } from "./programme";

export interface CycleBrandResult {
  brandId: string;
  deposited: number;
  spent: number;
  /** Pending credits still inside their hold: kept back, not refunded. */
  reserved: number;
  returnedNow: number;
  returnedTotal: number;
  refunds: { depositId: string; captureId: string; refundId: string; amountMinor: number }[];
}

/**
 * End of cycle: refund each brand's unspent deposit through `captures/{id}/refund`.
 * Unspent = deposited − paid − still-pending − already returned, so a brand with no lift
 * pays $0 and gets everything back. A deposit is refunded newest-first, each capture up to
 * what it still holds. The request id encodes the deposit and amount, so a retry after a
 * crash repeats the same refund instead of making a second one.
 */
export async function closeCycle(env: Env, only?: string[]): Promise<CycleBrandResult[]> {
  const credits = await loadCredits(env);
  const { paypal } = getPayPal(env);
  const now = await nowOf(env);
  const out: CycleBrandResult[] = [];

  for (const brand of await listBrands(env)) {
    if (only && !only.includes(brand.brandId)) continue;
    const rows = (await listDeposits(env, brand.brandId)).filter((d) => d.status === "captured");
    const bal = depositBalance(aggregateDeposit(brand, rows), credits);
    let left = bal.available.amountMinor;
    const result: CycleBrandResult = {
      brandId: brand.brandId,
      deposited: bal.deposited.amountMinor,
      spent: bal.spent.amountMinor,
      reserved: bal.reserved.amountMinor,
      returnedNow: 0,
      returnedTotal: bal.returned.amountMinor,
      refunds: [],
    };
    for (const d of [...rows].reverse()) {
      if (left <= 0) break;
      const amountMinor = Math.min(left, d.amountMinor - d.returnedMinor);
      if (amountMinor <= 0 || !d.captureId) continue;
      const refund = await paypal.captures.refund(
        d.captureId,
        {
          amount: { amountMinor, currency: d.currency },
          note_to_payer: "CITED unspent programme deposit",
        },
        { requestId: `cited-refund:${d.id}:${d.returnedMinor}:${amountMinor}`.slice(0, 108) },
      );
      await env.DB.prepare(
        `INSERT OR IGNORE INTO deposit_refunds (id, brand_id, deposit_id, capture_id, refund_id,
           amount_minor, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          `${d.id}:${d.returnedMinor}`,
          brand.brandId,
          d.id,
          d.captureId,
          refund.id,
          amountMinor,
          d.currency,
          now,
        )
        .run();
      await env.DB.prepare(
        "UPDATE deposits SET returned_minor = ? WHERE id = ? AND returned_minor = ?",
      )
        .bind(d.returnedMinor + amountMinor, d.id, d.returnedMinor)
        .run();
      left -= amountMinor;
      result.returnedNow += amountMinor;
      result.returnedTotal += amountMinor;
      result.refunds.push({
        depositId: d.id,
        captureId: d.captureId,
        refundId: refund.id,
        amountMinor,
      });
    }
    out.push(result);
  }
  return out;
}
