/**
 * Renders the landing page into dist/index.html after `vite build`, so the first
 * response already contains the full page; the client then hydrates it.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const dist = new URL("../dist/index.html", import.meta.url);
const ssrDir = new URL("../dist-ssr/", import.meta.url);
const { render } = (await import(new URL("entry-server.js", ssrDir).href)) as {
  render: () => string;
};

let html = readFileSync(dist, "utf8");
if (!html.includes("<!--landing-->")) throw new Error("dist/index.html has no <!--landing--> slot");
html = html.replace("<!--landing-->", render());
// The landing's stylesheet is small; inlining it saves a render-blocking round trip.
// (The page CSP allows inline styles, not inline scripts.)
html = html.replace(
  /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/g,
  (_, href) => {
    const css = readFileSync(new URL(`../dist${href}`, import.meta.url), "utf8");
    return `<style>${css}</style>`;
  },
);
writeFileSync(dist, html);
rmSync(ssrDir, { recursive: true, force: true });
console.log(`prerendered landing: ${(readFileSync(dist).length / 1024).toFixed(1)} KiB`);
