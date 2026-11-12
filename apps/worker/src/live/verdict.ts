import { holdUntilFor, splitCommission } from "@pact/attribution";
import { commissionOn, type Money } from "@pact/protocol";

/** The engine's row for a live capture, as the webhook join stored it. */
export interface JoinedSale {
  upc: string;
  amount: Money;
  arm: "test" | "placebo" | "none" | null;
  creatorsSeen: string[];
  capturedAt: string;
  unattributedReason: string | null;
}

export interface ProgrammeFacts {
  /** The funded brand whose SKU this is, if any. */
  brand: { brandId: string; name: string } | null;
  /** Caused units the programme's lift measured for that brand (0 = no proven lift). */
  causedUnits: number;
  /**
   * What the brand's deposit has left to fund credits, in its minor units. Undefined when the
   * engine's deposits couldn't be read: the check is then skipped rather than guessed.
   */
  availableMinor?: number;
}

export interface Verdict {
  credited: boolean;
  /** One sentence, for the page. */
  why: string;
  credits: { creatorId: string; amount: Money }[];
  holdUntil: string | null;
  brandId: string | null;
}

const none = (why: string, brandId: string | null = null): Verdict => ({
  credited: false,
  why,
  credits: [],
  holdUntil: null,
  brandId,
});

/**
 * Would the ledger credit this sale? The engine's rules, applied to one live sale: only a
 * verified passport in the test arm, for a funded SKU whose programme has measured lift,
 * earns the 8% commission (split Shapley-fairly if two creators were shown), held 30 days.
 */
export function liveVerdict(sale: JoinedSale | null, p: ProgrammeFacts): Verdict {
  if (!sale)
    return none("The engine hasn't received PayPal's capture webhook, so nothing is credited.");
  if (sale.unattributedReason)
    return none(
      `Not credited: the passport in custom_id didn't verify (${sale.unattributedReason}).`,
    );
  if (sale.arm === "placebo")
    return none(
      "Not credited: this was a placebo session. The agent saw the creator's other content, not the test, so the test didn't cause the sale.",
    );
  if (sale.arm !== "test")
    return none("Not credited: this session was held out. No creator content was shown.");
  if (!p.brand) return none("Not credited: no brand funds a programme for this product.");
  if (p.causedUnits <= 0)
    return none(
      `Not credited: ${p.brand.name}'s programme hasn't measured any lift from the test.`,
      p.brand.brandId,
    );
  if (sale.creatorsSeen.length === 0)
    return none("Not credited: no creator was shown in this session.", p.brand.brandId);
  const commission = commissionOn(sale.amount);
  if (p.availableMinor !== undefined && p.availableMinor < commission.amountMinor)
    return none(
      `Not credited: ${p.brand.name}'s deposit has too little left to fund this credit, so the brand needs to top it up first. No credit ever draws more than the deposit.`,
      p.brand.brandId,
    );
  // Every creator shown counts; with one creator the whole commission is theirs.
  const split = splitCommission(commission, sale.creatorsSeen, (s) => (s.length ? 1 : 0));
  const credits = [...split].map(([creatorId, amount]) => ({ creatorId, amount }));
  return {
    credited: true,
    why: "Credited: a test-arm sale of a funded product, joined to its arm by the signed passport.",
    credits,
    holdUntil: holdUntilFor(sale.capturedAt),
    brandId: p.brand.brandId,
  };
}
