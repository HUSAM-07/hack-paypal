/**
 * Renders the prerendered pages (landing, /proof) into their dist HTML after `vite build`,
 * so the first response already contains the full page; the client then hydrates it.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const PAGES = [
  { html: "index.html", slot: "<!--landing-->", ssr: "../dist-ssr/entry-server.js" },
  { html: "proof.html", slot: "<!--proof-->", ssr: "../dist-ssr-proof/entry-server.js" },
];

for (const page of PAGES) {
  const dist = new URL(`../dist/${page.html}`, import.meta.url);
  const { render } = (await import(new URL(page.ssr, import.meta.url).href)) as {
    render: () => string;
  };
  let html = readFileSync(dist, "utf8");
  if (!html.includes(page.slot)) throw new Error(`dist/${page.html} has no ${page.slot} slot`);
  html = html.replace(page.slot, render());
  // The pages' stylesheets are small; inlining saves a render-blocking round trip.
  // (The page CSP allows inline styles, not inline scripts.)
  html = html.replace(
    /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/g,
    (_, href) => {
      const css = readFileSync(new URL(`../dist${href}`, import.meta.url), "utf8");
      return `<style>${css}</style>`;
    },
  );
  writeFileSync(dist, html);
  console.log(`prerendered ${page.html}: ${(readFileSync(dist).length / 1024).toFixed(1)} KiB`);
}
for (const dir of ["../dist-ssr/", "../dist-ssr-proof/"])
  rmSync(new URL(dir, import.meta.url), { recursive: true, force: true });
