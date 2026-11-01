import { createAnthropic } from "@ai-sdk/anthropic";
import { type ModelMessage, streamText, type ToolSet, tool } from "ai";
import type { ChatMessage, ModelProvider, ProviderEvent, StreamRequest } from "./provider";

export function anthropicProvider(apiKey: string, modelId: string): ModelProvider {
  const anthropic = createAnthropic({ apiKey });
  return {
    name: `anthropic:${modelId}`,
    async *stream(req: StreamRequest): AsyncIterable<ProviderEvent> {
      const tools: ToolSet = {};
      for (const t of req.tools) {
        tools[t.name] = tool({ description: t.description, inputSchema: t.inputSchema });
      }
      const result = streamText({
        model: anthropic(modelId),
        // Anthropic caches the prefix tools → system, so one breakpoint here covers the
        // catalog-derived prompt and every tool schema.
        instructions: {
          role: "system",
          content: req.system,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        messages: toModelMessages(req.messages),
        tools,
        abortSignal: req.signal,
        maxRetries: 2,
      });
      for await (const part of result.stream) {
        switch (part.type) {
          case "text-delta":
            if (part.text) yield { type: "text", delta: part.text };
            break;
          case "tool-call":
            yield {
              type: "toolCall",
              call: { id: part.toolCallId, name: part.toolName, input: part.input },
            };
            break;
          case "finish":
            yield { type: "finish", reason: part.finishReason };
            break;
          case "error":
            throw part.error instanceof Error ? part.error : new Error("model stream error");
        }
      }
    },
  };
}

function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    switch (m.role) {
      case "user":
        return { role: "user", content: m.content };
      case "assistant":
        return {
          role: "assistant",
          content: [
            ...(m.text ? [{ type: "text" as const, text: m.text }] : []),
            ...m.toolCalls.map((c) => ({
              type: "tool-call" as const,
              toolCallId: c.id,
              toolName: c.name,
              input: c.input,
            })),
          ],
        };
      default:
        return {
          role: "tool",
          content: m.results.map((r) => ({
            type: "tool-result" as const,
            toolCallId: r.callId,
            toolName: r.name,
            output: r.isError
              ? { type: "error-json" as const, value: r.output as never }
              : { type: "json" as const, value: r.output as never },
          })),
        };
    }
  });
}
