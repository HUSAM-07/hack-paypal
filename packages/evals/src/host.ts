/**
 * What the server adds around a model reply: toolCall items, host-rendered
 * approvalRequest items, and the agentMessage with refs resolved and catalog
 * diagnostics attached. Shared by the reference adapter and history seeding.
 */
import { HOST_ONLY, validateNode } from "@pact/catalog";
import type { Item, Money } from "@pact/protocol";
import type { ThreadState, ToolCallRecord } from "./adapter";
import { refsIn } from "./extract";
import { parseJsonUi, walk } from "./ui";
import { findPact, type World } from "./world";

/** The items a real server would emit for this turn. */
export function hostItems(
  state: ThreadState,
  userId: string,
  calls: readonly ToolCallRecord[],
  text: string,
): Item[] {
  const { world, thread } = state;
  const turnId = `turn_${state.items.length}`;
  let n = 0;
  const base = () => ({
    id: `${turnId}_item${n++}`,
    threadId: thread.id,
    turnId,
    status: "completed" as const,
    createdAt: world.now,
  });
  const items: Item[] = [];
  for (const call of calls) {
    items.push({
      ...base(),
      type: "toolCall",
      name: call.name,
      summary: call.name,
      args: call.args,
      result: call.result,
    });
    const r = call.result as { status?: string; approvalId?: string; amount?: Money } | undefined;
    if (call.name === "requestSpend" && r?.status === "awaiting_approval" && r.approvalId) {
      items.push({
        ...base(),
        type: "approvalRequest",
        approvalId: r.approvalId,
        approverId: userId,
        kind: "spend",
        summary: "Approve this spend",
        ...(r.amount ? { amount: r.amount } : {}),
        stepUp: true,
        expiresAt: new Date(Date.parse(world.now) + 15 * 60_000).toISOString(),
      });
    }
  }

  // Resolve refs the message binds to, the way the server fills AgentMessageItem.refs.
  const known = new Set<string>(world.pacts.map((p) => p.id));
  for (const it of [...state.items, ...items]) if (it.type === "toolCall") refsIn(it.result, known);
  const refs: Record<string, unknown> = {};
  const diagnostics: { code: string; message: string }[] = [];
  try {
    for (const node of walk(parseJsonUi(text))) {
      if ((HOST_ONLY as readonly string[]).includes(node.component)) {
        diagnostics.push({ code: "host_only", message: node.component });
        continue;
      }
      for (const d of validateNode(node.component, node.props, known))
        diagnostics.push({ code: d.code, message: d.message });
      for (const ref of refsIn(node.props)) if (known.has(ref)) refs[ref] = resolveRef(world, ref);
    }
  } catch (e) {
    diagnostics.push({ code: "parse_error", message: (e as Error).message });
  }
  items.push({ ...base(), type: "agentMessage", text, refs, diagnostics });
  return items;
}

function resolveRef(world: World, ref: string): unknown {
  return (
    world.products.find((p) => p.ref === ref) ??
    findPact(world, ref) ??
    world.transfers[ref] ?? { ref }
  );
}
