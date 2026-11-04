import type { Credit, Money, ProgrammeDeposit } from "@pact/protocol";

export interface DepositBalance {
  deposited: Money;
  /** Pending credits: money held back for creators until the hold ends. */
  reserved: Money;
  /** Paid credits. */
  spent: Money;
  /** Already refunded to the brand. */
  returned: Money;
  /** deposited − reserved − spent − returned: what the brand can still be charged or refunded. */
  available: Money;
}

const money = (amountMinor: number, currency: string): Money => ({ amountMinor, currency });

/** Derive a brand's balance from its credits. Throws if the ledger overdraws the deposit. */
export function depositBalance(
  deposit: ProgrammeDeposit,
  credits: readonly Credit[],
): DepositBalance {
  const cur = deposit.deposited.currency;
  let reserved = 0;
  let spent = 0;
  for (const c of credits) {
    if (c.brandId !== deposit.brandId) continue;
    if (c.amount.currency !== cur) throw new Error("credit currency differs from deposit");
    if (c.state === "pending") reserved += c.amount.amountMinor;
    else if (c.state === "paid") spent += c.amount.amountMinor;
  }
  const returned = deposit.returned.amountMinor;
  const available = deposit.deposited.amountMinor - reserved - spent - returned;
  if (available < 0) throw new Error(`deposit ${deposit.id} overdrawn by ${-available}`);
  return {
    deposited: deposit.deposited,
    reserved: money(reserved, cur),
    spent: money(spent, cur),
    returned: deposit.returned,
    available: money(available, cur),
  };
}

/**
 * Close out a deposit: spent = paid credits, returned = everything not paid or still reserved.
 * Pending credits stay reserved, so settling early never refunds money creators may still earn.
 * After the last hold ends and payouts are marked paid, `returned` is the unspent remainder.
 */
export function settleDeposit(
  deposit: ProgrammeDeposit,
  credits: readonly Credit[],
): { deposit: ProgrammeDeposit; returnedNow: Money } {
  const b = depositBalance(deposit, credits);
  const cur = b.deposited.currency;
  return {
    deposit: {
      ...deposit,
      spent: b.spent,
      returned: money(b.returned.amountMinor + b.available.amountMinor, cur),
    },
    returnedNow: b.available,
  };
}
