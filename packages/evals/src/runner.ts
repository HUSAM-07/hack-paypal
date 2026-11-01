/** Run (or re-grade) a suite, aggregate pass rates, and write reports. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentUnderTest } from "./adapter";
import type { Check } from "./graders/deterministic";
import { failedChecks, type Grade, grade } from "./graders/grade";
import type { JudgeFn } from "./graders/judge";
import { fixtureFor, runScenario } from "./harness";
import type { Scenario, Transcript } from "./scenario";

export const REDTEAM_TAG = "redteam";

export interface Thresholds {
  overall: number;
  redteam: number;
}

export interface RunResult {
  scenarioId: string;
  repeat: number;
  tags: string[];
  pass: boolean;
  score: number;
  failed: Check[];
  judge?: Grade["judge"];
  durationMs: number;
}

export interface Rate {
  runs: number;
  passed: number;
  rate: number;
}

export interface Report {
  mode: "live" | "dry";
  adapter: string;
  startedAt: string;
  finishedAt: string;
  repeat: number;
  thresholds: Thresholds;
  overall: Rate;
  redteam: Rate;
  byTag: Record<string, Rate>;
  /** Scenarios that passed some repeats and failed others. */
  flaky: string[];
  /** Failing check ids across all runs, most common first. */
  failureModes: { check: string; count: number; scenarios: string[] }[];
  ok: boolean;
  results: RunResult[];
}

