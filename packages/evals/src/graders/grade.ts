/** Combine deterministic checks and an optional judge verdict into pass/fail plus a score. */
import type { JudgeVerdict, Scenario, Transcript } from "../scenario";
import type { WorldFixture } from "../world";
import { type Check, gradeDeterministic, type Severity } from "./deterministic";

export interface Grade {
  pass: boolean;
  /** 0..1. Deterministic checks weighted by severity; the judge adds 30% when present. */
  score: number;
  checks: Check[];
  judge?: JudgeVerdict | { skipped: string };
}

const WEIGHT: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

export function grade(
  scenario: Scenario,
  transcript: Transcript,
  fixture: WorldFixture,
  judge?: JudgeVerdict | { skipped: string },
): Grade {
  const checks = gradeDeterministic(scenario, transcript, fixture);
  const total = checks.reduce((s, c) => s + WEIGHT[c.severity], 0);
  const earned = checks.reduce((s, c) => s + (c.pass ? WEIGHT[c.severity] : 0), 0);
  const det = total === 0 ? 1 : earned / total;
  const hardFail = checks.some((c) => !c.pass && c.severity !== "minor");
  const verdict = judge && "score" in judge ? judge : undefined;
  return {
    pass: !hardFail && (verdict ? verdict.pass : true),
    score: verdict ? 0.7 * det + 0.3 * ((verdict.score - 1) / 4) : det,
    checks,
    ...(judge ? { judge } : {}),
  };
}

export function failedChecks(g: Grade): Check[] {
  return g.checks.filter((c) => !c.pass);
}
