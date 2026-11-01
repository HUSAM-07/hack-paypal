/**
 * Scenario and transcript shapes. A scenario is one JSONL line under `scenarios/`.
 *
 * Expectations are declarative so graders stay generic. `args` matchers use a
 * small subset-match DSL (see `match.ts`): plain values must be equal, objects
 * match as subsets, and `$`-operators cover ranges, sets and unordered arrays.
 */
import type { Item } from "@pact/protocol";
import { z } from "zod";
import type { ToolCallRecord, UiNode } from "./adapter";

const ToolExpect = z.object({
  /** Tools that must be called during this turn. */
  mustCall: z.array(z.string()).default([]),
  /** Tools that must not be called during this turn. */
  mustNotCall: z.array(z.string()).default([]),
  /** Each pair [a, b]: the first call of `a` precedes the first call of `b`. */
  order: z.array(z.tuple([z.string(), z.string()])).default([]),
  /** Matcher for the LAST call's args, by tool name; checked only if the tool was called. */
  args: z.record(z.string(), z.unknown()).default({}),
});

const UiExpect = z.object({
  mustInclude: z.array(z.string()).default([]),
  mustNotInclude: z.array(z.string()).default([]),
  /** At least one of these components must appear. */
  anyOf: z.array(z.string()).default([]),
});

const TurnExpect = z.object({
  tools: ToolExpect.default(ToolExpect.parse({})),
  ui: UiExpect.default(UiExpect.parse({})),
  /** requestSpend on this turn is acceptable (user confirmed a plan). Default: forbidden. */
  spendAllowed: z.boolean().default(false),
  /** Regexes (case-insensitive) that must not appear in the agent's visible output. */
  textMustNotMatch: z.array(z.string()).default([]),
  textMustMatch: z.array(z.string()).default([]),
});
export type TurnExpect = z.infer<typeof TurnExpect>;

export const ScenarioTurn = z.object({
  userId: z.string(),
  text: z.string().min(1),
  uiState: z.record(z.string(), z.unknown()).optional(),
  expect: TurnExpect.default(TurnExpect.parse({})),
});

/** Pre-seeded conversation, replayed into thread state before the live turns. */
export const HistoryEntry = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), userId: z.string(), text: z.string() }),
  z.object({
    role: z.literal("agent"),
    text: z.string(),
    toolCalls: z.array(z.object({ name: z.string(), args: z.unknown() })).default([]),
  }),
]);
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const Judge = z.object({
  rubric: z.string(),
  /** Scenario-specific notes appended to the rubric. */
  criteria: z.string(),
  /** Minimum judge score (1-5) to pass. */
  minScore: z.number().min(1).max(5).default(3),
});

export const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]+$/),
  title: z.string(),
  tags: z.array(z.string()).min(1),
  /** Name of a preset in `fixtures/` merged under `fixtures` (top-level keys replace). */
  world: z.string().optional(),
  /**
   * Top-level `WorldFixture` keys that replace the preset's. Validated after the
   * merge: a partial schema here would fill in defaults and wipe preset keys.
   */
  fixtures: z.record(z.string(), z.unknown()).default({}),
  history: z.array(HistoryEntry).default([]),
  turns: z.array(ScenarioTurn).min(1),
  judge: Judge.optional(),
});
export type Scenario = z.infer<typeof Scenario>;

export interface TurnRecord {
  /** Index into `scenario.turns`, or null for a turn replayed from seeded history. */
  index: number | null;
  userId: string;
  text: string;
  uiState?: Record<string, unknown>;
  items: Item[];
  toolCalls: ToolCallRecord[];
  /** Parsed UI roots of every agent message this turn. */
  ui: UiNode[];
  uiErrors: string[];
  durationMs: number;
  error?: string;
}

export interface JudgeVerdict {
  score: number;
  pass: boolean;
  reasoning: string;
  model: string;
}

export interface Transcript {
  scenarioId: string;
  adapter: string;
  repeat: number;
  startedAt: string;
  /** Seeded history first, then live turns, in conversation order. */
  turns: TurnRecord[];
  judge?: JudgeVerdict;
}
