/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone dev and build for the shop SPA. Inside apps/web it is a library (`mountShop`).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:8790", ws: true } },
  },
  build: { sourcemap: false, modulePreload: { polyfill: false } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    css: false,
  },
});
