/**
 * Pact agent protocol — modelled on the Codex App Server.
 *
 * Transport: one WebSocket per client, each frame one JSON message ("JSON-RPC lite":
 * request/response/notification shapes without the `jsonrpc` header).
 *
 * Primitives:
 *  - Thread: durable conversation (solo or group), hosted by one ThreadDO.
 *  - Turn:   one unit of agent work started by user input.
 *  - Item:   typed atomic unit inside a turn: started → delta* → completed.
 *
 * The server is the source of truth. Every notification carries a per-thread `seq`
 * so a reconnecting client resumes with `thread/resume { afterSeq }` and replays.
 */
import { z } from "zod";
import { Pact, PactState } from "./domain";
import { Money } from "./money";

export const PROTOCOL_VERSION = 1;

const Id = z.string().min(1).max(128);
const Timestamp = z.iso.datetime();

// ── Items ──

export const ItemStatus = z.enum(["inProgress", "completed", "failed"]);

const ItemBase = z.object({
  id: Id,
  threadId: Id,
  turnId: Id,
  status: ItemStatus,
  createdAt: Timestamp,
});

export const UserMessageItem = ItemBase.extend({
  type: z.literal("userMessage"),
  authorId: Id,
  text: z.string().max(8000),
  /** Generative-UI state the user changed (e.g. a slider), echoed so the model can see it. */
  uiState: z.record(z.string(), z.unknown()).optional(),
});

export const AgentMessageItem = ItemBase.extend({
  type: z.literal("agentMessage"),
  /** OpenUI Lang program (may embed markdown text). Streams via item/agentMessage/delta. */
  text: z.string(),
  /** Plain-markdown rendering for clients that can't run the catalog. */
  fallbackMarkdown: z.string().optional(),
  /**
   * Server-resolved data the UI binds to by ref id (products, quotes, members).
   * Money shown on screen comes from here, never from model-typed text.
   */
  refs: z.record(Id, z.unknown()).default({}),
  /** Catalog validation problems; fed back to the model on the next turn. */
  diagnostics: z.array(z.object({ code: z.string(), message: z.string() })).default([]),
});