/** Run `fn` over `items` with at most `n` in flight; results keep input order. */
export async function pool<T, R>(
  items: readonly T[],
  n: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface SuiteOptions {
  scenarios: Scenario[];
  concurrency: number;
  repeat: number;
  thresholds: Thresholds;
  judge?: JudgeFn | undefined;
  onResult?: (r: RunResult, t: Transcript) => void;
}

async function judged(scenario: Scenario, t: Transcript, judge?: JudgeFn): Promise<Grade["judge"]> {
  if (!scenario.judge) return undefined;
  if (t.judge) return t.judge;
  if (!judge) return { skipped: "no judge in this mode" };
  try {
    t.judge = await judge(scenario, t);
    return t.judge;
  } catch (e) {
    return { skipped: `judge error: ${(e as Error).message.slice(0, 200)}` };
  }
}

async function gradeOne(scenario: Scenario, t: Transcript, judge?: JudgeFn): Promise<RunResult> {
  const g = grade(scenario, t, fixtureFor(scenario), await judged(scenario, t, judge));
  return {
    scenarioId: scenario.id,
    repeat: t.repeat,
    tags: scenario.tags,
    pass: g.pass,
    score: Number(g.score.toFixed(3)),
    failed: failedChecks(g),
    ...(g.judge ? { judge: g.judge } : {}),
    durationMs: t.turns.reduce((s, x) => s + x.durationMs, 0),
  };
}

export async function runLive(adapter: AgentUnderTest, opts: SuiteOptions) {
  const startedAt = new Date().toISOString();
  const jobs = opts.scenarios.flatMap((s) =>
    Array.from({ length: opts.repeat }, (_, r) => ({ s, r })),
  );
  const transcripts: Transcript[] = [];
  const results = await pool(jobs, opts.concurrency, async ({ s, r }) => {
    const t = await runScenario(adapter, s, { repeat: r });
    const result = await gradeOne(s, t, opts.judge);
    transcripts.push(t);
    opts.onResult?.(result, t);
    return result;
  });
  return { report: summarize("live", adapter.name, startedAt, opts, results), transcripts };
}

export async function gradeRecorded(recordings: Transcript[], opts: SuiteOptions) {
  const startedAt = new Date().toISOString();
  const byId = new Map(opts.scenarios.map((s) => [s.id, s]));
  const results: RunResult[] = [];
  for (const t of recordings) {
    const s = byId.get(t.scenarioId);
    if (!s) continue;
    const result = await gradeOne(s, t, undefined);
    opts.onResult?.(result, t);
    results.push(result);
  }
  const adapter = [...new Set(recordings.map((t) => t.adapter))].join(", ") || "none";
  return {
    report: summarize("dry", adapter, startedAt, { ...opts, repeat: 1 }, results),
    transcripts: recordings,
  };
}

function rate(rs: readonly RunResult[]): Rate {
  const passed = rs.filter((r) => r.pass).length;
  return { runs: rs.length, passed, rate: rs.length === 0 ? 1 : passed / rs.length };
}

export function summarize(
  mode: Report["mode"],
  adapter: string,
  startedAt: string,
  opts: Pick<SuiteOptions, "repeat" | "thresholds">,
  results: RunResult[],
): Report {
  const tags = [...new Set(results.flatMap((r) => r.tags))].sort();
  const byScenario = Map.groupBy(results, (r) => r.scenarioId);
  const flaky = [...byScenario]
    .filter(([, rs]) => rs.some((r) => r.pass) && rs.some((r) => !r.pass))
    .map(([id]) => id);
  const modes = new Map<string, Set<string>>();
  let counts = new Map<string, number>();
  for (const r of results) {
    for (const c of r.failed) {
      modes.set(c.id, (modes.get(c.id) ?? new Set()).add(r.scenarioId));
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
    if (r.judge && "score" in r.judge && !r.judge.pass) {
      modes.set("judge", (modes.get("judge") ?? new Set()).add(r.scenarioId));
      counts.set("judge", (counts.get("judge") ?? 0) + 1);
    }
  }
  counts = new Map([...counts].sort((a, b) => b[1] - a[1]));
  const overall = rate(results);
  const redteam = rate(results.filter((r) => r.tags.includes(REDTEAM_TAG)));
  return {
    mode,
    adapter,
    startedAt,
    finishedAt: new Date().toISOString(),
    repeat: opts.repeat,
    thresholds: opts.thresholds,
    overall,
    redteam,
    byTag: Object.fromEntries(
      tags.map((t) => [t, rate(results.filter((r) => r.tags.includes(t)))]),
    ),
    flaky,
    failureModes: [...counts].map(([check, count]) => ({
      check,
      count,
      scenarios: [...(modes.get(check) ?? [])],
    })),
    ok:
      results.length > 0 &&
      overall.rate >= opts.thresholds.overall &&
      redteam.rate >= opts.thresholds.redteam,
    results,
  };
}

const pct = (r: Rate) => `${(r.rate * 100).toFixed(1)}% (${r.passed}/${r.runs})`;

export function markdown(report: Report): string {
  const lines = [
    `# Pact agent evals: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    `Mode **${report.mode}**, adapter \`${report.adapter}\`, repeat ${report.repeat}, ${report.startedAt}.`,
    "",
    `| Gate | Rate | Threshold |`,
    `|---|---|---|`,
    `| Overall | ${pct(report.overall)} | ${(report.thresholds.overall * 100).toFixed(0)}% |`,
    `| Red-team | ${pct(report.redteam)} | ${(report.thresholds.redteam * 100).toFixed(0)}% |`,
    "",
    `## By tag`,
    "",
    `| Tag | Rate |`,
    `|---|---|`,
    ...Object.entries(report.byTag).map(([t, r]) => `| ${t} | ${pct(r)} |`),
    "",
    `## Failure modes`,
    "",
    ...(report.failureModes.length === 0
      ? ["None."]
      : [
          `| Check | Failures | Scenarios |`,
          `|---|---|---|`,
          ...report.failureModes.map(
            (f) => `| ${f.check} | ${f.count} | ${f.scenarios.join(", ")} |`,
          ),
        ]),
    "",
    ...(report.flaky.length ? [`**Flaky:** ${report.flaky.join(", ")}`, ""] : []),
    `## Scenarios`,
    "",
    `| Scenario | Tags | Pass | Score | Judge | First failure |`,
    `|---|---|---|---|---|---|`,
  ];
  for (const [id, rs] of Map.groupBy(report.results, (r) => r.scenarioId)) {
    const passed = rs.filter((r) => r.pass).length;
    const score = rs.reduce((s, r) => s + r.score, 0) / rs.length;
    const judge = rs
      .map((r) => (r.judge && "score" in r.judge ? String(r.judge.score) : r.judge ? "skip" : "-"))
      .join("/");
    const fail = rs.flatMap((r) => r.failed)[0];
    const failText = fail
      ? `${fail.id}: ${fail.detail[0] ?? ""}`.replaceAll("|", "\\|").slice(0, 140)
      : "";
    lines.push(
      `| ${id} | ${rs[0]?.tags.join(", ")} | ${passed}/${rs.length} | ${score.toFixed(2)} | ${judge} | ${failText} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function writeReports(dir: string, report: Report, transcripts: Transcript[]): void {
  mkdirSync(join(dir, "transcripts"), { recursive: true });
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, "summary.md"), markdown(report));
  for (const t of transcripts) {
    writeFileSync(
      join(dir, "transcripts", `${t.scenarioId}.r${t.repeat}.json`),
      `${JSON.stringify(t, null, 2)}\n`,
    );
  }
}
