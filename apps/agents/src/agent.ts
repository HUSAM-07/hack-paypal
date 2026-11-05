import type { ShopperSession } from "./session";

export interface AgentContext {
  request: string;
  session: ShopperSession;
  /** Deterministic randomness for this session (fake agent personas). */
  rand: () => number;
}

/** What an agent says about its own decision; the runner logs it verbatim. */
export interface AgentOutcome {
  reason: string | null;
  steps: number;
}

export interface ShopperAgent {
  run(ctx: AgentContext): Promise<AgentOutcome>;
}

/** Budget in minor units from phrases like "around $100"; null when the buyer gave none. */
export function parseBudgetMinor(request: string): number | null {
  const m = request.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  return m?.[1] ? Math.round(Number(m[1]) * 100) : null;
}
