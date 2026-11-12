/**
 * Builds video/index.html (the HyperFrames composition) from:
 *   src/scenes.html   scene markup with {{placeholders}}
 *   src/video.css     the film's own layout (tokens only)
 *   src/timeline.js   the GSAP timeline
 *   src/captured/*    real widget DOM + CSS (scripts/capture-shop.mjs, capture-cited.mjs)
 * Colours come from @pact/protocol's theme, scoped to .theme-light / .theme-dark so one frame can
 * hold both themes (the dark-mode wipe).
 *
 *   npx tsx video/scripts/build.mjs && npx hyperframes render video
 */
import { readFileSync, writeFileSync } from "node:fs";
import { SITE_MARK_SVG, SITE_TOKENS, SITE_TOKENS_CSS } from "@pact/protocol";

const at = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(at(p), "utf8");

const items = JSON.parse(read("src/captured/items.json"));
const parts = JSON.parse(read("src/captured/parts.json"));
const cited = JSON.parse(read("src/captured/cited.json"));

const decl = (t) =>
  Object.entries(t)
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");
const lightDecl = decl(SITE_TOKENS.light);
const rootRule = SITE_TOKENS_CSS.slice(
  SITE_TOKENS_CSS.indexOf("{") + 1,
  SITE_TOKENS_CSS.indexOf("}"),
);
const derived = rootRule.slice(rootRule.indexOf(lightDecl) + lightDecl.length + 1);
const themeCss = [
  `.theme-light{color-scheme:light;${lightDecl};${derived}}`,
  `.theme-dark{color-scheme:dark;${decl(SITE_TOKENS.dark)};${derived}}`,
].join("\n");

// Our own fonts and stickers, served from the project folder.
const local = (s) =>
  s
    .replaceAll('url("/fonts/', 'url("assets/fonts/')
    .replaceAll("/art/stickers/", "assets/stickers/");

/** "Shops for you, *with PayPal*." → word spans; *x* is the serif italic accent. */
const title = (text) =>
  text
    .split(/(\*[^*]+\*[.,!?]?)/)
    .flatMap((chunk) => {
      const em = chunk.match(/^\*([^*]+)\*([.,!?]?)$/);
      if (em) return [`<span class="w"><em>${em[1]}</em>${em[2]}</span>`];
      return chunk
        .split(" ")
        .filter(Boolean)
        .map((w) => `<span class="w">${w}</span>`);
    })
    .join(" ");

let body = read("src/scenes.html")
  .replace(/\{\{item:(\d+)\}\}/g, (_, i) => items[Number(i)].html)
  .replace(/\{\{part:(\w+)\}\}/g, (_, k) => parts[k])
  .replace(/\{\{cited:(\w+)\}\}/g, (_, k) => `<div class="cx-${k}">${cited[k].html}</div>`)
  .replace(/\{\{title:([^}]+)\}\}/g, (_, t) => title(t))
  .replace(/\{\{mark\}\}/g, SITE_MARK_SVG)
  .replace(
    /\{\{sticker:(\w+)\}\}/g,
    (_, k) => `<img class="stk" src="assets/stickers/${k}.webp" alt="">`,
  );
body = local(body);

const css = [
  local(read("src/captured/shop.css")),
  Object.values(cited)
    .map((c) => c.css)
    .join("\n"),
  themeCss,
  read("src/video.css"),
].join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1920, height=1080">
<title>CITED</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
${css}
</style>
</head>
<body class="theme-light">
${body}
<script>
${read("src/timeline.js")}
</script>
</body>
</html>
`;
writeFileSync(at("index.html"), html);
console.log(`wrote video/index.html (${(html.length / 1024).toFixed(0)} KiB)`);
