import type { Item } from "@shop/agent-protocol";
import { ToolArgs, type ToolName, ToolResults } from "@shop/commerce/contract";
import { Component, type ComponentType, type ReactNode } from "react";
import type { z } from "zod";
import { type WidgetContext, WidgetProvider } from "./context";
import { ApprovalWidget } from "./widgets/approvals";
import { CompareOffersWidget } from "./widgets/compare";
import {
  AgentMessage,
  Reasoning,
  SystemNotice,
  ToolCallFallback,
  UserMessage,
} from "./widgets/messages";
import { BuyOfferWidget, CancelOrderWidget, ListOrdersWidget } from "./widgets/orders";
import { SearchProductsWidget } from "./widgets/products";
import { CheckPriceWidget, OpenPageWidget, WebResearchWidget } from "./widgets/research";
import type { ToolCallItem, ToolWidgetProps } from "./widgets/types";
import {
  CancelWatchWidget,
  CreateWatchWidget,
  ListWatchesWidget,
  UpdateWatchWidget,
} from "./widgets/watches";

/**
 * A tool widget: the component plus the schemas its args/result must satisfy. Products other
 * than shop register their own (`createRegistry({ tools: {...} })`).
 */
export type ToolWidgetDef = {
  // biome-ignore lint/suspicious/noExplicitAny: each def pairs its own component with its own schema
  component: ComponentType<{ item: ToolCallItem; args: any; result: any }>;
  result?: z.ZodType;
  args?: z.ZodType;
};

function def<N extends ToolName>(
  name: N,
  component: ComponentType<ToolWidgetProps<N>>,
): ToolWidgetDef {
  return { component, result: ToolResults[name], args: ToolArgs[name] };
}

export const shopToolWidgets: Record<ToolName, ToolWidgetDef> = {
  search_products: def("search_products", SearchProductsWidget),
  compare_offers: def("compare_offers", CompareOffersWidget),
  web_research: def("web_research", WebResearchWidget),
  open_page: def("open_page", OpenPageWidget),
  check_price: def("check_price", CheckPriceWidget),
  create_watch: def("create_watch", CreateWatchWidget),
  update_watch: def("update_watch", UpdateWatchWidget),
  cancel_watch: def("cancel_watch", CancelWatchWidget),
  list_watches: def("list_watches", ListWatchesWidget),
  buy_offer: def("buy_offer", BuyOfferWidget),
  list_orders: def("list_orders", ListOrdersWidget),
  cancel_order: def("cancel_order", CancelOrderWidget),
};

/** Catches a widget that throws on odd data so one bad item never blanks the thread. */
class WidgetBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; resetKey: unknown },
  { failed: boolean; key: unknown }
> {
  override state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(
    props: { resetKey: unknown },
    state: { failed: boolean; key: unknown },
  ) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export type ResolvedTool =
  | { kind: "widget"; def: ToolWidgetDef; args: unknown; result: unknown }
  | { kind: "fallback"; note?: string };

/**
 * Pick how a tool call renders. Exported for tests and for hosts that want to know whether an
 * item has a rich widget (e.g. to collapse plain rows).
 */
export function resolveTool(
  item: ToolCallItem,
  tools: Record<string, ToolWidgetDef>,
): ResolvedTool {
  const d = tools[item.name];
  if (!d) return { kind: "fallback" };
  if (item.status === "failed" || item.status === "declined") return { kind: "fallback" };
  const args = d.args ? d.args.safeParse(item.args) : undefined;
  // Args are only a hint for skeletons; partial or missing args are fine.
  const argsValue = args?.success ? args.data : (item.args ?? undefined);
  if (item.status === "inProgress")
    return { kind: "widget", def: d, args: argsValue, result: undefined };
  if (!d.result) return { kind: "widget", def: d, args: argsValue, result: item.result };
  const parsed = d.result.safeParse(item.result);
  if (!parsed.success)
    return { kind: "fallback", note: "The result didn't match what this card expects." };
  return { kind: "widget", def: d, args: argsValue, result: parsed.data };
}

function ItemBody({
  item,
  tools,
}: {
  item: Item;
  tools: Record<string, ToolWidgetDef>;
}): ReactNode {
  switch (item.type) {
    case "userMessage":
      return <UserMessage item={item} />;
    case "agentMessage":
      return <AgentMessage item={item} />;
    case "reasoning":
      return <Reasoning item={item} />;
    case "systemNotice":
      return <SystemNotice item={item} />;
    case "approvalRequest":
      return <ApprovalWidget item={item} />;
    case "toolCall": {
      const r = resolveTool(item, tools);
      if (r.kind === "fallback")
        return <ToolCallFallback item={item} {...(r.note ? { note: r.note } : {})} />;
      const W = r.def.component;
      return <W item={item} args={r.args} result={r.result} />;
    }
    default:
      return null;
  }
}

/**
 * Render one protocol item through a tool-widget map (the shop widgets by default). Unknown
 * item types render nothing; unknown tools, failures and invalid results get the generic row.
 */
export function RegistryItem({
  item,
  ctx,
  tools = shopToolWidgets,
}: {
  item: Item;
  ctx: WidgetContext;
  tools?: Record<string, ToolWidgetDef>;
}) {
  const fallback =
    item.type === "toolCall" ? (
      <ToolCallFallback item={item} note="This card couldn't be shown." />
    ) : null;
  return (
    <WidgetProvider value={ctx}>
      <WidgetBoundary fallback={fallback} resetKey={item}>
        <ItemBody item={item} tools={tools} />
      </WidgetBoundary>
    </WidgetProvider>
  );
}

export type Registry = {
  tools: Record<string, ToolWidgetDef>;
  renderItem: (item: Item, ctx: WidgetContext) => ReactNode;
};

/** A registry over your own tool widgets, e.g. `{ ...shopToolWidgets, my_tool: {...} }`. */
export function createRegistry({
  tools = shopToolWidgets,
}: {
  tools?: Record<string, ToolWidgetDef>;
} = {}): Registry {
  return {
    tools,
    renderItem: (item, ctx) => <RegistryItem key={item.id} item={item} ctx={ctx} tools={tools} />,
  };
}

/** Render one protocol item with the shop widgets. */
export const renderItem = createRegistry().renderItem;

/** `<ItemView item ctx />`: one protocol item with the shop widgets. */
export function ItemView({ item, ctx }: { item: Item; ctx: WidgetContext }) {
  return <RegistryItem item={item} ctx={ctx} />;
}
