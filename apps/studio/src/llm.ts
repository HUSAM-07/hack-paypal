/**
 * The Studio agents' model, served from our side so no key reaches the browser. The browser's
 * AgLlmAdapter posts one turn (instructions, conversation items, tool schemas) and reads back a
 * newline-delimited stream of small events, which it turns into AG-UI events for Studio.
 *
 * Provider: an OpenAI-compatible gateway when LLM_BASE_URL + LLM_API_KEY are set (local runs),
 * else Anthropic's Messages API (the deployed worker), else none: the page then runs the
 * scripted Analyst and labels it.
 */
import Anthropic from "@anthropic-ai/sdk";

export type StudioLlmChoice =
  | { kind: "gateway"; model: string; baseUrl: string; apiKey: string; label: string }
  | { kind: "anthropic"; model: string; apiKey: string; label: string }
  | { kind: "scripted"; label: string };

export interface StudioLlmEnv {
  LLM_BASE_URL?: string | undefined;
  LLM_API_KEY?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  /** Model for the Studio agents; default claude-sonnet-5-5. */
  CITED_STUDIO_MODEL?: string | undefined;
}

export const DEFAULT_STUDIO_MODEL = "claude-sonnet-5-5";
/** Per model call. A Studio run is many calls (one per agent turn), each capped. */
export const MAX_OUTPUT_TOKENS = 2_048;
export const MAX_REQUEST_BYTES = 400_000;
export const MAX_TOOLS = 40;

export function studioLlmChoice(env: StudioLlmEnv): StudioLlmChoice {
  const model = env.CITED_STUDIO_MODEL || DEFAULT_STUDIO_MODEL;
  if (env.LLM_BASE_URL && env.LLM_API_KEY)
    return {
      kind: "gateway",
      model,
      baseUrl: env.LLM_BASE_URL.replace(/\/$/, ""),
      apiKey: env.LLM_API_KEY,
      label: model,
    };
  if (env.ANTHROPIC_API_KEY)
    return { kind: "anthropic", model, apiKey: env.ANTHROPIC_API_KEY, label: model };
  return { kind: "scripted", label: "Scripted Analyst (no model key)" };
}

/** The subset of AG Studio's conversation items the proxy reads. */
export type TurnItem =
  | {
      type: "message";
      role: "user" | "system" | "assistant";
      content: string | { type: string; text?: string }[];
    }
  | { type: "function_call"; callId: string; name: string; arguments: string }
  | { type: "function_call_output"; callId: string; output: string }
  | { type: "reasoning" };

export interface TurnRequest {
  instructions?: string;
  input: TurnItem[];
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
}

export type TurnEvent =
  | { t: "text"; d: string }
  | { t: "reasoning"; d: string }
  | { t: "tool"; id: string; name: string }
  | { t: "args"; id: string; d: string }
  | {
      t: "done";
      model: string;
      status: "completed" | "incomplete" | "failed";
      usage?: { inputTokens: number; outputTokens: number };
      error?: string;
    };

/** Validates the browser's turn before any model is called. Returns an error message or the turn. */
export function parseTurn(raw: unknown): TurnRequest | string {
  if (!raw || typeof raw !== "object") return "expected a JSON object";
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.input)) return "input must be an array";
  if (r.tools !== undefined && (!Array.isArray(r.tools) || r.tools.length > MAX_TOOLS))
    return `tools must be an array of at most ${MAX_TOOLS}`;
  if (r.instructions !== undefined && typeof r.instructions !== "string")
    return "instructions must be a string";
  return r as unknown as TurnRequest;
}

const textOf = (content: string | { type: string; text?: string }[]) =>
  (typeof content === "string" ? [{ type: "text", text: content }] : content)
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n");

const parseArgs = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

// ── OpenAI-compatible (gateway) ──

type OaiMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export function toOpenAiMessages(turn: TurnRequest): OaiMessage[] {
  const out: OaiMessage[] = [];
  if (turn.instructions) out.push({ role: "system", content: turn.instructions });
  for (const item of turn.input) {
    if (item.type === "message") {
      const text = textOf(item.content);
      if (item.role === "assistant") out.push({ role: "assistant", content: text });
      else out.push({ role: item.role, content: text });
    } else if (item.type === "function_call") {
      const call = {
        id: item.callId,
        type: "function" as const,
        function: { name: item.name, arguments: item.arguments || "{}" },
      };
      const last = out[out.length - 1];
      if (last && last.role === "assistant") last.tool_calls = [...(last.tool_calls ?? []), call];
      else out.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (item.type === "function_call_output") {
      out.push({ role: "tool", tool_call_id: item.callId, content: item.output });
    }
  }
  return out;
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
      nl = buf.indexOf("\n");
    }
  }
}

