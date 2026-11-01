/**
 * The worker agent without workerd: prompt, tools, step loop, validation and the
 * Anthropic provider. Nothing here touches Durable Objects or `Env`, so the evals
 * can host the real agent in Node (`@pact/worker/agent`).
 */
export { anthropicProvider } from "./anthropic";
export {
  type AnalyzedMessage,
  analyzeAgentText,
  formatMoney,
  parseUiNodes,
  type StoredRef,
  signatureOf,
  systemPrompt,
  type UiNode,
} from "./catalog";
export { contextBlock, knownAmounts, memberMessage } from "./context";
export { type AgentHost, type LoopEnd, runAgentLoop } from "./loop";
export type { Product, SearchQuery } from "./products";
export type {
  ChatMessage,
  ModelProvider,
  ProviderEvent,
  StreamRequest,
  ToolCall,
  ToolResult,
} from "./provider";
export {
  type Contact,
  type FoundProduct,
  type LedgerEntry,
  type Member,
  type PactRefData,
  pactRefData,
  runTool,
  spendResult,
  TOOL_DEFS,
  type ToolContext,
  ToolError,
} from "./tools";
