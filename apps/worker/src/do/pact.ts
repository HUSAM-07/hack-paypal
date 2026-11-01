import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

/**
 * Phase 2: one per pact, owning its state machine and alarms (price watch, schedules).
 * Drafts live in the ThreadDO's refs until then.
 */
export class PactDO extends DurableObject<Env> {
  async status(): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}
