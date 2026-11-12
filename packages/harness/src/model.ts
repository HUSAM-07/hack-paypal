/** The model seam: one streamed step in, provider-neutral events out. */
import type { z } from "zod";

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: ModelToolCall[] }
  | { role: "tool"; results: ModelToolResult[] };

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelToolResult {
  callId: string;
  name: string;
  /** Already wrapped as untrusted data (see `wrapUntrusted`). */
  output: string;
  isError: boolean;
}

export interface ModelToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

export interface ModelRequest {
  system: string;
  messages: ChatMessage[];
  tools: ModelToolSpec[];
  signal: AbortSignal;
}

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "toolCall"; call: ModelToolCall }
  | { type: "source"; url: string; title: string }
  | { type: "finish"; reason: string };

export interface ModelProvider {
  readonly id: string;
  stream(req: ModelRequest): AsyncIterable<ModelEvent>;
}
