import { expect, type Locator, type Page, test } from "@playwright/test";

const SHOTS = !!process.env.SCREENSHOTS;

test.beforeEach(async ({ page }, info) => {
  const light = info.project.name.includes("light");
  await page.addInitScript(
    (theme) => localStorage.setItem("pact-theme", theme),
    light ? "light" : "dark",
  );
});

async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOTS) return;
  if (target) await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700); // let entrance motion settle
  await page.screenshot({
    path: `screenshots/${test.info().project.name}/${name}.jpg`,
    type: "jpeg",
    quality: 82,
  });
}

/** Press and hold like a person would: the approval gesture is deliberate by design. */
async function hold(page: Page, button: Locator, ms = 2200) {
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error("hold target not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function send(page: Page, text: string) {
  const box = page.getByLabel("Message Pact");
  await box.fill(text);
  await box.press("Enter");
}

test("scripted demo: search → pact → commit → price trigger → approve → receipt → P2P", async ({
  page,
}) => {
  await page.goto("/app/thread_ps6flat?speed=4");
  await expect(page.locator("[data-connection]")).toHaveAttribute("data-connection", "open", {
    timeout: 20_000,
  });
  await shot(page, "01-empty-thread");

  await page.getByRole("button", { name: /Find a PS6 and split/ }).click();
  const digital = page.getByRole("heading", { name: "PlayStation 6 Digital Edition, 2TB" }).first();
  await expect(digital).toBeVisible();
  await expect(page.getByTestId("agent-message").last()).not.toHaveAttribute(
    "data-streaming",
    "true",
  );
  await shot(page, "02-product-cards", page.getByLabel("PS6 · sandbox retailers"));
  await shot(page, "03-compare-question", page.getByRole("radiogroup"));

  await page.getByRole("radio", { name: /Digital Edition/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const commit = page.getByRole("button", { name: /^Commit/ });
  await expect(commit).toBeVisible();
  await expect(page.getByLabel("Pact: PS6 Digital for the flat")).toContainText("Collecting");
  await shot(page, "04-plan-card", page.getByLabel("Plan: PS6 group buy"));
  await shot(page, "05-pact-card", page.getByLabel("Pact: PS6 Digital for the flat"));
  await shot(page, "06-split-breakdown", page.getByLabel("Who pays what"));

  await commit.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Your share");
  await shot(page, "07-paypal-commit");
  await page.getByTestId("paypal-button").click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  const approval = page.getByTestId("approval-sheet").last();
  await expect(approval).toContainText("Approve a charge", { timeout: 30_000 });
  await expect(approval).toContainText("$146.34");
  await shot(page, "08-approval", approval);

  await hold(page, approval.getByRole("button", { name: /hold/i }));
  await expect(page.getByRole("dialog")).toContainText("Confirm with your passkey");
  await shot(page, "09-passkey");
  await page.getByRole("button", { name: "Use passkey" }).click();

  const receipt = page.getByTestId("receipt");
  await expect(receipt).toContainText("$439.00", { timeout: 30_000 });
  await expect(receipt).toContainText("Sam Rivera");
  await expect(page.getByLabel("Pact: PS6 Digital for the flat").last()).toContainText("Done");
  await shot(page, "10-receipt", receipt);
  await shot(page, "11-activity", page.getByLabel("Activity").last());

  await send(page, "Send Ari $20 for snacks");
  await expect(page.getByRole("heading", { name: "Send money" })).toBeVisible();
  await expect(page.getByTestId("agent-message").last()).not.toHaveAttribute(
    "data-streaming",
    "true",
  );
  await shot(page, "12-transfer-card", page.getByRole("heading", { name: "Send money" }));
  await page.getByRole("button", { name: "Confirm transfer" }).click();
  const payout = page.getByTestId("approval-sheet").last();
  await expect(payout).toContainText("Approve a transfer");
  await hold(page, payout.getByRole("button", { name: /hold/i }));
  await expect(page.getByText("Sent to Ari").last()).toBeVisible({ timeout: 20_000 });
});

test("standing order and mandate cards", async ({ page }) => {
  await page.goto("/app/thread_coffee?speed=4");
  await expect(page.getByText("Office coffee beans").first()).toBeVisible({ timeout: 20_000 });
  await send(page, "Show the coffee standing order");
  const chat = page.getByTestId("chat-scroll");
  const mandate = chat.getByText("Coffee fund · standing order").last();
  await expect(mandate).toBeVisible();
  await expect(page.getByTestId("agent-message").last()).not.toHaveAttribute(
    "data-streaming",
    "true",
  );
  await shot(page, "13-schedule-card", chat.getByText("Next run").last());
  await shot(page, "14-mandate-card", mandate);
});

test("reconnects after a drop and resumes the thread without duplicates", async ({ page }) => {
  await page.goto("/app/thread_ps6flat?speed=4");
  const conn = page.locator("[data-connection]");
  await expect(conn).toHaveAttribute("data-connection", "open", { timeout: 20_000 });
  await send(page, "Show my activity");
  await expect(page.getByLabel("Activity").first()).toBeVisible();

  await page.evaluate(() => window.__pactMock?.dropAll());
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  await expect(conn).toHaveAttribute("data-connection", "open", { timeout: 20_000 });

  await send(page, "Find a PS6 and split it three ways");
  await expect(
    page.getByRole("heading", { name: "PlayStation 6 Digital Edition, 2TB" }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("user-message")).toHaveCount(2);
});

test("wallet panel lists mandates and activity", async ({ page }, info) => {
  await page.goto("/app/thread_ps6flat?speed=4");
  if (info.project.name.startsWith("mobile"))
    await page.getByRole("button", { name: "Open wallet" }).click();
  const wallet = page.getByRole("complementary", { name: "Wallet" });
  await expect(wallet.getByTestId("mandates")).toContainText("Coffee fund");
  await shot(page, "15-wallet");
  if (info.project.name.startsWith("mobile")) {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open threads" }).click();
    await expect(page.getByRole("dialog", { name: "Threads" })).toBeVisible();
    await shot(page, "16-nav-drawer");
  }
});
