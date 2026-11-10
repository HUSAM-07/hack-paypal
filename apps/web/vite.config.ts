/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Dev server: every /app route loads the app entry, as the worker does in production. */
function appEntryRewrite(): Plugin {
  return {
    name: "pact-app-entry",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (path === "/app" || path.startsWith("/app/")) {
          req.url = `/app.html${req.url?.slice(path.length) ?? ""}`;
        } else if (path === "/proof") {
          req.url = `/proof.html${req.url?.slice(path.length) ?? ""}`;
        } else if (path === "/studio" || path === "/studio/" || path === "/studio/creator") {
          req.url = `/studio.html${req.url?.slice(path.length) ?? ""}`;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss(), appEntryRewrite()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: {
    port: 5180,
    strictPort: true,
    // `npm run dev:live`: the worker (wrangler dev) behind one origin, so its
    // SameSite=Strict session cookie and WebSocket Origin check both hold.
    proxy: {
      "/api": "http://localhost:8790",
      // The worker only takes same-origin model calls; in dev the page and worker differ by port.
      "/studio/api": {
        target: "http://localhost:8790",
        changeOrigin: true,
        configure: (proxy) =>
          proxy.on("proxyReq", (req) => req.setHeader("origin", "http://localhost:8790")),
      },
      "/ws": { target: "ws://localhost:8790", ws: true },
    },
  },
  build: {
    // CSP: no inline <script>; Vite already emits external module scripts only.
    modulePreload: { polyfill: false },
    sourcemap: false,
    // Separate pages: the landing never downloads app code, and vice versa. The SSR build
    // (landing prerender) takes its entry from the CLI instead.
    rollupOptions: isSsrBuild
      ? {}
      : {
          input: {
            index: new URL("./index.html", import.meta.url).pathname,
            app: new URL("./app.html", import.meta.url).pathname,
            studio: new URL("./studio.html", import.meta.url).pathname,
            proof: new URL("./proof.html", import.meta.url).pathname,
          },
        },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
}));
