/**
 * Captures CITED figures from the built site (landing and /proof) with only the CSS rules they
 * use, each scoped under `.cx-<name>` so the pages' class names can't collide in the video.
 *
 *   npm run build -w @pact/web && (run pact-worker locally, e.g. on :8796)
 *   node video/scripts/capture-cited.mjs http://localhost:8796
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const origin = process.argv[2] ?? "http://localhost:8796";
const out = new URL("../src/captured/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const targets = [
  { name: "field", page: "/", sel: ".field" },
  { name: "steps", page: "/", sel: ".steps" },
  { name: "sessions", page: "/proof", sel: ".fig" },
  { name: "apitrail", page: "/proof", sel: ".ledger" },
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const result = {};
for (const t of targets) {
  await page.goto(origin + t.page, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.locator(t.sel).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500); // let reveal animations settle
  result[t.name] = await page.evaluate(
    ({ sel, name }) => {
      const root = document.querySelector(sel);
      const els = [root, ...root.querySelectorAll("*")];
      const scope = `.cx-${name}`;
      const rules = [];
      const matches = (s) => {
        try {
          return els.some((e) => e.matches(s));
        } catch {
          return false;
        }
      };
      const walk = (list) => {
        for (const r of list) {
          if (r instanceof CSSMediaRule) {
            if (matchMedia(r.conditionText).matches) walk(r.cssRules);
          } else if (r instanceof CSSSupportsRule) {
            walk(r.cssRules);
          } else if (r instanceof CSSStyleRule) {
            const sels = r.selectorText.split(/,(?![^(]*\))/).map((s) => s.trim());
            const keep = sels.filter(
              (s) =>
                !/(^|\s)(:root|html|body)\b/.test(s) &&
                matches(s.replace(/::?(before|after|placeholder|marker)$/, "")),
            );
            if (keep.length)
              rules.push(`${keep.map((s) => `${scope} ${s}`).join(",")}{${r.style.cssText}}`);
          } else if (r instanceof CSSKeyframesRule) {
            rules.push(r.cssText);
          }
        }
      };
      for (const s of document.styleSheets) {
        try {
          walk(s.cssRules);
        } catch {}
      }
      return { html: root.outerHTML, css: rules.join("\n") };
    },
    { sel: t.sel, name: t.name },
  );
  console.log(t.name, result[t.name].html.length, "html,", result[t.name].css.length, "css");
}
writeFileSync(`${out}/cited.json`, JSON.stringify(result));
await browser.close();
