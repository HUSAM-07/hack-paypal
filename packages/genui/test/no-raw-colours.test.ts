// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The CITED design system (cited/spec/DESIGN.md): colour values live only in the theme; the kit
 * reads semantic tokens and never falls back to a literal. Same rule as apps/web's guard.
 */
const root = fileURLToPath(new URL("../src", import.meta.url));

/** Product drawings for demos and tests: picture content, not UI colour. */
const ALLOWED = new Set(["fixtures.ts"]);

const COLOUR = new RegExp(
  [
    String.raw`#[0-9a-fA-F]{3,8}\b(?![-\w])`,
    String.raw`(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]`,
    String.raw`\b(?:bg|text|border|ring|fill|stroke)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|blue|indigo|violet|purple|pink|rose)-\d{2,3})\b`,
    String.raw`(?:color|background|fill|stroke|border(?:-\w+)?)\s*:\s*(?:white|black)\b`,
    // no `var(--token, fallback)`: the tokens are always loaded (component-private `--_x` may chain)
    String.raw`var\(--(?!_)[\w-]+\s*,`,
  ].join("|"),
  "g",
);

describe("genui colours come from the semantic tokens only", () => {
  it("has no colour literal or token fallback outside the fixtures", () => {
    const hits: string[] = [];
    for (const f of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!/\.(tsx?|css)$/.test(f)) continue;
      const rel = relative(root, join(root, f));
      if (ALLOWED.has(rel)) continue;
      readFileSync(join(root, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(COLOUR)) hits.push(`${rel}:${i + 1}  ${m[0]}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
