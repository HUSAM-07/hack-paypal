/**
 * End to end with PAYPAL_MODE=simulated: the domain runs against the shop PayPal simulator,
 * seeded PayPal sellers, a fake Exa and a demo clock, the way ShopperAgent will drive it.
 */
import { describe, expect, it } from "vitest";
import {
  AutoBuyApprovalDetails,
  PurchaseApprovalDetails,
  ShopState,
  type ToolName,
  ToolResults,
} from "../src/contract";
import { ShopError } from "../src/deps";
import { createShopDomain } from "../src/domain";
import { fakeExa, makeDeps, memoryCtx, pageFetch, T0 } from "./helpers";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const OBJECTIVE = "Shops selling it first; skip reviews; pull the price.";
const WEB_URL = "https://bestshop.example/sony-xm6";

function setup() {
  let webPrice = "349.00";
  const exa = fakeExa({
    search: () => ({
      results: [{ url: WEB_URL, title: "Sony XM6 at BestShop", highlights: ["Now $349.00"] }],
      output: {
        content: {
          offers: [
            {
              name: "Sony WH-1000XM6",
              price: "349.00",
              currency: "USD",
              url: WEB_URL,
              merchant: "BestShop",
            },
          ],
        },
      },
    }),
  });
  const pages = pageFetch({
    [WEB_URL]: () =>
      `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", offers: { price: webPrice, priceCurrency: "USD", availability: "InStock" } })}</script>`,
  });
  const env = makeDeps({ exa: exa.client, fetch: pages.fetch });
  const domain = createShopDomain(env.deps);
  const mem = memoryCtx(domain);
  return { ...env, domain, mem, exa, setWebPrice: (p: string) => (webPrice = p) };
}

type Env = ReturnType<typeof setup>;

/** Run a tool the way the harness does: parse args, approval gate, then run; check the result. */
async function tool<N extends ToolName>(
  env: Env,
  name: N,
  rawArgs: unknown,
  approval?: { stepUpVerified?: boolean },
) {
  const t = env.domain.tools[name];
  const args = t.args.parse(rawArgs) as never;
  const spec = t.needsApproval ? await t.needsApproval(args, env.mem.ctx) : false;
  const ctx =
    spec && approval ? env.mem.approved({ ...approval, details: spec.details }) : env.mem.ctx;
  const result = await t.run(args, ctx);
  (ToolResults[name] as { parse(x: unknown): unknown }).parse(result);
  ShopState.parse(env.mem.state);
  return { spec, result: result as never as Awaited<ReturnType<(typeof t)["run"]>> };
}

async function connectWallet(env: Env) {
  const { setupTokenId, approveUrl } = await env.domain.actions["wallet.startConnect"].run(
    {},
    env.mem.ctx,
  );
  expect(approveUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);
  env.sim.approveSetupToken(setupTokenId, { email: "jamie@example.com" });
  const { wallet } = await env.domain.actions["wallet.completeConnect"].run(
    { setupTokenId },
    env.mem.ctx,
  );
  expect(wallet).toMatchObject({ connected: true, label: "PayPal j•••@example.com" });
  // The vault id stays server-side.
  expect(JSON.stringify(env.mem.state)).not.toContain(env.mem.priv.wallet?.vaultId as string);
}

async function watchWithAutoBuy(env: Env) {
  const { result: search } = await tool(env, "search_products", {
    query: "sony xm6 headphones",
    objective: OBJECTIVE,
  });
  const offer = search.offers.find((o) => o.id === "pp_sony_xm6");
  expect(offer?.buyable).toBe(true);
  const args = {
    offerId: "pp_sony_xm6",
    targetPrice: usd(28_000),
    everyMinutes: 60,
    autoBuy: {
      maxUnitPrice: usd(26_000),
      maxTotal: usd(30_000),
      quantity: 1,
      expiresAt: "2026-12-01T00:00:00.000Z",
    },
  };
  // Without approval the rule can't be created.
  const parsed = env.domain.tools.create_watch.args.parse(args);
  await expect(env.domain.tools.create_watch.run(parsed, env.mem.ctx)).rejects.toMatchObject({
    code: "approval_required",
  });
  const { spec, result } = await tool(env, "create_watch", args, {});
  expect(spec).toMatchObject({ kind: "autoBuyRule", amount: usd(30_000), stepUp: false });
  expect(AutoBuyApprovalDetails.safeParse(spec ? spec.details : undefined).success).toBe(true);
  expect(result.watch.autoBuy?.mandateId).toBe("man_0001");
  expect(env.mem.scheduled.get(`watch:${result.watch.id}`)?.at).toBe(T0);
  return result.watch;
}

