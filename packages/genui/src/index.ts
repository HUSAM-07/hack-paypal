// Reusable generative-UI widget kit + registry: protocol items → widgets, keyed by item type and
// tool name. Styles: import "@shop/genui/styles.css" once; it reads the host's design tokens.
export {
  ApprovalCard,
  type ApprovalCardProps,
  type ApprovalStatus,
} from "./aui/approval-card";
export { type AwayItem, AwaySummary } from "./aui/away-summary";
export { CitedAnswer, type CitedSegment, type CitedSource } from "./aui/cited-answer";
export { ThinkingLoader } from "./aui/thinking-loader";
export { Toaster, toast } from "./aui/toaster";
export { ToolCallCard } from "./aui/tool-call-card";
export {
  clock,
  defaultWidgetContext,
  domainOf,
  relativeTime,
  useNow,
  useWidgetContext,
  type WidgetContext,
  WidgetProvider,
} from "./context";
export {
  currencyExponent,
  diffMoney,
  formatMoney,
  minorToDecimalString,
  moneyToInput,
  parseMajorToMinor,
  percentOff,
} from "./money";
export {
  CountdownRing,
  MerchantChip,
  Pill,
  Price,
  PriceStack,
  Skeleton,
  SourceChips,
  Sparkline,
  Thumb,
} from "./primitives";
export {
  createRegistry,
  ItemView,
  type Registry,
  RegistryItem,
  type ResolvedTool,
  renderItem,
  resolveTool,
  shopToolWidgets,
  type ToolWidgetDef,
} from "./registry";
export { ApprovalWidget } from "./widgets/approvals";
export { CompareOffersWidget } from "./widgets/compare";
export {
  AgentMessage,
  type InboxEntry,
  InboxSummary,
  Reasoning,
  SystemNotice,
  ToolCallFallback,
  UserMessage,
} from "./widgets/messages";
export { OrderCard, OrderRow, OrderStatusPill, useLiveOrder } from "./widgets/orders";
export { PayPalMark, ProductCard, ProductCarousel } from "./widgets/products";
export { toCitedSegments, toCitedSources } from "./widgets/research";
export type { ApprovalItem, ToolCallItem, ToolWidgetProps } from "./widgets/types";
export { WalletConnectCard } from "./widgets/wallet";
export { useLiveWatch, WatchCard, WatchRow, WatchStatusPill } from "./widgets/watches";
