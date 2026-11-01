/** Loads scenarios and drives one scenario through an adapter into a transcript. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "@pact/protocol";
import type { AgentUnderTest, ThreadState, ToolCallRecord, UiNode } from "./adapter";
import { hostItems } from "./host";
import { Scenario, type Transcript, type TurnRecord } from "./scenario";
import { runTool } from "./tools";
import { parseJsonUi } from "./ui";
import { createWorld, WorldFixture } from "./world";

export const PACKAGE_ROOT = new URL("..", import.meta.url).pathname;
export const SCENARIO_DIR = join(PACKAGE_ROOT, "scenarios");
export const FIXTURE_DIR = join(PACKAGE_ROOT, "fixtures");
export const RECORDING_DIR = join(PACKAGE_ROOT, "recordings");

export function loadScenarios(dir = SCENARIO_DIR): Scenario[] {
  const out: Scenario[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()) {
    readFileSync(join(dir, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!line.trim()) return;
        const parsed = Scenario.safeParse(JSON.parse(line));
        if (!parsed.success) throw new Error(`${file}:${i + 1}: ${parsed.error.message}`);
        if (seen.has(parsed.data.id))
          throw new Error(`${file}:${i + 1}: duplicate id ${parsed.data.id}`);
        seen.add(parsed.data.id);
        out.push(parsed.data);
      });
  }
  return out;
}

/** The scenario's world: its preset with the scenario's own fixture keys replacing the preset's. */
export function fixtureFor(scenario: Scenario, dir = FIXTURE_DIR): WorldFixture {
  const preset = scenario.world
    ? (JSON.parse(readFileSync(join(dir, `${scenario.world}.json`), "utf8")) as WorldFixture)
    : undefined;
  const merged = WorldFixture.safeParse({ ...preset, ...scenario.fixtures });
  if (!merged.success) throw new Error(`${scenario.id}: bad fixture: ${merged.error.message}`);
  return merged.data;
}

const userItem = (
  state: ThreadState,
  userId: string,
  text: string,
  uiState?: Record<string, unknown>,
): Item => ({
  id: `user_${state.items.length}`,
  threadId: state.thread.id,
  turnId: `turn_${state.items.length}`,
  status: "completed",
  createdAt: state.world.now,
  type: "userMessage",
  authorId: userId,
  text,
  ...(uiState ? { uiState } : {}),
});

function parseTurnUi(items: Item[], parse: (text: string) => UiNode[]) {
  const ui: UiNode[] = [];
  const uiErrors: string[] = [];
  for (const item of items) {
    if (item.type !== "agentMessage") continue;
    try {
      ui.push(...parse(item.text));
    } catch (e) {
      uiErrors.push((e as Error).message);
    }
  }
  return { ui, uiErrors };
}

export interface RunOptions {
  repeat?: number;
  turnTimeoutMs?: number;
}

export async function runScenario(
  adapter: AgentUnderTest,
  scenario: Scenario,
  opts: RunOptions = {},
): Promise<Transcript> {
  const world = createWorld(fixtureFor(scenario));
  const state: ThreadState = {
    thread: {
      id: "thread_eval",
      title: scenario.title.slice(0, 120),
      kind: world.threadKind,
      memberIds: world.members.map((m) => m.userId),
      createdAt: world.now,
      archived: false,
    },
    items: [],
    world,
  };
  const parse = adapter.parseUi ?? parseJsonUi;
  const transcript: Transcript = {
    scenarioId: scenario.id,
    adapter: adapter.name,
    repeat: opts.repeat ?? 0,
    startedAt: new Date().toISOString(),
    turns: [],
  };

  // Seeded history runs through the same fake tools so refs and drafts exist.
  let speaker = world.members[0]?.userId ?? "user_unknown";
  for (const entry of scenario.history) {
    if (entry.role === "user") {
      speaker = entry.userId;
      state.items.push(userItem(state, entry.userId, entry.text));
      transcript.turns.push({
        index: null,
        userId: entry.userId,
        text: entry.text,
        items: [],
        toolCalls: [],
        ui: [],
        uiErrors: [],
        durationMs: 0,
      });
      continue;
    }
    const calls: ToolCallRecord[] = entry.toolCalls.map((c) => ({
      name: c.name,
      args: c.args,
      result: runTool(c.name, c.args, { world, actorId: speaker }),
    }));
    const items = hostItems(state, speaker, calls, entry.text);
    state.items.push(...items);
    const last = transcript.turns.at(-1);
    const record: TurnRecord =
      last && last.index === null && last.items.length === 0
        ? last
        : {
            index: null,
            userId: speaker,
            text: "",
            items: [],
            toolCalls: [],
            ui: [],
            uiErrors: [],
            durationMs: 0,
          };
    record.items = items;
    record.toolCalls = calls;
    Object.assign(record, parseTurnUi(items, parseJsonUi));
    if (record !== last) transcript.turns.push(record);
  }

  for (const [index, turn] of scenario.turns.entries()) {
    const started = Date.now();
    const record: TurnRecord = {
      index,
      userId: turn.userId,
      text: turn.text,
      ...(turn.uiState ? { uiState: turn.uiState } : {}),
      items: [],
      toolCalls: [],
      ui: [],
      uiErrors: [],
      durationMs: 0,
    };
    transcript.turns.push(record);
    try {
      const result = await withTimeout(
        adapter.runTurn({
          threadState: state,
          userId: turn.userId,
          text: turn.text,
          ...(turn.uiState ? { uiState: turn.uiState } : {}),
        }),
        opts.turnTimeoutMs ?? 180_000,
      );
      record.items = result.items;
      record.toolCalls = result.toolCalls;
      Object.assign(record, parseTurnUi(result.items, parse));
      state.items.push(userItem(state, turn.userId, turn.text, turn.uiState), ...result.items);
    } catch (e) {
      record.error = (e as Error).message.slice(0, 500);
      record.durationMs = Date.now() - started;
      break;
    }
    record.durationMs = Date.now() - started;
  }
  return transcript;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`turn timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
