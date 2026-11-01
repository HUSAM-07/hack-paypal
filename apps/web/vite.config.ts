/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: {
    port: 5180,
    strictPort: true,
    // `npm run dev:live`: the worker (wrangler dev) behind one origin, so its
    // SameSite=Strict session cookie and WebSocket Origin check both hold.
    proxy: {
      "/api": "http://localhost:8790",
      "/ws": { target: "ws://localhost:8790", ws: true },
    },
  },
  build: {
    // CSP: no inline <script>; Vite already emits external module scripts only.
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
