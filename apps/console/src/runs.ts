/**
 * The ONE place the console learns about agent runs. Today: the JSONL run records that
 * `apps/agents` writes with `--out`. When the demo runner's event stream lands, add another
 * RunSource here and change `runSourceFromEnv`; nothing else in the console changes.
 */
import { readFile } from "node:fs/promises";

export interface AgentRun {
  sessionId: string | null;
  request: string;
  model: string;
  arm: "test" | "placebo" | "none" | null;
  creatorsSeen: string[];
  storesViewed: string[];
  product: { upc: string; name: string } | null;
  shop: string | null;
  orderId: string | null;
  totalMinor: number | null;
  passportAttached: boolean;
  reason: string | null;
  status: "purchased" | "no_purchase" | "error";
}

export interface RunSource {
  runs(): Promise<AgentRun[]>;
}

function toRun(raw: Record<string, unknown>): AgentRun | null {
  if (typeof raw.request !== "string" || typeof raw.status !== "string") return null;
  const total = raw.total as { amountMinor?: number } | null | undefined;
  const product = raw.product as AgentRun["product"] | null | undefined;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    sessionId: (raw.sessionId as string | null) ?? null,
    request: raw.request,
    model: String(raw.model ?? "unknown"),
    arm: (raw.arm as AgentRun["arm"]) ?? null,
    creatorsSeen: arr(raw.creatorsSeen),
    storesViewed: arr(raw.storesViewed),
    product: product ?? null,
    shop: (raw.shop as string | null) ?? null,
    orderId: (raw.orderId as string | null) ?? null,
    totalMinor: total?.amountMinor ?? null,
    passportAttached: raw.passportAttached === true,
    reason: (raw.reason as string | null) ?? null,
    status: raw.status as AgentRun["status"],
  };
}

export function parseRunRecords(jsonl: string): AgentRun[] {
  const out: AgentRun[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = toRun(JSON.parse(line));
      if (r) out.push(r);
    } catch {
      // A half-written last line while the runner is still going: skip it.
    }
  }
  return out;
}

export function fileRunSource(path: string): RunSource {
  return {
    async runs() {
      try {
        return parseRunRecords(await readFile(path, "utf8"));
      } catch {
        return [];
      }
    },
  };
}

export function runSourceFromEnv(env: Record<string, string | undefined>): RunSource {
  return fileRunSource(env.CITED_RUNS_FILE ?? ".cited/runs.jsonl");
}

/**
 * The pair the video frame shows: one exposed run and one held-out run for the same request.
 * Latest wins, but a run that tells the story ranks first: the exposed run earned commission
 * (the engine credits 51 of 57, so the newest exposed sale may not have) and paid at a shop it
 * did not browse; the held-out run bought a different product than the exposed one.
 * `credited` says which orders earned commission; omit it to ignore that signal.
 */
export function pickPair(
  runs: AgentRun[],
  credited?: ReadonlySet<string>,
): { exposed: AgentRun | null; heldOut: AgentRun | null } {
  const bought = runs.filter((r) => r.status === "purchased" && r.orderId);
  const best = (arm: AgentRun["arm"], score: (r: AgentRun) => number, request?: string) => {
    let top: AgentRun | null = null;
    let topScore = -1;
    for (const r of [...bought].reverse()) {
      if (r.arm !== arm || (request && r.request !== request)) continue;
      const s = score(r);
      if (s > topScore) {
        top = r;
        topScore = s;
      }
    }
    return top;
  };
  const exposed = best(
    "test",
    (r) =>
      (credited && r.orderId && credited.has(r.orderId) ? 2 : 0) +
      (r.shop && !r.storesViewed.includes(r.shop) ? 1 : 0),
  );
  const differs = (r: AgentRun) => (r.product?.upc !== exposed?.product?.upc ? 1 : 0);
  const heldOut = best("none", differs, exposed?.request) ?? best("none", differs);
  return { exposed, heldOut };
}
