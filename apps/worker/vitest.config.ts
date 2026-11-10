import { readFileSync } from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const live = process.env.LIVE === "1";

/** The live smoke test reads the real key from the gitignored .dev.vars; nothing else does. */
function devVar(name: string): string | undefined {
  try {
    const line = readFileSync(path.join(import.meta.dirname, ".dev.vars"), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          MODEL_PROVIDER: live ? "anthropic" : "fake",
          ANTHROPIC_API_KEY: live ? (devVar("ANTHROPIC_API_KEY") ?? "") : "",
          CHANNEL3_API_KEY: "",
          // /try must use its scripted agent in tests, whatever .dev.vars holds.
          LLM_BASE_URL: "",
          LLM_API_KEY: "",
          SESSION_SECRET: "test-session-secret-that-is-long-enough-0123456789",
          RP_ID: "localhost",
          ORIGINS: "http://localhost:5173",
          DEV_AUTH: "1",
          INVITE_CODE: "test-invite",
          // Tests that exercise PayPal switch to sandbox via setPayPalTestOverrides().
          PAYPAL_MODE: "simulated",
          PAYPAL_CLIENT_ID: "test-client-id",
          PAYPAL_CLIENT_SECRET: "test-client-secret",
          PAYPAL_WEBHOOK_ID: "WH-TEST-ID",
          // Deployed-like CITED: writes from outside need this token. CITED_OPEN_API is unset
          // here on purpose; test/cited.test.ts checks the locked and opt-in configs directly.
          CITED_API_TOKEN: "test-cited-token",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
    include: live ? ["test/live.test.ts"] : ["test/**/*.test.ts"],
    exclude: live ? [] : ["test/live.test.ts"],
    testTimeout: live ? 120_000 : 15_000,
  },
}));
