/**
 * Agent protocol: the Codex App Server protocol, on Cloudflare.
 *
 * Transport: one WebSocket per client to the user's agent Durable Object. Each frame is one
 * JSON message in "JSON-RPC lite": request / response / notification shapes without the
 * `"jsonrpc": "2.0"` header. The channel is bidirectional: the server also sends requests
 * (approvals) and pauses the turn until the client answers.
 *
 * Handshake: the client sends `initialize` once, before any other method.
 *
 * Primitives (same names and lifecycles as Codex):
 *  - Item:   typed atomic unit of input/output. `item/started` → `item/<type>/delta`* →
 *            `item/completed`. Clients render on started, stream on delta, finalise on completed.
 *  - Turn:   one unit of agent work started by user input; contains items.
 *  - Thread: durable container of turns. Created, resumed, forked, archived. History persists
 *            so a client can reconnect (`thread/resume { afterSeq }`) and replay a consistent
 *            timeline while work keeps running server-side.
 *
 * This package is product-agnostic. Product data (shop offers, watches, orders) rides in
 * `toolCall.result` and `state/*` payloads typed by the product's own contract.
 *
 * Versioning: additive only. New fields are optional; new item types, methods and
 * notifications are ignored by clients that don't know them.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

const Id = z.string().min(1).max(128);
const Timestamp = z.iso.datetime();
const Json = z.unknown();

/** Integer minor units + ISO 4217 currency. Never floats. Same shape as `@pact/protocol` Money. */
export const Money = z.object({
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof Money>;

// ── Items ──

export const ItemStatus = z.enum(["inProgress", "completed", "failed", "declined"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

const ItemBase = z.object({
  id: Id,
  threadId: Id,
  turnId: Id,
  status: ItemStatus,
  createdAt: Timestamp,
  completedAt: Timestamp.optional(),
});

export const UserMessageItem = ItemBase.extend({
  type: z.literal("userMessage"),
  text: z.string().max(8000),
  /** Generative-UI state the user changed (a slider, a picked option), echoed to the model. */
  uiState: z.record(z.string(), Json).optional(),
});

/** Markdown answer. Streams via `item/agentMessage/delta`. */
export const AgentMessageItem = ItemBase.extend({
  type: z.literal("agentMessage"),
  text: z.string(),
  /** Web sources the text cites as [n]; rendered as citation chips. */
  citations: z
    .array(z.object({ n: z.number().int().positive(), url: z.string(), title: z.string() }))
    .optional(),
});

/** Short reasoning summary (never raw chain of thought). Streams via `item/reasoning/delta`. */
export const ReasoningItem = ItemBase.extend({
  type: z.literal("reasoning"),
  summary: z.string(),
});

/**
 * A tool the agent ran. `name` is also the widget key: clients render it through a registry
 * keyed by tool name and status (inProgress → completed | failed | declined).
 * Progress streams via `item/toolCall/progress`.
 */
export const ToolCallItem = ItemBase.extend({
  type: z.literal("toolCall"),
  name: z.string().min(1).max(64),
  /** One line for collapsed rows, written by the server (never by the model). */
  summary: z.string().max(300),
  args: Json.optional(),
  /** Typed by the product contract for `name`. */
  result: Json.optional(),
  error: z.string().max(500).optional(),
  progress: z
    .object({ label: z.string().max(120), fraction: z.number().min(0).max(1).optional() })
    .optional(),
});

export const ApprovalKind = z.enum([
  /** A one-off purchase outside any standing rule. */
  "purchase",
  /** A standing auto-buy rule (a spend mandate). */
  "autoBuyRule",
  /** Hand a live browser session to the agent or let it submit a form. */
  "browserAction",
  /** Anything else a tool declares `needsApproval`. */
  "tool",
]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalDecision = z.enum(["approved", "denied", "expired"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

/**
 * The durable record of a server-initiated approval request. The turn pauses
 * (`awaitingApproval`) until a decision arrives over any surface.
 */
export const ApprovalRequestItem = ItemBase.extend({
  type: z.literal("approvalRequest"),
  approvalId: Id,
  kind: ApprovalKind,
  /** The tool call this approval gates, when there is one. */
  toolCallId: Id.optional(),
  title: z.string().max(120),
  summary: z.string().max(500),
  amount: Money.optional(),
  /** Product-typed details for the approval card (offer, rule limits…). */
  details: Json.optional(),
  /** Requires a fresh user-presence check (passkey) before the decision counts. */
  stepUp: z.boolean().default(false),
  expiresAt: Timestamp,
  decision: ApprovalDecision.optional(),
});

export const SystemNoticeItem = ItemBase.extend({
  type: z.literal("systemNotice"),
  level: z.enum(["info", "warning", "error"]),
  text: z.string().max(500),
});

export const Item = z.discriminatedUnion("type", [
  UserMessageItem,
  AgentMessageItem,
  ReasoningItem,
  ToolCallItem,
  ApprovalRequestItem,
  SystemNoticeItem,
]);
export type Item = z.infer<typeof Item>;
export type ItemType = Item["type"];
export type ItemOf<T extends ItemType> = Extract<Item, { type: T }>;

// ── Threads and turns ──

export const Thread = z.object({
  id: Id,
  title: z.string().max(120),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  archived: z.boolean().default(false),
  /** First line of the latest user message, for thread lists. */
  preview: z.string().max(200).default(""),
  forkedFrom: z.object({ threadId: Id, turnId: Id.optional() }).optional(),
});
export type Thread = z.infer<typeof Thread>;

export const TurnStatus = z.enum([
  "inProgress",
  "completed",
  "interrupted",
  "failed",
  "awaitingApproval",
]);
export type TurnStatus = z.infer<typeof TurnStatus>;

export const Turn = z.object({
  id: Id,
  threadId: Id,
  status: TurnStatus,
  startedAt: Timestamp,
  completedAt: Timestamp.optional(),
  error: z.string().max(500).optional(),
  /** Who started it: the user, or the agent itself (a watch firing, a workflow finishing). */
  origin: z.enum(["user", "schedule", "workflow"]).default("user"),
});
export type Turn = z.infer<typeof Turn>;

// ── Client → server requests ──

export const ClientInfo = z.object({
  name: z.string().max(64),
  title: z.string().max(120).optional(),
  version: z.string().max(32),
});

export const ClientRequests = {
  initialize: {
    params: z.object({
      clientInfo: ClientInfo,
      protocolVersion: z.number().int(),
      /** Optional features the client can render (e.g. "browserPane", "agui"). */
      capabilities: z.array(z.string().max(64)).max(32).default([]),
    }),
    result: z.object({
      userAgent: z.string(),
      protocolVersion: z.number().int(),
      userId: Id,
      /** Server features this deployment has on (e.g. "browserRun", "autoBuy", "webSearch"). */
      capabilities: z.array(z.string()),
    }),
  },
  "thread/start": {
    params: z.object({ title: z.string().max(120).optional() }),
    result: z.object({ thread: Thread }),
  },
  /** Subscribe this connection to a thread and replay every notification after `afterSeq`. */
  "thread/resume": {
    params: z.object({ threadId: Id, afterSeq: z.number().int().nonnegative().default(0) }),
    result: z.object({ thread: Thread, lastSeq: z.number().int().nonnegative() }),
  },
  /** Copy a thread's history (up to and including `turnId`, or all) into a new thread. */
  "thread/fork": {
    params: z.object({
      threadId: Id,
      turnId: Id.optional(),
      title: z.string().max(120).optional(),
    }),
    result: z.object({ thread: Thread }),
  },
  "thread/list": {
    params: z.object({
      includeArchived: z.boolean().default(false),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    result: z.object({ threads: z.array(Thread), nextCursor: z.string().optional() }),
  },
  /** Read a thread's items without subscribing (exports, other surfaces). */
  "thread/read": {
    params: z.object({ threadId: Id }),
    result: z.object({ thread: Thread, turns: z.array(Turn), items: z.array(Item) }),
  },
  "thread/archive": {
    params: z.object({ threadId: Id, archived: z.boolean().default(true) }),
    result: z.object({}),
  },
  "turn/start": {
    params: z.object({
      threadId: Id,
      text: z.string().min(1).max(8000),
      uiState: z.record(z.string(), Json).optional(),
    }),
    result: z.object({ turn: Turn }),
  },
  /** Add input to the running turn; the agent picks it up at its next step. */
  "turn/steer": {
    params: z.object({ threadId: Id, turnId: Id, text: z.string().min(1).max(8000) }),
    result: z.object({ accepted: z.boolean() }),
  },
  "turn/interrupt": {
    params: z.object({ threadId: Id, turnId: Id }),
    result: z.object({}),
  },
  /**
   * Answer an approval from any surface (another device, AG-UI resume, an email link).
   * Equivalent to responding to the `approval/request` server request.
   */
  "approval/respond": {
    params: z.object({
      approvalId: Id,
      decision: z.enum(["approve", "deny"]),
      /** WebAuthn assertion JSON when the approval asked for step-up. */
      assertion: Json.optional(),
      /** Edits the user made on the card (e.g. a lower max price). */
      edits: z.record(z.string(), Json).optional(),
    }),
    result: z.object({ accepted: z.boolean() }),
  },
  /** Invoke a product action from a widget without a chat turn (cancel a watch, undo an order). */
  "action/invoke": {
    params: z.object({ name: z.string().min(1).max(64), args: Json.optional() }),
    result: z.object({ result: Json.optional() }),
  },
  "browser/takeControl": {
    params: z.object({ sessionId: Id }),
    result: z.object({ liveViewUrl: z.string() }),
  },
  "browser/handBack": {
    params: z.object({ sessionId: Id, note: z.string().max(2000).optional() }),
    result: z.object({}),
  },
} as const;
export type ClientMethod = keyof typeof ClientRequests;

// ── Server → client requests (the turn waits for the client's response) ──

export const ServerRequests = {
  "approval/request": {
    params: z.object({ item: ApprovalRequestItem }),
    result: z.object({
      decision: z.enum(["approve", "deny"]),
      assertion: Json.optional(),
      edits: z.record(z.string(), Json).optional(),
    }),
  },
} as const;
export type ServerRequestMethod = keyof typeof ServerRequests;

// ── Server → client notifications ──

export const BrowserSession = z.object({
  sessionId: Id,
  url: z.string(),
  title: z.string().max(300).default(""),
  /** Who is driving. The pane shows "Agent driving" or "You're in control". */
  controller: z.enum(["agent", "user"]),
  /** Short-lived signed URL; a credential, never logged. Absent when Live View is unavailable. */
  liveViewUrl: z.string().optional(),
  /** Latest screenshot (data URL or R2 URL) when Live View is unavailable. */
  screenshotUrl: z.string().optional(),
  updatedAt: Timestamp,
});
export type BrowserSession = z.infer<typeof BrowserSession>;

/** RFC 6902 JSON Patch operation. */
export const JsonPatchOp = z.object({
  op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
  path: z.string(),
  from: z.string().optional(),
  value: Json.optional(),
});

/** Thread-scoped notifications carry a per-thread `seq`; user-scoped ones (state, browser) don't. */
export const ServerNotifications = {
  "thread/started": z.object({ thread: Thread }),
  "thread/updated": z.object({ thread: Thread }),
  "turn/started": z.object({ turn: Turn }),
  "turn/completed": z.object({ turn: Turn }),
  "item/started": z.object({ item: Item }),
  "item/agentMessage/delta": z.object({ threadId: Id, itemId: Id, delta: z.string() }),
  "item/reasoning/delta": z.object({ threadId: Id, itemId: Id, delta: z.string() }),
  "item/toolCall/progress": z.object({
    threadId: Id,
    itemId: Id,
    label: z.string().max(120),
    fraction: z.number().min(0).max(1).optional(),
  }),
  "item/completed": z.object({ item: Item }),
  /** Whole product state (watches, orders, wallet). Sent after initialize and on resync. */
  "state/snapshot": z.object({ version: z.number().int().nonnegative(), state: Json }),
  /** Incremental product state change; apply only if `baseVersion` matches, else request a snapshot. */
  "state/patch": z.object({
    version: z.number().int().positive(),
    baseVersion: z.number().int().nonnegative(),
    ops: z.array(JsonPatchOp),
  }),
  "browser/updated": z.object({ session: BrowserSession }),
  /** Something happened while no turn was running (a watch fired, an order captured). */
  "inbox/added": z.object({
    id: Id,
    threadId: Id.optional(),
    level: z.enum(["info", "success", "warning", "actionRequired"]),
    title: z.string().max(120),
    body: z.string().max(500).optional(),
    at: Timestamp,
  }),
} as const;
export type ServerNotificationMethod = keyof typeof ServerNotifications;

// ── Envelopes ──

export const RpcId = z.union([z.string().max(64), z.number().int()]);

export const RpcError = z.object({
  code: z.number().int(),
  message: z.string(),
  data: Json.optional(),
});

export const ErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unauthorized: -32001,
  notInitialized: -32002,
  forbidden: -32003,
  notFound: -32004,
  conflict: -32009,
  policyDenied: -32010,
  turnInProgress: -32011,
  rateLimited: -32029,
} as const;

export const RpcRequest = z.object({ id: RpcId, method: z.string(), params: Json.optional() });
export const RpcResponse = z.union([
  z.object({ id: RpcId, result: Json }),
  z.object({ id: RpcId.nullable(), error: RpcError }),
]);
export const RpcNotification = z.object({
  method: z.string(),
  seq: z.number().int().nonnegative().optional(),
  params: Json,
});
export type RpcRequest = z.infer<typeof RpcRequest>;
export type RpcResponse = z.infer<typeof RpcResponse>;
export type RpcNotification = z.infer<typeof RpcNotification>;

export type ParamsOf<M extends ClientMethod> = z.input<(typeof ClientRequests)[M]["params"]>;
export type ResultOf<M extends ClientMethod> = z.infer<(typeof ClientRequests)[M]["result"]>;
export type ServerRequestParamsOf<M extends ServerRequestMethod> = z.infer<
  (typeof ServerRequests)[M]["params"]
>;
export type ServerRequestResultOf<M extends ServerRequestMethod> = z.input<
  (typeof ServerRequests)[M]["result"]
>;
export type NotificationOf<M extends ServerNotificationMethod> = z.infer<
  (typeof ServerNotifications)[M]
>;

/** Classify one inbound frame. Used by both ends of the socket. */
export function classifyFrame(
  raw: unknown,
):
  | { kind: "request"; frame: RpcRequest }
  | { kind: "response"; frame: RpcResponse }
  | { kind: "notification"; frame: RpcNotification }
  | { kind: "invalid" } {
  if (typeof raw !== "object" || raw === null) return { kind: "invalid" };
  const o = raw as Record<string, unknown>;
  if ("method" in o && "id" in o) {
    const r = RpcRequest.safeParse(o);
    return r.success ? { kind: "request", frame: r.data } : { kind: "invalid" };
  }
  if ("method" in o) {
    const r = RpcNotification.safeParse(o);
    return r.success ? { kind: "notification", frame: r.data } : { kind: "invalid" };
  }
  if ("result" in o || "error" in o) {
    const r = RpcResponse.safeParse(o);
    return r.success ? { kind: "response", frame: r.data } : { kind: "invalid" };
  }
  return { kind: "invalid" };
}
