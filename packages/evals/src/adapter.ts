/**
 * The seam between the eval harness and whatever agent is under test.
 *
 * The harness owns the conversation: it feeds one user turn at a time and records
 * what came back. An adapter turns that into a call against a real agent: the
 * reference adapter calls Anthropic directly with fake tools, and the worker adapter
 * (plugged in later) drives a ThreadDO. Graders only ever see `TurnResult`s, so any
 * agent that can produce protocol `Item`s can be graded.
 */
import type { Item, Thread } from "@pact/protocol";
import type { World } from "./world";

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
}

export interface ThreadState {
  thread: Thread;
  /** Every item so far, oldest first (seeded history plus earlier live turns). */
  items: Item[];
  /**
   * Deterministic fixtures for this scenario: members, products, mandates, ledger,
   * the clock. Adapters that run fake tools read and mutate it; the worker adapter
   * seeds its Durable Objects from it instead.
   */
  world: World;
}

export interface TurnInput {
  threadState: ThreadState;
  /** Thread member speaking this turn. */
  userId: string;
  text: string;
  uiState?: Record<string, unknown>;
}

export interface TurnResult {
  /** Items produced by this turn, excluding the user's own message. */
  items: Item[];
  toolCalls: ToolCallRecord[];
}

/** One generative-UI node after parsing an agent message. */
export interface UiNode {
  component: string;
  props: Record<string, unknown>;
}

export interface AgentUnderTest {
  /** Stable name recorded in transcripts, e.g. "reference:claude-sonnet-5-5". */
  readonly name: string;
  runTurn(input: TurnInput): Promise<TurnResult>;
  /**
   * Parse an agentMessage's `text` into catalog nodes (roots only; children stay
   * nested in props). Defaults to the reference JSON-fence format; the worker
   * adapter supplies an OpenUI Lang parser here.
   */
  parseUi?(text: string): UiNode[];
}
