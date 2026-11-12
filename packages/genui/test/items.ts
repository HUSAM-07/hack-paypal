import type { Item, ItemOf } from "@shop/agent-protocol";

const base = { threadId: "thr_1", turnId: "trn_1", createdAt: "2026-11-12T09:00:00.000Z" };

export function toolCall(
  name: string,
  status: ItemOf<"toolCall">["status"],
  extra: Partial<ItemOf<"toolCall">> = {},
): ItemOf<"toolCall"> {
  return {
    ...base,
    id: `itm_${name}_${status}`,
    type: "toolCall",
    name,
    status,
    summary: name,
    ...extra,
  };
}

export function approval(extra: Partial<ItemOf<"approvalRequest">>): ItemOf<"approvalRequest"> {
  return {
    ...base,
    id: "itm_appr",
    type: "approvalRequest",
    status: "inProgress",
    approvalId: "apr_1",
    kind: "purchase",
    title: "Buy Sony WH-1000XM6",
    summary: "",
    stepUp: false,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    ...extra,
  };
}

export function message(text: string, status: Item["status"] = "completed"): Item {
  return { ...base, id: "itm_msg", type: "agentMessage", status, text };
}
