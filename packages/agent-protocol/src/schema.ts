/**
 * JSON Schema for every method, server request, notification and item, the way
 * `codex app-server generate-json-schema` emits them. `npm run gen -w @shop/agent-protocol`
 * writes these to `schema/`; a test keeps the committed files in sync.
 *
 * Params a client writes use the zod *input* shape (defaults optional); results and
 * notifications use the *output* shape (defaults filled in).
 */
import { z } from "zod";
import {
  AgentMessageItem,
  ApprovalRequestItem,
  ClientRequests,
  Item,
  PROTOCOL_VERSION,
  ReasoningItem,
  ServerNotifications,
  ServerRequests,
  SystemNoticeItem,
  ToolCallItem,
  UserMessageItem,
} from "./protocol";

const fileName = (method: string) => method.replaceAll("/", "_");

function toSchema(schema: z.ZodType, io: "input" | "output", title: string): unknown {
  return { title, ...z.toJSONSchema(schema, { io, unrepresentable: "any" }) };
}

/** Relative path → JSON Schema document. */
export function protocolJsonSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [method, def] of Object.entries(ClientRequests)) {
    out[`client/${fileName(method)}.params.json`] = toSchema(
      def.params,
      "input",
      `${method} params`,
    );
    out[`client/${fileName(method)}.result.json`] = toSchema(
      def.result,
      "output",
      `${method} result`,
    );
  }
  for (const [method, def] of Object.entries(ServerRequests)) {
    out[`server-requests/${fileName(method)}.params.json`] = toSchema(
      def.params,
      "output",
      `${method} params`,
    );
    out[`server-requests/${fileName(method)}.result.json`] = toSchema(
      def.result,
      "input",
      `${method} result`,
    );
  }
  for (const [method, def] of Object.entries(ServerNotifications)) {
    out[`notifications/${fileName(method)}.json`] = toSchema(def, "output", method);
  }
  const items = {
    Item,
    UserMessageItem,
    AgentMessageItem,
    ReasoningItem,
    ToolCallItem,
    ApprovalRequestItem,
    SystemNoticeItem,
  };
  for (const [name, schema] of Object.entries(items)) {
    out[`items/${name}.json`] = toSchema(schema, "output", name);
  }
  out["index.json"] = {
    protocolVersion: PROTOCOL_VERSION,
    clientRequests: Object.keys(ClientRequests),
    serverRequests: Object.keys(ServerRequests),
    notifications: Object.keys(ServerNotifications),
    items: Object.keys(items),
  };
  return out;
}

/** Stable serialisation used for the committed files. */
export const formatSchemaFile = (doc: unknown) => `${JSON.stringify(doc, null, 2)}\n`;
