/**
 * AG-UI surface over the same harness, the way Codex exposes an MCP server for other
 * ecosystems. `RunAgentInput` → `turn/start` (or `approval/respond` for `resume[]`); protocol
 * notifications → AG-UI events; a turn parked on approvals → `RUN_FINISHED` with an interrupt
 * outcome whose interrupt ids are our approval ids.
 */
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import type { Item, NotificationOf, Turn } from "@shop/agent-protocol";
import type { ApprovalItem } from "@shop/harness";

export interface AguiTranslator {
  start(state: unknown): BaseEvent[];
  /** Translate one notification. `finished` is set once the run's terminal event is out. */
  translate(method: string, params: unknown): BaseEvent[];
  readonly finished: boolean;
}

const json = (v: unknown) => JSON.stringify(v ?? null);

export function createAguiTranslator(opts: {
  threadId: string;
  runId: string;
  /** Pending approvals of the turn when it parks (read from the store). */
  pendingApprovals(turn: Turn): ApprovalItem[];
}): AguiTranslator {
  const { threadId, runId } = opts;
  let finished = false;

  const itemStarted = (item: Item): BaseEvent[] => {
    switch (item.type) {
      case "agentMessage":
        return [{ type: EventType.TEXT_MESSAGE_START, messageId: item.id, role: "assistant" }];
      case "reasoning":
        return [
          { type: EventType.REASONING_START, messageId: item.id },
          { type: EventType.REASONING_MESSAGE_START, messageId: item.id, role: "reasoning" },
        ];
      case "toolCall":
        return [
          { type: EventType.TOOL_CALL_START, toolCallId: item.id, toolCallName: item.name },
          { type: EventType.TOOL_CALL_ARGS, toolCallId: item.id, delta: json(item.args) },
          { type: EventType.TOOL_CALL_END, toolCallId: item.id },
        ];
      default:
        return [];
    }
  };

  const itemCompleted = (item: Item): BaseEvent[] => {
    switch (item.type) {
      case "agentMessage":
        return [{ type: EventType.TEXT_MESSAGE_END, messageId: item.id }];
      case "reasoning":
        return [
          { type: EventType.REASONING_MESSAGE_END, messageId: item.id },
          { type: EventType.REASONING_END, messageId: item.id },
        ];
      case "toolCall":
        return [
          {
            type: EventType.TOOL_CALL_RESULT,
            messageId: `${item.id}:result`,
            toolCallId: item.id,
            role: "tool",
            content: json({
              status: item.status,
              ...(item.result === undefined ? {} : { result: item.result }),
              ...(item.error ? { error: item.error } : {}),
            }),
          },
        ];
      case "systemNotice":
        return [
          {
            type: EventType.CUSTOM,
            name: "systemNotice",
            value: { level: item.level, text: item.text },
          },
        ];
      case "approvalRequest":
        return [
          {
            type: EventType.CUSTOM,
            name: "approvalResolved",
            value: { approvalId: item.approvalId, decision: item.decision },
          },
        ];
      default:
        return [];
    }
  };

  const turnEnded = (turn: Turn): BaseEvent[] => {
    finished = true;
    if (turn.status === "failed") {
      return [{ type: EventType.RUN_ERROR, message: turn.error ?? "The turn failed." }];
    }
    if (turn.status === "awaitingApproval") {
      const interrupts = opts.pendingApprovals(turn).map((a) => ({
        id: a.approvalId,
        reason: `approval:${a.kind}`,
        message: `${a.title}: ${a.summary}`,
        ...(a.toolCallId ? { toolCallId: a.toolCallId } : {}),
        expiresAt: a.expiresAt,
        responseSchema: {
          type: "object",
          properties: { decision: { enum: ["approve", "deny"] }, edits: { type: "object" } },
          required: ["decision"],
        },
        metadata: { approval: a },
      }));
      return [
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          outcome: { type: "interrupt", interrupts },
        },
      ];
    }
    const outcome = turn.status === "interrupted" ? { type: "cancelled" } : { type: "success" };
    return [{ type: EventType.RUN_FINISHED, threadId, runId, outcome }];
  };

  return {
    get finished() {
      return finished;
    },
    start(state) {
      return [
        { type: EventType.RUN_STARTED, threadId, runId },
        { type: EventType.STATE_SNAPSHOT, snapshot: state ?? {} },
      ];
    },
    translate(method, params) {
      if (finished) return [];
      switch (method) {
        case "item/started":
          return itemStarted((params as NotificationOf<"item/started">).item);
        case "item/completed":
          return itemCompleted((params as NotificationOf<"item/completed">).item);
        case "item/agentMessage/delta": {
          const p = params as NotificationOf<"item/agentMessage/delta">;
          return [{ type: EventType.TEXT_MESSAGE_CONTENT, messageId: p.itemId, delta: p.delta }];
        }
        case "item/reasoning/delta": {
          const p = params as NotificationOf<"item/reasoning/delta">;
          return [
            { type: EventType.REASONING_MESSAGE_CONTENT, messageId: p.itemId, delta: p.delta },
          ];
        }
        case "item/toolCall/progress":
          return [{ type: EventType.CUSTOM, name: "toolCallProgress", value: params }];
        case "state/snapshot":
          return [
            {
              type: EventType.STATE_SNAPSHOT,
              snapshot: (params as NotificationOf<"state/snapshot">).state,
            },
          ];
        case "state/patch":
          return [
            { type: EventType.STATE_DELTA, delta: (params as NotificationOf<"state/patch">).ops },
          ];
        case "inbox/added":
          return [{ type: EventType.CUSTOM, name: "inbox", value: params }];
        case "turn/updated": {
          const turn = (params as NotificationOf<"turn/updated">).turn;
          return turn.status === "awaitingApproval" ? turnEnded(turn) : [];
        }
        case "turn/completed":
          return turnEnded((params as NotificationOf<"turn/completed">).turn);
        default:
          return [];
      }
    },
  };
}

export type AguiCommand =
  | {
      kind: "resume";
      answers: {
        approvalId: string;
        decision: "approve" | "deny";
        edits?: Record<string, unknown>;
      }[];
    }
  | { kind: "turn"; text: string }
  | { kind: "invalid"; message: string };

/** What a RunAgentInput asks for: answer interrupts, or start a turn from the last user message. */
export function interpretRunInput(input: RunAgentInput): AguiCommand {
  if (input.resume && input.resume.length > 0) {
    return {
      kind: "resume",
      answers: input.resume.map((r) => {
        const payload = (r.payload ?? {}) as { decision?: string; edits?: Record<string, unknown> };
        const approve = r.status === "resolved" && payload.decision !== "deny";
        return {
          approvalId: r.interruptId,
          decision: approve ? "approve" : "deny",
          ...(payload.edits ? { edits: payload.edits } : {}),
        };
      }),
    };
  }
  const last = [...input.messages].reverse().find((m) => m.role === "user");
  if (last?.role !== "user") return { kind: "invalid", message: "no user message" };
  const text =
    typeof last.content === "string"
      ? last.content
      : last.content
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("")
          .trim();
  if (!text) return { kind: "invalid", message: "empty user message" };
  // input.state is our own state echoed back; the server is the source of truth, so it's ignored.
  return { kind: "turn", text: text.slice(0, 8000) };
}
