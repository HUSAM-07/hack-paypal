/**
 * Runs the CITED evals. Usage (after exporting LLM_BASE_URL / LLM_API_KEY):
 *   tsx src/cited/run.ts --out results/cited [--dry] [--concurrency 8] [--only purifier-forced]
 * Writes raw JSONL (one record per session). Resumable: sessions already in the file are skipped.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRecord } from "./analyze";
import {
  PRICE_DESIGNS,
  PRICE_SEED,
  plan,
  type Session,
  VACUUM_DESIGNS,
  VACUUM_SEED,
} from "./design";
import { chatWithTools } from "./llm";
import {
  ABSTAIN_SYSTEM,
  cataloguePayload,
  FORCED_SYSTEM,
  intentsFor,
  searchQueryFor,
  TARGET_UPC,
  TOOLS,
  userMessage,
} from "./world";

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
};
const priceSet = arg("set") === "price-matched";
const vacuumSet = arg("set") === "robot-vacuum";
const out = arg(
  "out",
  vacuumSet
    ? "results/cited-robot-vacuum"
    : priceSet
      ? "results/cited-price-matched"
      : "results/cited",
) as string;
const concurrency = Number(arg("concurrency", "8"));
const dry = process.argv.includes("--dry");
const only = arg("only");
const MAX_ATTEMPTS = 3;

function priceOf(
  payload: ReturnType<typeof cataloguePayload>,
  shopId: string,
  upc: string,
): string | null {
  // Some models omit shopId; the brand bought is what the study measures, so fall back to the UPC.
  const l =
    payload.listings.find((x) => x.shopId === shopId && x.upc === upc) ??
    payload.listings.find((x) => x.upc === upc);
  return l ? (l.price.amountMinor / 100).toFixed(2) : null;
}

async function runSession(s: Session): Promise<SessionRecord> {
  const payload = cataloguePayload(s.study, s.arm, s.id, s.price);
  const abstain = s.variant === "abstain";
  const user = userMessage(
    intentsFor(s.study)[s.intent] as string,
    payload,
    searchQueryFor(s.study),
  );
  const rec = {
    id: s.id,
    ...(s.price ? { price: s.price } : {}),
    study: s.study,
    variant: s.variant,
    model: s.model,
    arm: s.arm,
    intent: s.intent,
  };
  let last = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await chatWithTools({
      model: s.model,
      system: abstain ? ABSTAIN_SYSTEM : FORCED_SYSTEM,
      user,
      tools: TOOLS(abstain),
      temperature: 0.7,
    });
    if (r.call?.name === "create_paypal_order") {
      const a = r.call.args;
      const shopId = String(a.shopId ?? "");
      const upc = String(a.upc ?? "");
      const listed = priceOf(payload, shopId, upc);
      if (listed !== null) {
        const asked = String(a.unit_amount ?? "").replace("$", "");
        return {
          ...rec,
          outcome: {
            action: "buy",
            shopId,
            upc,
            priceOk: Math.abs(Number(asked) - Number(listed)) < 0.005,
            reason: String(a.reason_for_buyer ?? "").slice(0, 300),
            attempts: attempt,
          },
        };
      }
      last = "unknown listing";
    } else if (abstain && r.call?.name === "decline_to_buy") {
      return {
        ...rec,
        outcome: {
          action: "decline",
          reason: String(r.call.args.reason ?? "").slice(0, 300),
          attempts: attempt,
        },
      };
    } else last = r.error ?? "no tool call";
  }
  return { ...rec, outcome: { action: "invalid", attempts: MAX_ATTEMPTS, error: last } };
}

async function main() {
  let sessions = vacuumSet
    ? plan(VACUUM_DESIGNS, VACUUM_SEED)
    : priceSet
      ? plan(PRICE_DESIGNS, PRICE_SEED)
      : plan();
  if (only) sessions = sessions.filter((s) => `${s.study}-${s.price ?? ""}-${s.variant}` === only);
  if (dry) {
    const by: { [k: string]: number } = {};
    for (const s of sessions) {
      const k = `${s.study}-${s.price ?? ""}-${s.variant}`;
      by[k] = (by[k] ?? 0) + 1;
    }
    console.log(JSON.stringify({ total: sessions.length, by, targets: TARGET_UPC }));
    return;
  }
  mkdirSync(out, { recursive: true });
  const file = join(out, "results.jsonl");
  const done = new Set<string>();
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line) done.add((JSON.parse(line) as SessionRecord).id);
    }
  }
  const todo = sessions.filter((s) => !done.has(s.id));
  console.log(`${todo.length} to run, ${done.size} already done`);
  let next = 0;
  let finished = 0;
  async function worker() {
    while (next < todo.length) {
      const s = todo[next++] as Session;
      const rec = await runSession(s);
      appendFileSync(file, `${JSON.stringify(rec)}\n`);
      if (++finished % 25 === 0) console.log(`${finished}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log("done");
}

main();
