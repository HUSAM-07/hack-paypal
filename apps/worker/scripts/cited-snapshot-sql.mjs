// The SQL half of cited-snapshot.mjs: pure, so the worker tests run it against a real D1.
/**
 * Every table the CITED engine, catalogue, console and /try own, children before parents.
 * Anything not listed here is Pact's and is left alone.
 */
export const CITED_TABLES = [
  "credits",
  "review_flags",
  "payout_batches",
  "deposit_refunds",
  "deposits",
  "brand_statements",
  "refunds",
  "sales",
  "orders",
  "agent_sessions",
  "webhook_events",
  "creator_tests",
  "listings",
  "creators",
  "brands",
  "clock",
  "cited_agent_runs",
  "cited_live_runs",
];

/**
 * CITED tables a reseed must never wipe: real PayPal evidence that a replayed demo can't
 * recreate (signed sandbox webhooks verified on the live endpoint).
 */
export const PRESERVED_TABLES = ["webhook_proofs"];

/** D1 rejects a statement over 100 KB; stay well below it. */
const MAX_STATEMENT_BYTES = 90_000;

function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`non-finite number in snapshot: ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return `'${v.replaceAll("'", "''")}'`;
  throw new Error(`unsupported value in snapshot: ${JSON.stringify(v)}`);
}

/** DELETE every CITED table, then INSERT the given rows. Pure, so it is tested. */
export function snapshotSql(rowsByTable) {
  for (const t of Object.keys(rowsByTable))
    if (!CITED_TABLES.includes(t)) throw new Error(`refusing to write non-CITED table ${t}`);
  const lines = [
    "-- CITED hosted snapshot (apps/worker/scripts/cited-snapshot.mjs). CITED tables only.",
    "PRAGMA defer_foreign_keys = true;",
  ];
  for (const t of CITED_TABLES) lines.push(`DELETE FROM ${t};`);
  for (const t of [...CITED_TABLES].reverse()) {
    for (const row of rowsByTable[t] ?? []) {
      const cols = Object.keys(row);
      const stmt = `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map((c) => sqlValue(row[c])).join(", ")});`;
      const bytes = new TextEncoder().encode(stmt).length;
      if (bytes > MAX_STATEMENT_BYTES)
        throw new Error(`a ${t} row is over D1's statement limit (${bytes} bytes)`);
      lines.push(stmt);
    }
  }
  return `${lines.join("\n")}\n`;
}
