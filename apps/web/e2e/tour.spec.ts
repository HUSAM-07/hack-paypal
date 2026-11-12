import { expect, test } from "@playwright/test";

// The server-rendered pages (console, /mcp) come from the worker, which this dev server does not
// run: a stub page that loads the same /fx/tour.js stands in for them.
const STUB = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>stub</title></head>
<body><main><h1>Stub page</h1></main><script type="module" src="/fx/tour.js"></script></body></html>`;

test.beforeEach(async ({ page }) => {
  await page.route(/\/(console|mcp)(\/|\?|$)/, (route) =>
    route.fulfill({ contentType: "text/html", body: STUB }),
  );
});

test("no bar unless the tour was started", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Take the 2-minute tour/ })).toBeVisible();
  await expect(page.locator("#cited-tour")).toHaveCount(0);
});

test("the landing starts the tour, Next and Back carry it across pages, Esc ends it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Take the 2-minute tour/ }).click();
  await expect(page).toHaveURL(/\/\?tour=1#problem$/);

  const bar = page.getByRole("region", { name: "Guided tour" });
  await expect(bar).toBeVisible();
  await expect(bar.getByText("Tour 1 of 8")).toBeVisible();
  await expect(bar.locator("[aria-live=polite]")).toContainText("never click an affiliate link");
  await expect(bar.getByRole("button", { name: "Back" })).toBeDisabled();

  await bar.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/console\?clean=1&tour=2$/);
  await expect(bar.getByText("Tour 2 of 8")).toBeVisible();
  await expect(bar.locator("[aria-live=polite]")).toContainText("Winix");
  // Back and Next are the next control for the keyboard too.
  await expect(bar.getByRole("link", { name: "Next" })).toBeFocused();

  await bar.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/\?tour=1#problem$/);
  await expect(bar.getByText("Tour 1 of 8")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#cited-tour")).toHaveCount(0);
  await expect(page).not.toHaveURL(/tour=/);
  // Gone for good: a reload does not bring it back.
  await page.reload();
  await expect(page.locator("#cited-tour")).toHaveCount(0);
});

test("a stop can be opened directly, and the bar leaves the page readable", async ({ page }) => {
  await page.goto("/proof?tour=4#result");
  const bar = page.getByRole("region", { name: "Guided tour" });
  await expect(bar).toContainText("+90.3pp");
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
  // Bottom of the page: the bar is reserved space, not a cover.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const [barTop, lastBottom] = await page.evaluate(() => {
    const last = document.querySelector("main")?.getBoundingClientRect().bottom ?? 0;
    return [document.getElementById("cited-tour")?.getBoundingClientRect().top ?? 0, last];
  });
  expect(lastBottom).toBeLessThanOrEqual(barTop + 1);
});

test("the last stop finishes the tour", async ({ page }) => {
  await page.goto("/mcp?tour=8");
  const bar = page.getByRole("region", { name: "Guided tour" });
  await expect(bar.getByText("Tour 8 of 8")).toBeVisible();
  await bar.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator("#cited-tour")).toHaveCount(0);
  await expect(page).toHaveURL(/\/mcp$/);
});
