/**
 * A deterministic offline model for `MODEL_PROVIDER=fake`, tests and demos. Its output is a pure
 * function of the conversation: rules map the latest user message to a tool call, and the step
 * after a tool result summarises it. Text streams word by word so clients see real deltas.
 */
import type { ChatMessage, ModelEvent, ModelProvider, ModelRequest } from "../model";

export interface FakeStep {
  reasoning?: string;
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
}

export interface FakeScriptContext {
  /** Latest user message (steers included). */
  lastUserText: string;
  /** Results of the previous step's tool calls when the last message is a tool result. */
  toolResults?: { name: string; output: string; isError: boolean }[];
  messages: readonly ChatMessage[];
  toolNames: readonly string[];
}

export type FakeScript = (ctx: FakeScriptContext) => FakeStep;

export interface FakeRule {
  /** Case-insensitive match on the latest user message. */
  match: RegExp;
  tool: string;
  input: unknown | ((text: string) => unknown);
  /** One-line reasoning summary shown before the call. */
  reasoning?: string;
}

export interface FakeProviderOptions {
  rules?: readonly FakeRule[];
  /** Replaces the rule-based script entirely. */
  script?: FakeScript;
  /** Delay between streamed chunks (ms). 0 still yields to the event loop. */
  chunkDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastUserText(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") return m.content.replace(/\n\n<ui-state>[\s\S]*$/, "");
  }
  return "";
}

export function ruleScript(rules: readonly FakeRule[]): FakeScript {
  return (ctx) => {
    if (ctx.toolResults) {
      const declined = ctx.toolResults.filter((r) => r.output.includes('"declined":true'));
      if (declined.length > 0) return { text: "Okay, I didn't go ahead with that." };
      const failed = ctx.toolResults.filter((r) => r.isError);
      if (failed.length > 0) {
        return {
          text: `That didn't work (${failed.map((f) => f.name).join(", ")}). Want me to try again?`,
        };
      }
      const names = ctx.toolResults.map((r) => r.name).join(", ");
      return { text: `Done. The results from ${names} are above.` };
    }
    const text = ctx.lastUserText;
    for (const rule of rules) {
      if (!ctx.toolNames.includes(rule.tool) || !rule.match.test(text)) continue;
      return {
        reasoning: rule.reasoning ?? `Using ${rule.tool} for this request.`,
        toolCalls: [
          {
            name: rule.tool,
            input:
              typeof rule.input === "function"
                ? (rule.input as (t: string) => unknown)(text)
                : rule.input,
          },
        ],
      };
    }
    return {
      text: `You said: ${text}. I'm the offline demo model, so ask me to search or buy something.`,
    };
  };
}

export function fakeProvider(opts: FakeProviderOptions = {}): ModelProvider {
  const script = opts.script ?? ruleScript(opts.rules ?? []);
  const delay = opts.chunkDelayMs ?? 0;
  return {
    id: "fake",
    async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
      const last = req.messages[req.messages.length - 1];
      const callCount = req.messages.reduce(
        (n, m) => n + (m.role === "assistant" ? m.toolCalls.length : 0),
        0,
      );
      const step = script({
        lastUserText: lastUserText(req.messages),
        ...(last?.role === "tool"
          ? {
              toolResults: last.results.map((r) => ({
                name: r.name,
                output: r.output,
                isError: r.isError,
              })),
            }
          : {}),
        messages: req.messages,
        toolNames: req.tools.map((t) => t.name),
      });
      const chunks = async function* (type: "text" | "reasoning", s: string) {
        for (const word of s.match(/\S+\s*/g) ?? []) {
          if (req.signal.aborted) return;
          await sleep(delay);
          yield { type, delta: word } as ModelEvent;
        }
      };
      if (step.reasoning) yield* chunks("reasoning", step.reasoning);
      if (step.text) yield* chunks("text", step.text);
      let n = callCount;
      for (const call of step.toolCalls ?? []) {
        if (req.signal.aborted) return;
        n += 1;
        yield { type: "toolCall", call: { id: `call_${n}`, name: call.name, input: call.input } };
      }
      yield { type: "finish", reason: step.toolCalls?.length ? "tool-calls" : "stop" };
    },
  };
}
