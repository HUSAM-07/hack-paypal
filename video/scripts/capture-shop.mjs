/**
 * Captures real Shop widget states from the shop SPA's in-browser mock (no backend) and saves
 * each thread item's DOM, plus the app's compiled CSS, to src/captured/. The video composes these
 * fragments, so every widget on screen is our own markup and styles, not a redraw.
 *
 *   npm run dev -w @shop/web -- --port 5192   (mock harness, no ?ws)
 *   node video/scripts/capture-shop.mjs http://localhost:5192/
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5192/";
const out = new URL("../src/captured/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
});
await ctx.addInitScript(() => localStorage.setItem("theme", "light"));
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const items = [];
const seen = new Set();
const grab = async (step) => {
  const now = await page.evaluate(() =>
    [...document.querySelectorAll(".thread__item")].map((el) => ({
      cls: el.firstElementChild?.className ?? "",
      text: el.innerText.replace(/\s+/g, " ").slice(0, 140),
      html: el.innerHTML,
    })),
  );
  for (const it of now) {
    const key = it.html;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ step, ...it });
  }
  const toasts = await page.evaluate(() =>
    [...document.querySelectorAll(".aui-ts__list > *")].map((t) => t.outerHTML),
  );
  for (const html of toasts) {
    if (seen.has(html)) continue;
    seen.add(html);
    items.push({ step, cls: "toast", text: "", html });
  }
};
const send = async (text, wait = 7000) => {
  const box = page.locator("textarea").first();
  await box.fill(text);
  await box.press("Enter");
  await page.waitForTimeout(wait);
};
const click = async (name, wait = 4000) => {
  const b = page.getByRole("button", { name }).last();
  if (await b.count()) {
    await b.click();
    await page.waitForTimeout(wait);
  }
};

const parts = await page.evaluate(() => ({
  awc: document.querySelector(".g-inbox")?.outerHTML ?? "",
  composer: document.querySelector(".composer")?.outerHTML ?? "",
}));
writeFileSync(`${out}/parts.json`, JSON.stringify(parts));
await send("Find the best noise-cancelling headphones under $350");
await grab("search");
await send("compare the top three");
await grab("compare");
await send("buy the Sony WH-1000XM6 from Northwind Audio");
await grab("approval");
await click(/Connect/);
await grab("connected");
await click(/^Buy for/, 5000);
await grab("bought");
await send("watch the Bose QC Ultra and buy it if it drops under $280", 8000);
await grab("watch");
await click(/^(Approve|Allow|Create|Turn on|Start)/, 5000);
await grab("watch-approved");
await page.waitForTimeout(9000);
await grab("auto-bought");

const css = await page.evaluate(() =>
  [...document.styleSheets]
    .map((s) => {
      try {
        return [...s.cssRules].map((r) => r.cssText).join("\n");
      } catch {
        return "";
      }
    })
    .join("\n"),
);
writeFileSync(`${out}/shop.css`, css);
writeFileSync(`${out}/items.json`, JSON.stringify(items, null, 1));
for (const [i, it] of items.entries())
  console.log(i, it.step, it.cls.slice(0, 40), "|", it.text.slice(0, 90));
await browser.close();
