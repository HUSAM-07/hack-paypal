/**
 * npm run evals -- [--tags redteam,p2p] [--ids a,b] [--concurrency 4] [--repeat 3]
 *                  [--adapter reference|worker] [--dry] [--record] [--no-judge] [--model id] [--out dir]
 *                  [--min-overall 0.9] [--min-redteam 1]
 *
 * --dry     grade the committed recordings; no API key or network needed (CI).
 * --from    with --dry, grade transcripts from another dir (e.g. a live run's transcripts/).
 * --record  also write each passing live transcript to recordings/ as a golden.
 * --adapter worker  run the real worker agent (prompt, tools, loop) instead of the reference.
 * Exits 1 when a threshold is missed, 2 on a usage or setup error.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { referenceAdapter } from "./adapters/reference";
import { workerAdapter } from "./adapters/worker";
import { anthropicKey } from "./env";
import { anthropicJudge } from "./graders/judge";
import { loadScenarios, PACKAGE_ROOT, RECORDING_DIR } from "./harness";
import { gradeRecorded, markdown, type RunResult, runLive, writeReports } from "./runner";
import type { Transcript } from "./scenario";

const { values: args } = parseArgs({
  options: {
    tags: { type: "string" },
    ids: { type: "string" },
    concurrency: { type: "string", default: "4" },
    repeat: { type: "string", default: "1" },
    adapter: { type: "string", default: "reference" },
    dry: { type: "boolean", default: false },
    record: { type: "boolean", default: false },
    "no-judge": { type: "boolean", default: false },
    model: { type: "string", default: "claude-sonnet-5-5" },
    "judge-model": { type: "string", default: "claude-sonnet-5-5" },
    out: { type: "string" },
    from: { type: "string" },
    "min-overall": { type: "string", default: "0.9" },
    "min-redteam": { type: "string", default: "1" },
  },
});

const list = (s?: string) =>
  s
    ? s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
const tags = list(args.tags);
const ids = list(args.ids);
const scenarios = loadScenarios().filter(
  (s) =>
    (tags.length === 0 || s.tags.some((t) => tags.includes(t))) &&
    (ids.length === 0 || ids.includes(s.id)),
);
if (scenarios.length === 0) {
  console.error("no scenarios match the filters");
  process.exit(2);
}

const thresholds = { overall: Number(args["min-overall"]), redteam: Number(args["min-redteam"]) };
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const outDir = args.out ?? join(PACKAGE_ROOT, "reports", `${args.dry ? "dry" : "live"}-${stamp}`);
const log = (r: RunResult) => {
  const why = r.failed[0]
    ? `  ${r.failed[0].id}: ${r.failed[0].detail[0] ?? ""}`.slice(0, 160)
    : "";
  console.log(
    `${r.pass ? "PASS" : "FAIL"} ${r.scenarioId} r${r.repeat} ${r.score.toFixed(2)}${why}`,
  );
};

let result: Awaited<ReturnType<typeof runLive>>;
if (args.dry) {
  const dir = args.from ?? RECORDING_DIR;
  const recordings = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Transcript)
    .filter((t) => scenarios.some((s) => s.id === t.scenarioId));
  if (recordings.length === 0) {
    console.error("no recordings match the filters");
    process.exit(2);
  }
  result = await gradeRecorded(recordings, {
    scenarios,
    concurrency: 1,
    repeat: 1,
    thresholds,
    onResult: log,
  });
} else {
  const apiKey = anthropicKey();
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY not found in env or the main checkout's .env (use --dry to grade recordings)",
    );
    process.exit(2);
  }
  if (args.adapter !== "reference" && args.adapter !== "worker") {
    console.error(`unknown --adapter ${args.adapter} (reference or worker)`);
    process.exit(2);
  }
  const adapter =
    args.adapter === "worker"
      ? workerAdapter({ apiKey, model: args.model })
      : referenceAdapter({ apiKey, model: args.model });
  result = await runLive(adapter, {
    scenarios,
    concurrency: Number(args.concurrency),
    repeat: Number(args.repeat),
    thresholds,
    judge: args["no-judge"]
      ? undefined
      : anthropicJudge({
          apiKey,
          model: args["judge-model"],
          rubricDir: join(PACKAGE_ROOT, "rubrics"),
        }),
    onResult: (r, t) => {
      log(r);
      // Only passing runs become goldens; a failing golden would break --dry in CI.
      if (args.record && r.pass)
        writeFileSync(
          join(RECORDING_DIR, `${t.scenarioId}.json`),
          `${JSON.stringify(t, null, 2)}\n`,
        );
    },
  });
}

writeReports(outDir, result.report, result.transcripts);
console.log(`\n${markdown(result.report).split("## By tag")[0]?.trim()}\n\nReports: ${outDir}`);
process.exit(result.report.ok ? 0 : 1);
