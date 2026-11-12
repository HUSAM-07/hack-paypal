import type { Offer } from "@shop/commerce/contract";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WidgetContext } from "../src/context";
import { makeOffers, makeShopState, usd } from "../src/fixtures";
import { ItemView } from "../src/registry";
import { approval } from "./items";

const offer = makeOffers()[0] as Offer;
const purchase = approval({
  kind: "purchase",
  amount: usd(29999),
  details: { offer, quantity: 1, total: usd(29999), coolingOffMinutes: 10 },
});

function ctxWith(over: Partial<WidgetContext> = {}): WidgetContext {
  return {
    invoke: vi.fn(async () => undefined),
    respondApproval: vi.fn(async () => {}),
    state: makeShopState({ wallet: { connected: true, label: "PayPal ••••4821" } }),
    ...over,
  };
}

describe("ApprovalWidget", () => {
  it("shows the server amount and approves with ⌘/Ctrl+Enter", async () => {
    const ctx = ctxWith();
    render(<ItemView item={purchase} ctx={ctx} />);
    expect(screen.getByRole("button", { name: /Buy for \$299\.99/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: /Buy for/ }), {
      key: "Enter",
      ctrlKey: true,
    });
    await waitFor(() => expect(ctx.respondApproval).toHaveBeenCalledWith("apr_1", "approve", {}));
  });

  it("denies with Escape", async () => {
    const ctx = ctxWith();
    render(<ItemView item={purchase} ctx={ctx} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Not now/ }), { key: "Escape" });
    await waitFor(() => expect(ctx.respondApproval).toHaveBeenCalledWith("apr_1", "deny"));
  });

  it("won't approve a purchase until the wallet is connected", async () => {
    const ctx = ctxWith({ state: makeShopState() });
    render(<ItemView item={purchase} ctx={ctx} />);
    const approve = screen.getByRole("button", { name: /Buy for/ });
    expect(approve).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(approve);
    expect(ctx.respondApproval).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Connect PayPal/ })).toBeInTheDocument();
  });

  it("sends tightened auto-buy limits as edits", async () => {
    const ctx = ctxWith();
    const rule = {
      maxUnitPrice: usd(27999),
      maxTotal: usd(29999),
      quantity: 1,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    render(
      <ItemView
        item={approval({ kind: "autoBuyRule", title: "Auto-buy rule", details: { offer, rule } })}
        ctx={ctx}
      />,
    );
    const input = screen.getByLabelText(/Buy at or below/);
    fireEvent.change(input, { target: { value: "259.50" } });
    fireEvent.click(screen.getByRole("button", { name: /Turn on auto-buy/ }));
    await waitFor(() =>
      expect(ctx.respondApproval).toHaveBeenCalledWith("apr_1", "approve", {
        edits: { maxUnitPrice: usd(25950) },
      }),
    );
  });

  it("blocks approve on an invalid limit", () => {
    const ctx = ctxWith();
    const rule = {
      maxUnitPrice: usd(27999),
      maxTotal: usd(29999),
      quantity: 1,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    render(
      <ItemView
        item={approval({ kind: "autoBuyRule", title: "Auto-buy rule", details: { offer, rule } })}
        ctx={ctx}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Never spend more/), { target: { value: "12.345" } });
    expect(screen.getByRole("button", { name: /Turn on auto-buy/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("runs the passkey step-up and forwards the assertion", async () => {
    const stepUp = vi.fn(async () => ({ id: "cred" }));
    const ctx = ctxWith({ stepUp });
    render(<ItemView item={{ ...purchase, stepUp: true }} ctx={ctx} />);
    expect(screen.getByText(/passkey/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Buy for/ }));
    await waitFor(() =>
      expect(ctx.respondApproval).toHaveBeenCalledWith("apr_1", "approve", {
        assertion: { id: "cred" },
      }),
    );
    expect(stepUp).toHaveBeenCalledOnce();
  });

  it("renders a decided approval as resolved", () => {
    render(
      <ItemView
        item={{ ...purchase, status: "completed", decision: "approved" }}
        ctx={ctxWith()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Buy for/ })).toBeNull();
  });
});
