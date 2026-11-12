// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Colour values live in one place, packages/protocol/src/theme.ts. Every other stylesheet, page
 * template and component reads the semantic tokens (`var(--primary)`, `var(--muted-foreground)`,
 * ...). This test fails on any hex, rgb(), hsl(), oklch() or lab() literal anywhere else.
 */

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

const ROOTS = [
  "apps/web/src",
  "apps/web/public/theme.js",
  "apps/web/index.html",
  "apps/web/proof.html",
  "apps/web/studio.html",
  "apps/web/app.html",
  "apps/worker/src",
  "apps/console/src",
  "packages/protocol/src",
  // The shop (genui widget kit and shop web app).
  "packages/genui/src",
  "apps/shop-web/src",
];

/**
 * The palette itself, and generated copies of it; plus the shop's stand-ins for third-party
 * merchant pages and product photos (fake art, not our UI).
 */
const ALLOWED_FILES = new Set([
  "packages/protocol/src/theme.ts",
  "apps/web/src/styles/site-theme.css",
  "packages/genui/src/fixtures.ts",
  "apps/shop-web/src/mock/pages.ts",
]);

/**
 * Lines that must carry a literal: <meta name="theme-color"> (browsers read it before any CSS),
 * and the dither field's canvas probe, which reads a resolved token back as pixels.
 */
const ALLOWED_LINE = /name="theme-color"|fillStyle = "#808080"/;

const COLOUR = new RegExp(
  [
    // hex, and functional notations (also inside Tailwind arbitrary values like shadow-[0_0_rgba(…)])
    String.raw`#[0-9a-fA-F]{3,8}\b(?![-\w])`,
    String.raw`(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]`,
    // Tailwind's fixed palette (bg-white, text-zinc-500, ring-black/5, ...)
    String.raw`\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|shadow|decoration|divide|accent|caret|placeholder)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b`,
    // named colours as CSS values
    String.raw`(?:color|background|fill|stroke|border(?:-\w+)?)\s*:\s*(?:white|black)\b`,
  ].join("|"),
  "g",
);

function files(path: string): string[] {
  const abs = join(repo, path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .map((f) => join(abs, f))
    .filter((f) => /\.(tsx?|css|html|js|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => statSync(f).isFile());
}

describe("colours come from the semantic tokens only", () => {
  it("no source file outside theme.ts has a colour literal", () => {
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const file of files(root)) {
        const rel = relative(repo, file);
        if (ALLOWED_FILES.has(rel)) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (ALLOWED_LINE.test(line)) return;
            for (const m of line.matchAll(COLOUR)) hits.push(`${rel}:${i + 1}  ${m[0]}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