describe("auto-buy, end to end (simulated PayPal)", () => {
  it("watch → price drop → re-verify → authorize → cooling-off → capture → receipt", async () => {
    const env = setup();
    await connectWallet(env);
    const watch = await watchWithAutoBuy(env);

    // Three checks at the full price build a baseline; each reschedules about an hour out.
    for (let i = 0; i < 3; i++) {
      const out = await env.domain.onSchedule(watch.id, env.mem.ctx);
      expect(out).toMatchObject({ kind: "watchChecked", decision: { kind: "none" } });
      env.clock.advance(60 * 60_000);
    }
    expect(env.mem.state.watches[0]?.history).toHaveLength(3);

    // The seller drops the price under the rule: 259.99 + 8.25% tax = 281.44 ≤ 300.
    env.sellers.setPrice("pp_sony_xm6", usd(25_999));
    const hit = await env.domain.onSchedule({ kind: "watch", watchId: watch.id }, env.mem.ctx);
    expect(hit).toMatchObject({ kind: "watchChecked", decision: { kind: "autoBuy" } });
    const order = hit.kind === "watchChecked" ? hit.order : undefined;
    expect(order).toMatchObject({ status: "coolingOff", total: usd(28_144), watchId: watch.id });
    const auth = env.sim.authorization(order?.paypal.authorizationId as string);
    expect(auth?.status).toBe("CREATED");
    expect(env.sim.orders()[0]?.unit).toMatchObject({
      payee: { merchant_id: "SELLERAUDIO01" },
      custom_id: order?.id,
    });
    expect(env.mem.state.watches[0]?.status).toBe("triggered");
    const captureAt = env.mem.scheduled.get(`capture:${order?.id}`)?.at;
    expect(captureAt).toBe(order?.coolingOffEndsAt);

    // Halfway through the window the scheduler fires early: nothing is captured.
    env.clock.advance(5 * 60_000);
    const early = await env.domain.onSchedule(
      { kind: "capture", orderId: order?.id as string },
      env.mem.ctx,
    );
    expect(early).toMatchObject({ kind: "checkoutAdvanced", order: { status: "coolingOff" } });
    expect(env.sim.calls()["authorizations.capture"]).toBeUndefined();

    env.clock.advance(5 * 60_000);
    const done = await env.domain.onSchedule(
      { kind: "capture", orderId: order?.id as string },
      env.mem.ctx,
    );
    expect(done).toMatchObject({ kind: "checkoutAdvanced", order: { status: "captured" } });
    expect(env.sim.authorization(order?.paypal.authorizationId as string)?.status).toBe("CAPTURED");
    expect(env.mem.state.watches[0]?.status).toBe("completed");
    const receipt = (await tool(env, "list_orders", {})).result.orders[0];
    expect(receipt).toMatchObject({
      status: "captured",
      paypal: { captureId: expect.any(String) },
    });

    // The rule bought once: its one-charge mandate is spent.
    expect(env.mem.priv.ledger).toEqual([
      { mandateId: "man_0001", amountMinor: 28_144, currency: "USD", at: expect.any(String) },
    ]);
  });

  it("undo during cooling-off voids the authorization and pauses the watch", async () => {
    const env = setup();
    await connectWallet(env);
    const watch = await watchWithAutoBuy(env);
    env.sellers.setPrice("pp_sony_xm6", usd(25_999));
    const hit = await env.domain.onSchedule(watch.id, env.mem.ctx);
    const order = hit.kind === "watchChecked" ? hit.order : undefined;
    expect(order?.status).toBe("coolingOff");

    env.clock.advance(3 * 60_000);
    const { order: undone } = await env.domain.actions["order.cancel"].run(
      { orderId: order?.id as string },
      env.mem.ctx,
    );
    expect(undone.status).toBe("voided");
    expect(env.sim.authorization(order?.paypal.authorizationId as string)?.status).toBe("VOIDED");
    expect(env.mem.scheduled.has(`capture:${order?.id}`)).toBe(false);
    expect(env.mem.state.watches[0]?.status).toBe("paused");
    expect(env.mem.priv.ledger).toEqual([]);

    // Even if the old capture timer still fires, nothing is captured.
    env.clock.advance(20 * 60_000);
    const late = await env.domain.onSchedule(
      { kind: "capture", orderId: order?.id as string },
      env.mem.ctx,
    );
    expect(late).toMatchObject({ order: { status: "voided" } });
    expect(env.sim.calls()["authorizations.capture"]).toBeUndefined();

    // Capturing a voided order is refused.
    await expect(
      env.domain.actions["order.captureNow"].run({ orderId: order?.id as string }, env.mem.ctx),
    ).rejects.toBeInstanceOf(ShopError);
  });

  it("a too-good-to-be-true drop pauses for review; approving it buys within the same limits", async () => {
    const env = setup();
    await connectWallet(env);
    const watch = await watchWithAutoBuy(env);
    for (let i = 0; i < 3; i++) {
      await env.domain.onSchedule(watch.id, env.mem.ctx);
      env.clock.advance(60 * 60_000);
    }
    env.sellers.setPrice("pp_sony_xm6", usd(9_999)); // under 40% of 399.99
    const out = await env.domain.onSchedule(watch.id, env.mem.ctx);
    expect(out).toMatchObject({ decision: { kind: "needsReview" } });
    expect(env.mem.state.watches[0]).toMatchObject({
      status: "needsReview",
      reviewReason: expect.stringContaining("40%"),
    });
    expect(env.sim.calls()["orders.create"]).toBeUndefined();

    const { order } = await env.domain.actions["watch.approveReview"].run(
      { watchId: watch.id },
      env.mem.ctx,
    );
    expect(order).toMatchObject({ status: "coolingOff", total: usd(10_824) });
  });

  it("captureNow skips the rest of the window", async () => {
    const env = setup();
    await connectWallet(env);
    const watch = await watchWithAutoBuy(env);
    env.sellers.setPrice("pp_sony_xm6", usd(25_999));
    const hit = await env.domain.onSchedule(watch.id, env.mem.ctx);
    const id = (hit.kind === "watchChecked" ? hit.order?.id : undefined) as string;
    const { order } = await env.domain.actions["order.captureNow"].run(
      { orderId: id },
      env.mem.ctx,
    );
    expect(order.status).toBe("captured");
  });
});

