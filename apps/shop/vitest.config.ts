import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Pure modules (AG-UI translation, golden streams) run in Node.
      { test: { name: "unit", include: ["test/unit/**/*.test.ts"], environment: "node" } },
      // The Durable Object, its WebSocket protocol and the routes run in workerd.
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: { MODEL_PROVIDER: "fake", DEV_USER: "u_test", OPENROUTER_API_KEY: "" },
            },
          }),
        ],
        test: { name: "worker", include: ["test/worker/**/*.test.ts"], testTimeout: 15_000 },
      },
    ],
  },
});