export const ToolCallItem = ItemBase.extend({
  type: z.literal("toolCall"),
  name: z.string(),
  /** Redacted for display; raw args stay server-side. */
  summary: z.string().max(300),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export const ApprovalKind = z.enum(["spend", "mandate", "payout", "pactCommit", "pactCancel"]);

export const ApprovalRequestItem = ItemBase.extend({
  type: z.literal("approvalRequest"),
  approvalId: Id,
  /** Only this member may answer. In group threads others see it read-only. */
  approverId: Id,
  kind: ApprovalKind,
  summary: z.string().max(300),
  amount: Money.optional(),
  pactId: Id.optional(),
  /** Requires a WebAuthn assertion bound to `challenge`. */
  stepUp: z.boolean(),
  challenge: z.string().optional(),
  expiresAt: Timestamp,
  decision: z.enum(["approved", "denied", "expired"]).optional(),
});

export const PactUpdateItem = ItemBase.extend({
  type: z.literal("pactUpdate"),
  pactId: Id,
  from: PactState.optional(),
  to: PactState,
  pact: Pact,
  note: z.string().max(300).optional(),
});

export const PaymentEventItem = ItemBase.extend({
  type: z.literal("paymentEvent"),
  kind: z.enum(["charged", "refunded", "payoutSent", "payoutFailed", "chargeFailed", "purchased"]),
  userId: Id.optional(),
  pactId: Id.optional(),
  amount: Money,
  /** PayPal order / capture / payout item id, for receipts and audit. */
  paypalRef: z.string().optional(),
});

export const SystemNoticeItem = ItemBase.extend({
  type: z.literal("systemNotice"),
  level: z.enum(["info", "warning", "error"]),
  text: z.string().max(500),
});

export const Item = z.discriminatedUnion("type", [
  UserMessageItem,
  AgentMessageItem,
  ToolCallItem,
  ApprovalRequestItem,
  PactUpdateItem,
  PaymentEventItem,
  SystemNoticeItem,
]);
export type Item = z.infer<typeof Item>;
export type ItemType = Item["type"];

// ── Threads & turns ──

export const Thread = z.object({
  id: Id,
  title: z.string().max(120),
  kind: z.enum(["solo", "group"]),
  memberIds: z.array(Id).min(1).max(20),
  createdAt: Timestamp,
  archived: z.boolean().default(false),
});
export type Thread = z.infer<typeof Thread>;

export const TurnStatus = z.enum(["completed", "interrupted", "failed", "awaitingApproval"]);

// ── Client → server requests ──

export const ClientRequests = {
  initialize: {
    params: z.object({
      clientInfo: z.object({ name: z.string(), version: z.string() }),
      protocolVersion: z.number().int(),
    }),
    result: z.object({
      serverVersion: z.string(),
      protocolVersion: z.number().int(),
      catalogVersion: z.string(),
      userId: Id,
    }),
  },
  "thread/start": {
    params: z.object({
      title: z.string().max(120).optional(),
      memberIds: z.array(Id).max(19).default([]),
    }),
    result: z.object({ thread: Thread }),
  },
  "thread/resume": {
    params: z.object({ threadId: Id, afterSeq: z.number().int().nonnegative().default(0) }),
    result: z.object({ thread: Thread, lastSeq: z.number().int() }),
  },
  "thread/list": {
    params: z.object({ includeArchived: z.boolean().default(false) }),
    result: z.object({ threads: z.array(Thread) }),
  },
  "thread/archive": {
    params: z.object({ threadId: Id }),
    result: z.object({}),
  },
  "turn/start": {
    params: z.object({
      threadId: Id,
      text: z.string().min(1).max(8000),
      uiState: z.record(z.string(), z.unknown()).optional(),
    }),
    result: z.object({ turnId: Id }),
  },
  "turn/interrupt": {
    params: z.object({ threadId: Id, turnId: Id }),
    result: z.object({}),
  },
  "approval/respond": {
    params: z.object({
      threadId: Id,
      approvalId: Id,
      decision: z.enum(["approve", "deny"]),
      /** WebAuthn assertion JSON when the approval demanded step-up. */
      assertion: z.unknown().optional(),
    }),
    result: z.object({ accepted: z.boolean() }),
  },
} as const;
export type ClientMethod = keyof typeof ClientRequests;

// ── Server → client notifications ──

export const ServerNotifications = {
  "thread/started": z.object({ thread: Thread }),
  "turn/started": z.object({ threadId: Id, turnId: Id, authorId: Id }),
  "turn/completed": z.object({ threadId: Id, turnId: Id, status: TurnStatus }),
  "item/started": z.object({ item: Item }),
  "item/agentMessage/delta": z.object({ threadId: Id, itemId: Id, delta: z.string() }),
  "item/completed": z.object({ item: Item }),
  "thread/presence": z.object({ threadId: Id, onlineUserIds: z.array(Id) }),
} as const;
export type ServerNotificationMethod = keyof typeof ServerNotifications;

// ── Envelopes ──

export const RpcError = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const ErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  notInitialized: -32002,
  unauthorized: -32001,
  forbidden: -32003,
  rateLimited: -32029,
  policyDenied: -32010,
} as const;

export const RpcRequest = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});
export const RpcResponse = z.union([
  z.object({ id: z.union([z.string(), z.number()]), result: z.unknown() }),
  z.object({ id: z.union([z.string(), z.number()]).nullable(), error: RpcError }),
]);
export const RpcNotification = z.object({
  method: z.string(),
  /** Monotonic per thread; absent only for connection-level notices. */
  seq: z.number().int().nonnegative().optional(),
  params: z.unknown(),
});

export type ParamsOf<M extends ClientMethod> = z.input<(typeof ClientRequests)[M]["params"]>;
export type ResultOf<M extends ClientMethod> = z.infer<(typeof ClientRequests)[M]["result"]>;
export type NotificationOf<M extends ServerNotificationMethod> = z.infer<
  (typeof ServerNotifications)[M]
>;