describe("buying from chat", () => {
  it("asks for a purchase approval, needs step-up above the threshold, then authorizes", async () => {
    const env = setup();
    await connectWallet(env);
    await tool(env, "search_products", { query: "dyson vacuum", objective: OBJECTIVE });

    // $649.99 + shipping + tax ≥ $500 step-up threshold.
    const args = env.domain.tools.buy_offer.args.parse({ offerId: "pp_dyson_v15" });
    const spec = await env.domain.tools.buy_offer.needsApproval?.(args, env.mem.ctx);
    expect(spec).toMatchObject({ kind: "purchase", stepUp: true });
    expect(PurchaseApprovalDetails.safeParse(spec ? spec.details : undefined).success).toBe(true);
    await expect(env.domain.tools.buy_offer.run(args, env.mem.ctx)).rejects.toMatchObject({
      code: "approval_required",
    });
    await expect(env.domain.tools.buy_offer.run(args, env.mem.approved())).rejects.toMatchObject({
      code: "step_up_required",
    });

    const { result } = await tool(
      env,
      "buy_offer",
      { offerId: "pp_dyson_v15" },
      { stepUpVerified: true },
    );
    expect(result.order).toMatchObject({ status: "coolingOff", total: usd(70_548) });
  });

  it("a one-off approval can't be stretched by a later price rise", async () => {
    const env = setup();
    await connectWallet(env);
    const args = env.domain.tools.buy_offer.args.parse({ offerId: "pp_anker_737" });
    const spec = await env.domain.tools.buy_offer.needsApproval?.(args, env.mem.ctx);
    env.sellers.setPrice("pp_anker_737", usd(12_999)); // rises after the card was shown
    const { order } = await env.domain.tools.buy_offer.run(
      args,
      env.mem.approved({ details: spec ? spec.details : undefined }),
    );
    expect(order.status).toBe("failed");
    expect(env.sim.calls()["orders.create"]).toBeUndefined();
  });

  it("web offers are watch-only: never buyable, never auto-bought", async () => {
    const env = setup();
    await connectWallet(env);
    const { result } = await tool(env, "search_products", {
      query: "sony xm6",
      objective: OBJECTIVE,
    });
    const web = result.offers.find((o) => o.source === "exa");
    expect(web).toMatchObject({ buyable: false });
    const id = web?.id as string;
    expect(
      await env.domain.tools.buy_offer.needsApproval?.(
        env.domain.tools.buy_offer.args.parse({ offerId: id }),
        env.mem.ctx,
      ),
    ).toBe(false);
    await expect(
      env.domain.tools.buy_offer.run(
        env.domain.tools.buy_offer.args.parse({ offerId: id }),
        env.mem.approved({ stepUpVerified: true }),
      ),
    ).rejects.toMatchObject({ code: "offer_not_buyable" });
    await expect(
      env.domain.tools.create_watch.run(
        env.domain.tools.create_watch.args.parse({
          offerId: id,
          targetPrice: usd(30_000),
          autoBuy: {
            maxUnitPrice: usd(30_000),
            maxTotal: usd(35_000),
            expiresAt: "2026-12-01T00:00:00.000Z",
          },
        }),
        env.mem.approved(),
      ),
    ).rejects.toMatchObject({ code: "offer_not_buyable" });

    // Watch-only works: the JSON-LD price drop notifies.
    const { result: w } = await tool(env, "create_watch", {
      offerId: id,
      targetPrice: usd(30_000),
    });
    env.setWebPrice("299.00");
    const out = await env.domain.onSchedule(w.watch.id, env.mem.ctx);
    expect(out).toMatchObject({
      decision: { kind: "notify" },
      watch: { status: "triggered", lastCheck: { method: "jsonLd" } },
    });
  });

  it("buying needs a connected wallet", async () => {
    const env = setup();
    const args = env.domain.tools.buy_offer.args.parse({ offerId: "pp_anker_737" });
    await expect(
      env.domain.tools.buy_offer.needsApproval?.(args, env.mem.ctx),
    ).rejects.toMatchObject({
      code: "wallet_not_connected",
    });
  });
});

