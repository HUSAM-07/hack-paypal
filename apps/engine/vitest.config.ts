import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "../worker/migrations"),
          ),
          PAYPAL_MODE: "simulated",
          MODEL_PROVIDER: "fake",
          PASSPORT_KEY: "test-passport-key",
          PAYPAL_WEBHOOK_ID: "WH-TEST-ID",
          // Tests drive the write API without a token; one test checks the locked default.
          ENGINE_OPEN_API: "1",
        },
      },
    }),
  ],
  test: { setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.ts"] },
}));
