import type { ModelProvider } from "../model";
import { type FakeProviderOptions, fakeProvider } from "./fake";
import { type OpenRouterConfig, openRouterProvider } from "./openrouter";

export * from "./fake";
export * from "./openrouter";

/** The env names the harness reads. Secrets come from `.dev.vars` / wrangler secrets. */
export interface ModelEnv {
  MODEL_PROVIDER?: string;
  /** Wins over MODEL_PROVIDER, so a host whose MODEL_PROVIDER means something else can set it. */
  SHOP_MODEL_PROVIDER?: string;
  OPENROUTER_API_KEY?: string;
  SHOP_MODEL?: string;
  CF_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
}

export function openRouterConfigFromEnv(env: ModelEnv): OpenRouterConfig | undefined {
  if (!env.OPENROUTER_API_KEY) return undefined;
  return {
    apiKey: env.OPENROUTER_API_KEY,
    ...(env.SHOP_MODEL ? { model: env.SHOP_MODEL } : {}),
    ...(env.CF_ACCOUNT_ID ? { accountId: env.CF_ACCOUNT_ID } : {}),
    ...(env.AI_GATEWAY_ID ? { gatewayId: env.AI_GATEWAY_ID } : {}),
    ...(env.CF_AIG_TOKEN ? { gatewayToken: env.CF_AIG_TOKEN } : {}),
    appTitle: "CITED Shop",
  };
}

/**
 * `MODEL_PROVIDER=fake` always runs offline. `openrouter` needs `OPENROUTER_API_KEY`. Unset picks
 * OpenRouter when a key exists, else fake, so a fresh checkout works with no secrets.
 */
export function resolveModelProvider(env: ModelEnv, fake: FakeProviderOptions = {}): ModelProvider {
  const mode = (env.SHOP_MODEL_PROVIDER ?? env.MODEL_PROVIDER)?.toLowerCase();
  if (mode === "fake") return fakeProvider(fake);
  const cfg = openRouterConfigFromEnv(env);
  if (mode === "openrouter" && !cfg) {
    throw new Error("MODEL_PROVIDER=openrouter needs OPENROUTER_API_KEY");
  }
  return cfg ? openRouterProvider(cfg) : fakeProvider(fake);
}
