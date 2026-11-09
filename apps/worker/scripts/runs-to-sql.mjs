// Turns the demo runner's --out JSONL into SQL that replaces the hosted console's run records.
// Usage: node scripts/runs-to-sql.mjs runs.jsonl > runs.sql
//        npx wrangler d1 execute pact --remote --file runs.sql
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/runs-to-sql.mjs <runs.jsonl>");
  process.exit(2);
}
const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim());
for (const l of lines) JSON.parse(l); // refuse a broken file before touching the database
const q = (s) => `'${s.replaceAll("'", "''")}'`;
console.log("DELETE FROM cited_agent_runs;");
for (const l of lines) console.log(`INSERT INTO cited_agent_runs (record) VALUES (${q(l)});`);
