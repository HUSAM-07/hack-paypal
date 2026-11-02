/**
 * The agent step loop, independent of where it runs. ThreadDO hosts it over DO
 * storage and sockets; the evals host it in memory. A host supplies persistence,
 * streaming fan-out, validation and tool execution; the loop owns the order of
 * operations and the one in-turn retry for invalid UI.
 */
import type { AnalyzedMessage, Diagnostic } from "./catalog";
import type { ChatMessage, ModelProvider, ToolCall, ToolDef, ToolResult } from "./provider";

export interface AgentHost {
  readonly provider: ModelProvider;
  readonly system: string;
  readonly tools: ToolDef[];
  readonly maxSteps: number;
  messages(): ChatMessage[];
  append(m: ChatMessage): void;
  /** The first text delta of a step arrived. */
  startMessage(): void;
  delta(text: string): void;
  analyze(text: string): AnalyzedMessage;
  /**
   * A streamed message is done. `rejected` means it failed validation and must not be
   * shown: the loop asks the model to resend it fixed.
   */
  finishMessage(
    text: string,
    analysis: AnalyzedMessage,
    status: "completed" | "failed",
    rejected: boolean,
  ): void;
  /**
   * `paused` means the call is now waiting on a member's approval. The model still
   * sees the result (status awaiting_approval) and tells the member what happens next.
   */
  executeTool(
    call: ToolCall,
    alreadyPaused: boolean,
  ): Promise<{ result: ToolResult; paused?: boolean }>;
}

export interface LoopEnd {
  status: "completed" | "interrupted" | "stepLimit";
  /** An approval is pending; the turn resumes when the member answers it. */
  paused: boolean;
}

/**
 * Calls that can't do anything are answered here, never executed or shown as tool
 * items: an unknown tool (often a UI component called as one), an empty input, or an
 * exact repeat this turn. The model sometimes emits these as filler; a repeat loop
 * can burn the whole step budget without a reply.
 */
function malformed(
  call: ToolCall,
  tools: ToolDef[],
  seen: ReadonlySet<string>,
): string | undefined {
  if (!tools.some((t) => t.name === call.name)) {
    return `${call.name} is not a tool. UI components are written in openui-lang; reply to the member.`;
  }
  const input = call.input;
  if (!input || (typeof input === "object" && Object.keys(input).length === 0)) {
    return `Empty ${call.name} call ignored; nothing ran. Call a tool only with real arguments, or reply to the member.`;
  }
  if (seen.has(`${call.name}:${JSON.stringify(input)}`)) {
    return `You already called ${call.name} with these arguments this turn. Use that result and reply to the member.`;
  }
  return undefined;
}

export function retryFeedback(diagnostics: readonly Diagnostic[]): string {
  return `<ui_diagnostics>${JSON.stringify(diagnostics).slice(0, 4000)}</ui_diagnostics>
The host rejected your last message because of the problems above, so the members did not see it. Send the whole message again with them fixed. Don't repeat tool calls that already ran.`;
}

export async function runAgentLoop(host: AgentHost, signal: AbortSignal): Promise<LoopEnd> {
  // One retry per turn: a model that can't fix its UI once won't on the third try,
  // and the host still has fallbackMarkdown for the member.
  let retried = false;
  let paused = false;
  // Calls already run this turn, by name + input. A repeat can't learn anything new
  // and is how a confused model burns its step budget without replying.
  const seen = new Set<string>();
  for (let step = 0; step < host.maxSteps; step++) {
    let text = "";
    let started = false;
    const calls: ToolCall[] = [];
    const finish = (status: "completed" | "failed", rejectable: boolean) => {
      if (!started) return undefined;
      const analysis = host.analyze(text);
      const rejected = rejectable && !retried && analysis.diagnostics.length > 0;
      host.finishMessage(text, analysis, status, rejected);
      return rejected ? analysis.diagnostics : undefined;
    };

    try {
      for await (const ev of host.provider.stream({
        system: host.system,
        messages: host.messages(),
        tools: host.tools,
        signal,
      })) {
        if (signal.aborted) break;
        if (ev.type === "text") {
          if (!started) {
            started = true;
            host.startMessage();
          }
          text += ev.delta;
          host.delta(ev.delta);
        } else if (ev.type === "toolCall") {
          calls.push(ev.call);
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        finish("failed", false);
        throw err;
      }
    }
    if (signal.aborted) {
      finish("failed", false);
      if (text) host.append({ role: "assistant", text, toolCalls: [] });
      return { status: "interrupted", paused };
    }

    const rejected = finish("completed", true);
    if (rejected) retried = true;
    host.append({ role: "assistant", text, toolCalls: calls });
    if (calls.length === 0) {
      if (!rejected) return { status: "completed", paused };
      host.append({ role: "user", content: retryFeedback(rejected) });
      continue;
    }

    const results: ToolResult[] = [];
    for (const call of calls) {
      if (signal.aborted) {
        results.push({
          callId: call.id,
          name: call.name,
          output: { error: "interrupted" },
          isError: true,
        });
        continue;
      }
      const refusal = malformed(call, host.tools, seen);
      if (refusal) {
        results.push({
          callId: call.id,
          name: call.name,
          output: { error: refusal },
          isError: true,
        });
        continue;
      }
      const key = `${call.name}:${JSON.stringify(call.input ?? null)}`;
      seen.add(key);
      const r = await host.executeTool(call, paused);
      if (r.paused) paused = true;
      results.push(r.result);
    }
    host.append({ role: "tool", results });
    if (rejected) host.append({ role: "user", content: retryFeedback(rejected) });
    if (signal.aborted) return { status: "interrupted", paused };
  }
  return { status: "stepLimit", paused };
}
