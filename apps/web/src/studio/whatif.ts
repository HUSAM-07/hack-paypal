/**
 * The commission what-if, as the dashboard asks for it: the engine's recorded sales run through
 * the ledger's own pure maths (`commissionWhatIf` in @pact/attribution) at another commission
 * rate or deposit. Read-only: it builds credits in memory and returns numbers to draw.
 */

import type { RawWhatIf, Scope } from "@cited/studio/tables";
import { commissionWhatIf, type WhatIfResult } from "@pact/attribution";
import { COMMISSION_BPS } from "@pact/protocol";
import type { Row } from "./data";

export { COMMISSION_BPS };

/** The slider's range: 0% to 20% in half-point steps, in basis points. */
export const RATE_MIN_BPS = 0;
export const RATE_MAX_BPS = 2000;
export const RATE_STEP_BPS = 50;

export interface WhatIfSettings {
  commissionBps: number;
  depositMinor: number;
}

/** The credits table's states, folded into the ledger's three: paid, voided, or still to be paid. */
function ledgerStates(credits: readonly Row[]) {
  const states = new Map<string, "paid" | "voided" | "pending">();
  const firstPayout = new Set<string>();
  for (const c of credits) {
    const id = String(c.id);
    states.set(id, c.state === "paid" ? "paid" : c.state === "voided" ? "voided" : "pending");
    if (c.firstPayout === true) firstPayout.add(id);
  }
  return { states, firstPayout };
}

/**
 * One brand's credits re-priced. `credits` are the Studio credits rows, which say what really
 * happened to each credit (paid, voided by a refund, still waiting) so a what-if keeps those facts
 * and changes only the amounts. Null when the engine has no recorded sales for the brand.
 */
export function whatIfFor(
  data: RawWhatIf | null,
  brandId: string,
  scope: Scope,
  credits: readonly Row[],
  settings: WhatIfSettings,
): WhatIfResult | null {
  const brand = data?.brands.find((b) => b.brandId === brandId);
  if (!brand) return null;
  const { states, firstPayout } = ledgerStates(credits);
  return commissionWhatIf(brand, settings, {
    states,
    ...(scope === "first" ? { inScope: firstPayout } : {}),
  });
}

/** Studio rows hold dollars as floats; the maths runs in whole cents. */
export const toMinor = (dollars: unknown) =>
  Math.round((typeof dollars === "number" ? dollars : 0) * 100);
