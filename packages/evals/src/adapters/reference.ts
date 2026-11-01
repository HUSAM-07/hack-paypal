/**
 * Reference adapter: Claude via the AI SDK with the fake tools in `tools.ts`.
 *
 * It plays the worker's role just enough to be graded: it rebuilds model messages
 * from thread items, runs the tool loop, emits the host-side items a real server
 * would (toolCall, approvalRequest, agentMessage with resolved refs), and parses
 * UI from the reference JSON-fence format.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type ModelMessage, stepCountIs, type ToolSet, tool } from "ai";
import type {
  AgentUnderTest,
  ThreadState,
  ToolCallRecord,
  TurnInput,
  TurnResult,
} from "../adapter";
import { hostItems } from "../host";
import { systemPrompt, turnContext } from "../prompt";
import { type FakeTool, tools as fakeTools, runTool } from "../tools";
import { parseJsonUi } from "../ui";
import { findPerson, type World } from "../world";

export interface ReferenceOptions {
  apiKey: string;
  model?: string;
  maxSteps?: number;
}

export function referenceAdapter(opts: ReferenceOptions): AgentUnderTest {
  const modelId = opts.model ?? "claude-sonnet-5-5";
  const anthropic = createAnthropic({ apiKey: opts.apiKey });
  const system = systemPrompt();

  return {
    name: `reference:${modelId}`,
    parseUi: parseJsonUi,
    async runTurn(input: TurnInput): Promise<TurnResult> {
      const { threadState, userId, text, uiState } = input;
      const { world } = threadState;
      const calls: ToolCallRecord[] = [];
      const toolSet: ToolSet = {};
      for (const [name, t] of Object.entries(fakeTools) as [string, FakeTool][]) {
        toolSet[name] = tool({
          description: t.description,
          inputSchema: t.input,
          execute: async (args: unknown) => {
            const result = runTool(name, args, { world, actorId: userId });
            calls.push({ name, args, result });
            return result;
          },
        });
      }

      const result = await generateText({
        model: anthropic(modelId),
        instructions: {
          role: "system",
          content: system,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        messages: [
          ...historyMessages(threadState),
          {
            role: "user",
            content: `${turnContext(world, userId, uiState)}\n\n${speaker(world, userId)}: ${text}`,
          },
        ],
        tools: toolSet,
        stopWhen: stepCountIs(opts.maxSteps ?? 8),
        maxRetries: 4,
      });

      return { items: hostItems(threadState, userId, calls, result.text), toolCalls: calls };
    },
  };
}

function speaker(world: World, userId: string): string {
  const name = findPerson(world, userId)?.displayName ?? userId;
  return `[${name} (${userId})]`;
}

/** Rebuild the model conversation from protocol items, merging same-role runs. */
function historyMessages({ items, world }: ThreadState): ModelMessage[] {
  const out: ModelMessage[] = [];
  const push = (m: ModelMessage) => {
    const last = out.at(-1);
    if (last && last.role === m.role && Array.isArray(last.content) && Array.isArray(m.content)) {
      (last.content as unknown[]).push(...(m.content as unknown[]));
    } else out.push(m);
  };
  for (const item of items) {
    if (item.type === "userMessage") {
      push({
        role: "user",
        content: [{ type: "text", text: `${speaker(world, item.authorId)}: ${item.text}` }],
      });
    } else if (item.type === "toolCall") {
      const toolCallId = item.id;
      push({
        role: "assistant",
        content: [{ type: "tool-call", toolCallId, toolName: item.name, input: item.args ?? {} }],
      });
      push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: item.name,
            output: { type: "json", value: (item.result ?? null) as never },
          },
        ],
      });
    } else if (item.type === "agentMessage") {
      push({ role: "assistant", content: [{ type: "text", text: item.text || "(no reply)" }] });
    } else if (item.type === "approvalRequest") {
      push({
        role: "user",
        content: [
          {
            type: "text",
            text: `[host] Approval ${item.approvalId} for ${item.approverId}: ${item.decision ?? "pending"}`,
          },
        ],
      });
    }
  }
  return out;
}
