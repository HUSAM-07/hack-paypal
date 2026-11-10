/**
 * AG Studio's AgLlmAdapter, pointed at our worker (/studio/api/llm) so the model key never
 * reaches the browser. The worker streams newline-delimited events; this turns them into the
 * AG-UI content events Studio reads, and assembles the final response for its loop.
 */
import type {
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
} from "ag-studio";
import { API } from "../data";

type Wire =
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

async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<Wire> {
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
      if (line) yield JSON.parse(line) as Wire;
      nl = buf.indexOf("\n");
    }
  }
}

/** Only what the worker needs: no Studio internals leave the page beyond the turn itself. */
function wireRequest(req: AgLlmRequest) {
  return {
    instructions: req.instructions,
    input: req.input,
    tools: (req.tools ?? [])
      .filter((t) => t.kind !== "provided")
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
    toolChoice: req.toolChoice,
  };
}

export function workerAdapter(
  onUsage?: (u: { inputTokens: number; outputTokens: number }) => void,
): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const events: AgAiEvent[] = [];
      const waiter: { wake: (() => void) | null } = { wake: null };
      let finished = false;
      const push = (e: AgAiEvent) => {
        events.push(e);
        waiter.wake?.();
      };
      const id = `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const msgId = `${id}_msg`;
      const complete = (async (): Promise<AgLlmResponse> => {
        let text = "";
        let reasoning = "";
        const calls = new Map<string, { name: string; args: string }>();
        let textOpen = false;
        let reasoningOpen = false;
        let status: AgLlmResponse["status"] = "failed";
        let error: AgLlmResponse["error"];
        let usage: AgLlmResponse["usage"];
        let model: string | undefined;
        try {
          const res = await fetch(`${API}/llm`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(wireRequest(request)),
            ...(options?.signal ? { signal: options.signal } : {}),
          });
          if (!res.ok || !res.body) {
            const body = (await res.json().catch(() => null)) as {
              message?: string;
              error?: string;
            } | null;
            throw new Error(body?.message ?? body?.error ?? `model route answered ${res.status}`);
          }
          for await (const w of lines(res.body)) {
            if (w.t === "text") {
              if (!textOpen) {
                textOpen = true;
                push({ type: "TEXT_MESSAGE_START", messageId: msgId, role: "assistant" });
              }
              text += w.d;
              push({ type: "TEXT_MESSAGE_CONTENT", messageId: msgId, delta: w.d });
            } else if (w.t === "reasoning") {
              if (!reasoningOpen) {
                reasoningOpen = true;
                push({ type: "REASONING_MESSAGE_START", messageId: `${id}_r` });
              }
              reasoning += w.d;
              push({ type: "REASONING_MESSAGE_CONTENT", messageId: `${id}_r`, delta: w.d });
            } else if (w.t === "tool") {
              calls.set(w.id, { name: w.name, args: "" });
              push({ type: "TOOL_CALL_START", toolCallId: w.id, toolCallName: w.name });
            } else if (w.t === "args") {
              const c = calls.get(w.id);
              if (c) c.args += w.d;
              push({ type: "TOOL_CALL_ARGS", toolCallId: w.id, delta: w.d });
            } else if (w.t === "done") {
              status = w.status;
              model = w.model;
              if (w.usage) {
                usage = { inputTokens: w.usage.inputTokens, outputTokens: w.usage.outputTokens };
                onUsage?.(w.usage);
              }
              if (w.error) error = { code: "model_error", message: w.error };
            }
          }
          if (reasoningOpen) push({ type: "REASONING_MESSAGE_END", messageId: `${id}_r` });
          if (textOpen) push({ type: "TEXT_MESSAGE_END", messageId: msgId });
          for (const callId of calls.keys()) push({ type: "TOOL_CALL_END", toolCallId: callId });
        } catch (e) {
          status = (e as Error).name === "AbortError" ? "cancelled" : "failed";
          error = { code: "transport", message: (e as Error).message };
        } finally {
          finished = true;
          waiter.wake?.();
        }
        const output: AgAiOutputItem[] = [];
        if (reasoning)
          output.push({
            id: `${id}_r`,
            kind: "output",
            type: "reasoning",
            summary: [{ type: "summary", text: reasoning }],
          });
        if (text)
          output.push({
            id: msgId,
            kind: "output",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "text", text, annotations: [] }],
          });
        for (const [callId, c] of calls)
          output.push({
            id: `${id}_${callId}`,
            kind: "output",
            type: "function_call",
            callId,
            name: c.name,
            arguments: c.args || "{}",
            status: "completed",
          });
        return {
          id,
          createdAt: Date.now(),
          output,
          status,
          ...(error ? { error } : {}),
          ...(usage ? { usage } : {}),
          ...(model ? { model } : {}),
        };
      })();
      return {
        complete,
        stream: {
          async *[Symbol.asyncIterator]() {
            let i = 0;
            for (;;) {
              while (i < events.length) yield events[i++] as AgAiEvent;
              if (finished) return;
              await new Promise<void>((r) => {
                waiter.wake = r;
              });
              waiter.wake = null;
            }
          },
        },
      };
    },
  };
}
