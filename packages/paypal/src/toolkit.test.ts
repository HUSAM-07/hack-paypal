import { describe, expect, it } from "vitest";
import { createPayPal } from "./client";
import { PayPalError } from "./errors";
import { createMockPayPal } from "./mock/paypal-mock";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

function setup() {
  const mock = createMockPayPal({ now: () => Date.parse("2026-11-05T10:00:00Z") });
  const seen: { method: string; url: string; headers: Headers; body: string | undefined }[] = [];
  const paypal = createPayPal({
    clientId: "id",
    clientSecret: "secret",
    env: "sandbox",
    sleep: async () => {},
    fetch: async (input, init) => {
      const url = String(input);
      if (!url.endsWith("/v1/oauth2/token")) {
        seen.push({
          method: init?.method ?? "GET",
          url,
          headers: new Headers(init?.headers),
          body: typeof init?.body === "string" ? init.body : undefined,
        });
      }
      return mock.fetch(input, init);
    },
  });
  const order = (requestId: string) =>
    paypal.orders.create(
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "lumen",
            custom_id: "passport.v1.abc",
            amount: usd(9599),
            items: [
              { name: "Winix A230", quantity: 1, unit_amount: usd(9599), upc: "012345678905" },
            ],
          },
        ],
      },
      { requestId },
    );
  return { mock, paypal, seen, order };
}

describe("PayPal Agent Toolkit bridge", () => {
  it("pay_order captures through our transport with our auth and request id", async () => {
    const s = setup();
    const o = await s.order("toolkit-o1");
    s.mock.approveOrder(o.id);
    s.seen.length = 0;
    const done = await s.paypal.agentToolkit.payOrder(o.id, { requestId: "toolkit-cap-1" });
    expect(done.status).toBe("COMPLETED");
    expect(done.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id).toBe("passport.v1.abc");
    const call = s.seen[0];
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${o.id}/capture`);
    expect(call?.headers.get("paypal-request-id")).toBe("toolkit-cap-1");
    expect(call?.headers.get("authorization")).toMatch(/^Bearer /);
    expect(call?.headers.get("user-agent") ?? "").toContain("PayPal Agent Toolkit");
  });

  it("get_order and create_refund (idempotent on replay)", async () => {
    const s = setup();
    const o = await s.order("toolkit-o2");
    s.mock.approveOrder(o.id);
    const cap = await s.paypal.agentToolkit.payOrder(o.id, { requestId: "toolkit-cap-2" });
    const got = await s.paypal.agentToolkit.getOrder(o.id);
    expect(got.purchase_units?.[0]?.custom_id).toBe("passport.v1.abc");
    const captureId = cap.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? "";
    const r1 = await s.paypal.agentToolkit.createRefund(
      captureId,
      { amount: usd(1000) },
      { requestId: "toolkit-rf-1" },
    );
    const r2 = await s.paypal.agentToolkit.createRefund(
      captureId,
      { amount: usd(1000) },
      { requestId: "toolkit-rf-1" },
    );
    expect(r2.id).toBe(r1.id);
    expect(s.mock.state.refunds.size).toBe(1);
    expect(JSON.parse(s.seen.at(-1)?.body ?? "{}").amount).toEqual({
      currency_code: "USD",
      value: "10.00",
    });
  });

  it("keeps PayPal's error code when the toolkit call fails", async () => {
    const s = setup();
    const err = await s.paypal.agentToolkit.getOrder("5O190127TN364715T").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).status).toBe(404);
    expect((err as PayPalError).code).toBe("RESOURCE_NOT_FOUND");
    const o = await s.order("toolkit-o3");
    const unapproved = await s.paypal.agentToolkit
      .payOrder(o.id, { requestId: "toolkit-cap-3" })
      .catch((e) => e);
    expect((unapproved as PayPalError).status).toBe(422);
    expect((unapproved as PayPalError).issues).toContain("ORDER_NOT_APPROVED");
  });

  it("refuses a request id PayPal would reject", async () => {
    const s = setup();
    await expect(
      s.paypal.agentToolkit.payOrder("X", { requestId: "x".repeat(109) }),
    ).rejects.toThrow(/PayPal-Request-Id/);
  });
});
