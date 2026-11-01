/**
 * Provider-neutral model interface. The agent loop in ThreadDO speaks only this, so
 * Anthropic, OpenRouter and the scripted test fake are interchangeable by config.
 *
 * One `stream()` call is one model step. The loop itself (tool execution, approval
 * pauses, step limits) stays in ThreadDO because a pause can outlive the request.
 */
import type { z } from "zod";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  callId: string;
  name: string;
  output: unknown;
  isError?: boolean;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

export type ProviderEvent =
  | { type: "text"; delta: string }
  | { type: "toolCall"; call: ToolCall }
  | { type: "finish"; reason: string };

export interface StreamRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  signal: AbortSignal;
}

export interface ModelProvider {
  readonly name: string;
  stream(req: StreamRequest): AsyncIterable<ProviderEvent>;
}
