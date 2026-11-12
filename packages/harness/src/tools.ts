/** Tool registry: typed args and results, approvals, and what the model gets to see. */
import type { ApprovalKind, Money } from "@shop/agent-protocol";
import type { z } from "zod";

export interface ApprovalSpec {
  kind?: ApprovalKind;
  title: string;
  summary: string;
  amount?: Money;
  /** Product-typed details for the approval card. */
  details?: unknown;
  stepUp?: boolean;
  /** Overrides the harness default time-to-live. */
  ttlMs?: number;
}

export interface ToolContext {
  userId: string;
  threadId: string;
  turnId: string;
  toolCallId: string;
  signal: AbortSignal;
  now(): Date;
  /** Streams `item/toolCall/progress`. */
  progress(label: string, fraction?: number): void;
  /**
   * Present when the call ran after an approval: `edits` are the user's changes on the card,
   * `details` what the card showed, `stepUpVerified` whether a passkey check passed.
   */
  approval?: {
    decision: "approved";
    edits?: Record<string, unknown>;
    details?: unknown;
    stepUpVerified?: boolean;
  };
}

export interface ToolDef<A extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  /** Also the widget key on the client. */
  name: string;
  description: string;
  args: A;
  result: R;
  /** Return a spec to pause the turn on an approval; falsy runs the tool straight away. */
  needsApproval?(
    args: z.output<A>,
    ctx: ToolContext,
  ): ApprovalSpec | false | undefined | Promise<ApprovalSpec | false | undefined>;
  /** One line for the collapsed row. Written by the server, never by the model. */
  summarize(args: z.output<A>): string;
  run(args: z.output<A>, ctx: ToolContext): z.input<R> | Promise<z.input<R>>;
  /** What the model sees of the result; defaults to the whole validated result. Keep it small. */
  toModel?(result: z.output<R>): unknown;
}

export const defineTool = <A extends z.ZodType, R extends z.ZodType>(def: ToolDef<A, R>) => def;

// Method syntax above keeps parameters bivariant, so every concrete tool fits AnyTool.
export type AnyTool = ToolDef<z.ZodType, z.ZodType>;

export const MAX_TOOL_OUTPUT_CHARS = 12_000;

/**
 * Tool output, web pages and search highlights are untrusted (CLAUDE.md rule 9). The model gets
 * them inside a `<tool-data>` envelope it is told never to take instructions from, and the
 * payload can't close the envelope early.
 */
export function wrapUntrusted(toolName: string, value: unknown): string {
  let body = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (body.length > MAX_TOOL_OUTPUT_CHARS) {
    body = `${body.slice(0, MAX_TOOL_OUTPUT_CHARS)}…[truncated]`;
  }
  body = body.replace(/<\s*\/?\s*tool-data/gi, "&lt;tool-data");
  return `<tool-data tool="${toolName}" trust="untrusted">${body}</tool-data>`;
}
