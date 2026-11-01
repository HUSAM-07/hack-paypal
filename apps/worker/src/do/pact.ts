import { DurableObject } from "cloudflare:workers";
import type { Money, PactTrigger } from "@pact/protocol";
import type { Env } from "../env";

/**
 * Whether a price-watch pact should fire. The threshold is inclusive ("at or below"),
 * matching the draftPact tool description the model reads: "under $450" is drafted as
 * 45000 and fires at exactly $450.00. The watch ends at the deadline.
 */
export function priceTriggerMet(
  trigger: Extract<PactTrigger, { kind: "price" }>,
  price: Money,
  at: Date,
): boolean {
  return (
    price.currency === trigger.maxPrice.currency &&
    price.amountMinor <= trigger.maxPrice.amountMinor &&
    at.getTime() <= Date.parse(trigger.deadline)
  );
}

/**
 * Phase 2: one per pact, owning its state machine and alarms (price watch, schedules).
 * Drafts live in the ThreadDO's refs until then.
 */
export class PactDO extends DurableObject<Env> {
  async status(): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}
