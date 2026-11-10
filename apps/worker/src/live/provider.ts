import type { LlmConfig } from "@cited/agents";

/** What drives a live run: a real model behind a gateway or Anthropic, else the scripted agent. */
export type LiveAgentChoice =
  | { kind: "gateway" | "anthropic"; model: string; llm: LlmConfig; label: string }
  | { kind: "scripted"; model: string; label: string };

export interface LiveProviderEnv {
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** Model id for live runs; default claude-sonnet-5-5. */
  CITED_LIVE_MODEL?: string;
}

/** Per-run limits: steps (model calls), output tokens per call. */
export const LIVE_MAX_STEPS = 6;
export const LIVE_MAX_TOKENS = 700;

/**
 * Gateway first (local dev, OpenAI-compatible), then Anthropic's API (the deployed worker),
 * else the scripted agent, labelled so nobody mistakes it for a model.
 */
export function liveAgentChoice(env: LiveProviderEnv, signal?: AbortSignal): LiveAgentChoice {
  const model = env.CITED_LIVE_MODEL || "claude-sonnet-5-5";
  const base = {
    models: { gpt: model, gemini: model, sonnet: model },
    maxSteps: LIVE_MAX_STEPS,
    maxTokens: LIVE_MAX_TOKENS,
    ...(signal ? { signal } : {}),
  };
  if (env.LLM_BASE_URL && env.LLM_API_KEY) {
    return {
      kind: "gateway",
      model,
      label: model,
      llm: { ...base, baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, api: "openai" },
    };
  }
  if (env.ANTHROPIC_API_KEY) {
    return {
      kind: "anthropic",
      model,
      label: model,
      llm: {
        ...base,
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: env.ANTHROPIC_API_KEY,
        api: "anthropic",
      },
    };
  }
  return { kind: "scripted", model: "scripted", label: "scripted agent (no model key)" };
}
