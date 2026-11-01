/**
 * Replays canned replies through the fake tools: no model, fully deterministic.
 * Used by the graders' unit tests to build good and bad transcripts, and a
 * minimal example of implementing `AgentUnderTest`.
 */
import type { AgentUnderTest, ToolCallRecord, TurnResult } from "../adapter";
import { hostItems } from "../host";
import { runTool } from "../tools";
import { parseJsonUi } from "../ui";

export interface ScriptedReply {
  calls?: { name: string; args: unknown }[];
  text: string;
}

export function scriptedAdapter(replies: readonly ScriptedReply[]): AgentUnderTest {
  let turn = 0;
  return {
    name: "scripted",
    parseUi: parseJsonUi,
    async runTurn({ threadState, userId }): Promise<TurnResult> {
      const reply = replies[turn++];
      if (!reply) throw new Error(`no scripted reply for turn ${turn - 1}`);
      const toolCalls: ToolCallRecord[] = (reply.calls ?? []).map((c) => ({
        name: c.name,
        args: c.args,
        result: runTool(c.name, c.args, { world: threadState.world, actorId: userId }),
      }));
      return { items: hostItems(threadState, userId, toolCalls, reply.text), toolCalls };
    },
  };
}
