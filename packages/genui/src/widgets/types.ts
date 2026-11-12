import type { ItemOf } from "@shop/agent-protocol";
import type { ToolArgsOf, ToolName, ToolResultOf } from "@shop/commerce/contract";

export type ToolCallItem = ItemOf<"toolCall">;
export type ApprovalItem = ItemOf<"approvalRequest">;

/**
 * Props every tool widget gets. `result` is already validated against `ToolResults[name]`;
 * it is undefined while the call is in progress. Failed and declined calls never reach a
 * tool widget: the registry renders them uniformly.
 */
export type ToolWidgetProps<N extends ToolName> = {
  item: ToolCallItem;
  args: Partial<ToolArgsOf<N>> | undefined;
  result: ToolResultOf<N> | undefined;
};
