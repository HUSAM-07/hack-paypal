import { type Endpoints, ShopperSession } from "@cited/agents";
import { unit } from "@cited/catalogue-mcp";

/** The two arms the side-by-side compares: the creator's test, and held out (no creator content). */
export type PairArm = "test" | "none";

/** The worker's catalogue runs on the default seed (no CATALOGUE_SEED is passed to it). */
export const CATALOGUE_SEED = "cited-demo";

/**
 * Session ids whose bucket lands in `arm` on every day of the holdout schedule: the test share is
 * never below 50% and the held-out ("none") share never below 2.5%, and the catalogue buckets
 * test first, none last. Only the simulated catalogue honours a caller's session id.
 */
export function sessionIdsFor(arm: PairArm, prefix: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < n && i < 100_000; i++) {
    const id = `${prefix}${i.toString(36)}`.slice(0, 24);
    const u = unit(CATALOGUE_SEED, id);
    if (arm === "test" ? u < 0.45 : u > 0.98) out.push(id);
  }
  return out;
}

/**
 * A passport for a session in `arm`, issued by the catalogue itself (so it is signed and
 * verifiable like any other). The probe session is never reported to the engine; the passport
 * is handed to the real session, so the agent's searches all belong to that one session.
 */
export async function passportInArm(
  ep: Endpoints,
  arm: PairArm,
  prefix: string,
  attempts = 6,
): Promise<string> {
  for (const sessionId of sessionIdsFor(arm, prefix, attempts)) {
    const probe = new ShopperSession(ep, `${sessionId}-probe`, { sessionId });
    try {
      await probe.search({ query: "air purifier" });
      if (probe.passportBody()?.arm === arm && probe.passport) return probe.passport;
    } finally {
      await probe.close();
    }
  }
  throw new Error(`could not fix the ${arm} arm`);
}