describe("the rest of the tools and actions", () => {
  it("compare, research, open page, check price, list/update/cancel watch, settings, disconnect", async () => {
    const env = setup();
    await tool(env, "search_products", {
      query: "noise cancelling headphones",
      objective: OBJECTIVE,
    });
    const { result: cmp } = await tool(env, "compare_offers", {
      offerIds: ["pp_sony_xm6", "pp_bose_qcu"],
    });
    expect(cmp.pick).toBe("pp_bose_qcu");
    expect(cmp.rows.map((r) => r.label)).toEqual([
      "Price",
      "Shipping",
      "Seller",
      "In stock",
      "Checkout",
    ]);

    const { result: research } = await tool(env, "web_research", {
      question: "XM6 vs QC Ultra",
      objective: OBJECTIVE,
    });
    expect(research.sources[0]?.url).toBe(WEB_URL);

    const { result: price } = await tool(env, "check_price", { offerId: "pp_sony_xm6" });
    expect(price.method).toBe("paypalCatalogue");
    const { result: webPrice } = await tool(env, "check_price", { url: WEB_URL });
    expect(webPrice.method).toBe("jsonLd");

    const { result: created } = await tool(env, "create_watch", {
      offerId: "pp_bose_qcu",
      targetPrice: usd(30_000),
    });
    const id = created.watch.id;
    const { result: upd } = await tool(env, "update_watch", {
      watchId: id,
      targetPrice: usd(31_000),
      status: "paused",
    });
    expect(upd.watch).toMatchObject({ status: "paused", targetPrice: usd(31_000) });
    expect(env.mem.scheduled.has(`watch:${id}`)).toBe(false);
    await env.domain.actions["watch.resume"].run({ watchId: id }, env.mem.ctx);
    expect(env.mem.scheduled.has(`watch:${id}`)).toBe(true);
    const { result: listed } = await tool(env, "list_watches", {});
    expect(listed.watches).toHaveLength(1);
    const { result: cancelled } = await tool(env, "cancel_watch", { watchId: id });
    expect(cancelled.watch.status).toBe("cancelled");
    expect(await env.domain.onSchedule(id, env.mem.ctx)).toMatchObject({ kind: "skipped" });

    expect(
      await env.domain.actions["settings.update"].run({ coolingOffMinutes: 0 }, env.mem.ctx),
    ).toEqual({ coolingOffMinutes: 0 });

    await connectWallet(env);
    const { wallet } = await env.domain.actions["wallet.disconnect"].run({}, env.mem.ctx);
    expect(wallet).toEqual({ connected: false });
    expect(env.mem.priv.wallet).toBeUndefined();
  });

  it("open_page reads through Exa contents and refuses private hosts", async () => {
    const env = setup();
    await expect(
      tool(env, "open_page", { url: "http://169.254.169.254/latest" }),
    ).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("a failing price check backs off instead of hammering", async () => {
    const env = setup();
    const { result } = await tool(env, "search_products", {
      query: "sony xm6",
      objective: OBJECTIVE,
    });
    const web = result.offers.find((o) => o.source === "exa");
    const { result: w } = await tool(env, "create_watch", {
      offerId: web?.id,
      targetPrice: usd(30_000),
    });
    env.setWebPrice("not a price");
    const first = await env.domain.onSchedule(w.watch.id, env.mem.ctx);
    const second = await env.domain.onSchedule(w.watch.id, env.mem.ctx);
    expect(first.kind).toBe("checkFailed");
    const gap = (o: typeof first) =>
      Date.parse(o.kind === "checkFailed" ? o.nextCheckAt : "") - env.clock.now().getTime();
    expect(gap(second)).toBeGreaterThan(gap(first));
  });
});