async function* gatewayTurn(
  choice: Extract<StudioLlmChoice, { kind: "gateway" }>,
  turn: TurnRequest,
  signal: AbortSignal,
  f: typeof fetch,
): AsyncGenerator<TurnEvent> {
  const tc = turn.toolChoice;
  const res = await f(`${choice.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${choice.apiKey}` },
    body: JSON.stringify({
      model: choice.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: toOpenAiMessages(turn),
      ...(turn.tools?.length
        ? {
            tools: turn.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice:
              tc && typeof tc === "object"
                ? { type: "function", function: { name: tc.name } }
                : (tc ?? "auto"),
          }
        : {}),
    }),
  });
  if (!res.ok || !res.body) {
    yield {
      t: "done",
      model: choice.model,
      status: "failed",
      error: `model gateway answered ${res.status}`,
    };
    return;
  }
  const ids = new Map<number, string>();
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let finish: string | null = null;
  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") break;
    let chunk: {
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: {
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
        finish_reason?: string | null;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk.usage)
      usage = {
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
      };
    const c = chunk.choices?.[0];
    if (!c) continue;
    if (c.finish_reason) finish = c.finish_reason;
    if (c.delta?.content) yield { t: "text", d: c.delta.content };
    for (const call of c.delta?.tool_calls ?? []) {
      let id = ids.get(call.index);
      if (!id) {
        id = call.id ?? `call_${call.index}_${Date.now().toString(36)}`;
        ids.set(call.index, id);
        yield { t: "tool", id, name: call.function?.name ?? "" };
      }
      if (call.function?.arguments) yield { t: "args", id, d: call.function.arguments };
    }
  }
  yield {
    t: "done",
    model: choice.model,
    status: finish === "length" ? "incomplete" : "completed",
    ...(usage ? { usage } : {}),
  };
}

// ── Anthropic Messages API ──

export function toAnthropic(turn: TurnRequest): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const system: string[] = turn.instructions ? [turn.instructions] : [];
  const messages: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", block: Anthropic.ContentBlockParam) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const item of turn.input) {
    if (item.type === "message") {
      const text = textOf(item.content);
      if (!text) continue;
      // Studio's system items carry context for this conversation; they join the system prompt.
      if (item.role === "system") system.push(text);
      else push(item.role, { type: "text", text });
    } else if (item.type === "function_call") {
      push("assistant", {
        type: "tool_use",
        id: item.callId,
        name: item.name,
        input: parseArgs(item.arguments),
      });
    } else if (item.type === "function_call_output") {
      push("user", { type: "tool_result", tool_use_id: item.callId, content: item.output });
    }
  }
  return { system: system.join("\n\n"), messages };
}

async function* anthropicTurn(
  choice: Extract<StudioLlmChoice, { kind: "anthropic" }>,
  turn: TurnRequest,
  signal: AbortSignal,
  f: typeof fetch | undefined,
): AsyncGenerator<TurnEvent> {
  const client = new Anthropic({ apiKey: choice.apiKey, ...(f ? { fetch: f } : {}) });
  const { system, messages } = toAnthropic(turn);
  const tools: Anthropic.Tool[] = (turn.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: "object", ...t.parameters } as Anthropic.Tool.InputSchema,
  }));
  // Forced tool choice (any/tool) is rejected by current models: steer with auto instead.
  const toolChoice: Anthropic.ToolChoice | undefined =
    turn.toolChoice === "none" ? { type: "none" } : tools.length ? { type: "auto" } : undefined;
  const ids = new Map<number, string>();
  try {
    const stream = client.messages.stream(
      {
        model: choice.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Dashboard work is short tool loops: no extended thinking, just progress notes.
        thinking: { type: "between_tools" } as unknown as Anthropic.ThinkingConfigParam,
        ...(system ? { system } : {}),
        messages,
        ...(tools.length ? { tools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        ids.set(event.index, event.content_block.id);
        yield { t: "tool", id: event.content_block.id, name: event.content_block.name };
      } else if (event.type === "content_block_delta") {
        const d = event.delta;
        if (d.type === "text_delta") yield { t: "text", d: d.text };
        else if (d.type === "thinking_delta" && d.thinking) yield { t: "reasoning", d: d.thinking };
        else if (d.type === "input_json_delta") {
          const id = ids.get(event.index);
          if (id && d.partial_json) yield { t: "args", id, d: d.partial_json };
        }
      }
    }
    const final = await stream.finalMessage();
    yield {
      t: "done",
      model: final.model,
      status: final.stop_reason === "max_tokens" ? "incomplete" : "completed",
      usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
      ...(final.stop_reason === "refusal" ? { error: "the model declined this request" } : {}),
    };
  } catch (e) {
    if (e instanceof Anthropic.APIError)
      yield {
        t: "done",
        model: choice.model,
        status: "failed",
        error: `model API answered ${e.status}`,
      };
    else throw e;
  }
}

/** One turn as newline-delimited JSON events. */
export function streamTurn(
  choice: StudioLlmChoice,
  turn: TurnRequest,
  opts: { signal: AbortSignal; fetch?: typeof fetch },
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (e: TurnEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        if (choice.kind === "scripted") {
          send({ t: "done", model: "scripted", status: "failed", error: "no model configured" });
        } else {
          const events =
            choice.kind === "gateway"
              ? gatewayTurn(choice, turn, opts.signal, opts.fetch ?? ((u, i) => fetch(u, i)))
              : anthropicTurn(choice, turn, opts.signal, opts.fetch);
          for await (const e of events) send(e);
        }
      } catch (e) {
        // The message only: never the request, which carries the key in a header.
        console.error(`studio llm: ${(e as Error).name}: ${(e as Error).message}`);
        send({
          t: "done",
          model: choice.kind === "scripted" ? "scripted" : choice.model,
          status: "failed",
          error: (e as Error).name === "AbortError" ? "cancelled" : "the model call failed",
        });
      } finally {
        controller.close();
      }
    },
  });
}
