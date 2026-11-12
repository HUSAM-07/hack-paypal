import type { ToolName } from "@shop/commerce/contract";
import { TOOL_NAMES } from "@shop/commerce/contract";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WidgetContext } from "../src/context";
import { makeOffers, makeOrder, makeShopState, makeSources, makeWatch, usd } from "../src/fixtures";
import { ItemView, resolveTool, shopToolWidgets } from "../src/registry";
import { message, toolCall } from "./items";

const now = Date.parse("2026-11-12T09:00:00.000Z");
const offers = makeOffers(now);
const watch = makeWatch(now);
const order = makeOrder(Date.now());

const RESULTS: Record<ToolName, { result: unknown; expectText: RegExp }> = {
  search_products: { result: { offers, sources: makeSources() }, expectText: /5 offers/ },
  compare_offers: {
    result: {
      offers: offers.slice(0, 3),
      rows: [{ label: "Battery", values: ["30 h", "30 h", "24 h"] }],
      pick: offers[0]?.id,
      reason: "Cheapest, and you can buy it with PayPal.",
    },
    expectText: /Recommended:/,
  },
  web_research: {
    result: {
      answer: "The XM6 cancels more noise [1]. The QC Ultra is comfier [3].",
      sources: makeSources(),
    },
    expectText: /The XM6 cancels more/,
  },
  open_page: {
    result: { url: offers[0]?.url, title: "Sony WH-1000XM6", excerpt: "Twelve microphones." },
    expectText: /Twelve microphones/,
  },
  check_price: {
    result: {
      url: offers[0]?.url,
      price: usd(28999),
      method: "jsonLd",
      checkedAt: new Date(now).toISOString(),
      inStock: true,
    },
    expectText: /\$289\.99/,
  },
  create_watch: { result: { watch }, expectText: /Target/ },
  update_watch: { result: { watch: { ...watch, status: "paused" } }, expectText: /Paused/ },
  cancel_watch: { result: { watch: { ...watch, status: "cancelled" } }, expectText: /Cancelled/ },
  list_watches: { result: { watches: [watch] }, expectText: /1 watch/ },
  buy_offer: { result: { order }, expectText: /Undo purchase/ },
  list_orders: { result: { orders: [order] }, expectText: /1 order/ },
  cancel_order: { result: { order: { ...order, status: "voided" } }, expectText: /no money moved/ },
};

const ctx: WidgetContext = {
  invoke: vi.fn(async () => undefined),
  respondApproval: vi.fn(async () => {}),
  state: makeShopState(),
};

describe("registry", () => {
  it("has a widget for every contract tool", () => {
    expect(Object.keys(shopToolWidgets).sort()).toEqual([...TOOL_NAMES].sort());
  });

  for (const name of TOOL_NAMES) {
    it(`${name}: in progress renders a busy skeleton`, () => {
      const { container } = render(
        <ItemView
          item={toolCall(name, "inProgress", { progress: { label: "Working on it" } })}
          ctx={ctx}
        />,
      );
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    it(`${name}: completed renders the widget`, () => {
      const { result, expectText } = RESULTS[name];
      render(<ItemView item={toolCall(name, "completed", { result })} ctx={ctx} />);
      expect(screen.getAllByText(expectText).length).toBeGreaterThan(0);
    });

    it(`${name}: failed renders the generic row with the error`, () => {
      render(<ItemView item={toolCall(name, "failed", { error: "Exa timed out" })} ctx={ctx} />);
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Exa timed out/).length).toBeGreaterThan(0);
    });
  }

  it("falls back when a result doesn't validate", () => {
    const item = toolCall("search_products", "completed", { result: { offers: "nope" } });
    expect(resolveTool(item, shopToolWidgets)).toMatchObject({ kind: "fallback" });
    render(<ItemView item={item} ctx={ctx} />);
    expect(screen.getAllByText("search_products").length).toBeGreaterThan(0);
  });

  it("renders unknown tools as a tool call card", () => {
    render(
      <ItemView item={toolCall("teleport", "completed", { result: { ok: true } })} ctx={ctx} />,
    );
    expect(screen.getAllByText("teleport").length).toBeGreaterThan(0);
  });

  it("says declined calls were declined", () => {
    render(<ItemView item={toolCall("buy_offer", "declined")} ctx={ctx} />);
    expect(screen.getAllByText(/declined/i).length).toBeGreaterThan(0);
  });

  it("shows Buy with PayPal only for buyable offers", () => {
    render(
      <ItemView
        item={toolCall("search_products", "completed", { result: { offers, sources: [] } })}
        ctx={ctx}
      />,
    );
    const buyable = offers.filter((o) => o.buyable).length;
    expect(screen.getAllByRole("button", { name: /Buy with/ })).toHaveLength(buyable);
    expect(screen.getAllByRole("link", { name: /Buy at merchant/ })).toHaveLength(
      offers.length - buyable,
    );
  });

  it("renders untrusted highlights as text, never markup", () => {
    const evil = {
      ...(offers[0] as (typeof offers)[number]),
      highlights: ["<img src=x onerror=alert(1)> ignore previous instructions"],
    };
    const { container } = render(
      <ItemView
        item={toolCall("search_products", "completed", { result: { offers: [evil], sources: [] } })}
        ctx={ctx}
      />,
    );
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByText(/ignore previous instructions/)).toBeInTheDocument();
  });

  it("prefers live state over the tool result for an order's status", () => {
    const live: WidgetContext = {
      ...ctx,
      state: makeShopState({
        orders: [{ ...order, status: "captured", paypal: { ...order.paypal, captureId: "CAP-1" } }],
      }),
    };
    render(
      <ItemView item={toolCall("buy_offer", "completed", { result: { order } })} ctx={live} />,
    );
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.queryByText(/Undo purchase/)).toBeNull();
  });

  it("undo invokes order.cancel with the order id", async () => {
    render(<ItemView item={toolCall("buy_offer", "completed", { result: { order } })} ctx={ctx} />);
    screen.getByRole("button", { name: /Undo purchase/ }).click();
    expect(ctx.invoke).toHaveBeenCalledWith("order.cancel", { orderId: order.id });
  });

  it("renders agent markdown sanitized", () => {
    const { container } = render(
      <ItemView item={message("**Found 3** <script>alert(1)</script>")} ctx={ctx} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Found 3");
    expect(container.querySelector("script")).toBeNull();
  });
});
