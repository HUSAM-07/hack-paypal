import type { Env } from "../env";
import { anthropicProvider } from "./anthropic";
import { fakeProvider } from "./fake";
import type { ModelProvider } from "./provider";

/** Pick the model provider from config. OpenRouter slots in here behind the same interface. */
export function providerFor(env: Env): ModelProvider {
  switch (env.MODEL_PROVIDER) {
    case "fake":
      return fakeProvider();
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
      return anthropicProvider(env.ANTHROPIC_API_KEY, env.MODEL_ID || "claude-sonnet-5-5");
    default:
      throw new Error(`unknown MODEL_PROVIDER ${env.MODEL_PROVIDER}`);
  }
}
