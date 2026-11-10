/**
 * Writes the /proof downloads from the committed eval results, before `vite build`
 * copies public/ into dist/: one row per agent session, as CSV and JSON.
 * Output is gitignored; the results.jsonl files are the source of truth.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { COLUMNS, type EvalRecord, toCsv, toRow } from "../src/proof/sessions";

const root = new URL("../../../", import.meta.url);
const SOURCES = [
  "packages/evals/results/cited-price-matched/results.jsonl",
  "packages/evals/results/cited/results.jsonl",
];

const rows = SOURCES.flatMap((path) =>
  readFileSync(new URL(path, root), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => toRow(JSON.parse(line) as EvalRecord)),
);

const out = new URL("../public/data/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("cited-eval-sessions.csv", out), toCsv(rows, COLUMNS));
writeFileSync(
  new URL("cited-eval-sessions.json", out),
  `${JSON.stringify(
    {
      source: SOURCES.map((p) => `https://github.com/HUSAM-07/hack-paypal/blob/main/${p}`),
      note: "One row per agent session, unedited outcomes. price_usd is the listed unit price the session saw at that seller.",
      columns: COLUMNS,
      sessions: rows,
    },
    null,
    1,
  )}\n`,
);
console.log(`proof data: ${rows.length} sessions`);
