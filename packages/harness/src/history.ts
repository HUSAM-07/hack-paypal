/**
 * Rebuild the model conversation from persisted items. Items are the only source of truth,
 * so a forked or resumed thread needs no separate transcript.
 */
import type { Item } from "@shop/agent-protocol";
import type { ChatMessage, ModelToolResult } from "./model";
import { type AnyTool, wrapUntrusted } from "./tools";

function toolOutput(item: Extract<Item, { type: "toolCall" }>, tool: AnyTool | undefined) {
  if (item.status === "completed") {
    const visible = tool?.toModel ? tool.toModel(item.result) : item.result;
    return { output: wrapUntrusted(item.name, visible), isError: false };
  }
  if (item.status === "declined") {
    return {
      output: JSON.stringify({ declined: true, reason: item.error ?? "declined by the user" }),
      isError: true,
    };
  }
  return { output: JSON.stringify({ error: item.error ?? "tool failed" }), isError: true };
}

export function itemsToMessages(items: readonly Item[], tools: readonly AnyTool[]): ChatMessage[] {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const out: ChatMessage[] = [];
  let open: Extract<ChatMessage, { role: "assistant" }> | undefined;
  let results: ModelToolResult[] = [];

  const flush = () => {
    if (results.length > 0) out.push({ role: "tool", results });
    results = [];
    open = undefined;
  };

  for (const item of items) {
    switch (item.type) {
      case "userMessage": {
        flush();
        const ui = item.uiState ? `\n\n<ui-state>${JSON.stringify(item.uiState)}</ui-state>` : "";
        out.push({ role: "user", content: `${item.text}${ui}` });
        break;
      }
      case "agentMessage":
        flush();
        open = { role: "assistant", text: item.text, toolCalls: [] };
        out.push(open);
        break;
      case "toolCall":
        // A call without an outcome yet can't be shown: the model API needs a result per call.
        if (item.status === "inProgress") break;
        if (!open) {
          open = { role: "assistant", text: "", toolCalls: [] };
          out.push(open);
        }
        open.toolCalls.push({ id: item.id, name: item.name, input: item.args ?? {} });
        results.push({
          callId: item.id,
          name: item.name,
          ...toolOutput(item, byName.get(item.name)),
        });
        break;
      default:
        // Reasoning summaries, approval records and notices are UI-only.
        break;
    }
  }
  flush();
  return out;
}
