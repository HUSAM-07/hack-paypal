import { createMockPayPal } from "@pact/paypal";
import { UPC_WINIX_A230 } from "@pact/protocol";
import { expect, it } from "vitest";
import { createShopsApp } from "../src/index";

it("simulated checkout approves, captures and refunds through the PayPal mock, emitting its webhooks", async () => {
  const mock = createMockPayPal();
  const seen: string[] = [];
  mock.registerWebhook((d) => {
    seen.push(d.event.event_type);
  });
  const app = createShopsApp({ mock, env: { PAYPAL_MODE: "simulated" } });
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: "POST",
      ...(body
        ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
        : {}),
    });

  const order = (await (await post("/lumen/api/orders", { upc: UPC_WINIX_A230 })).json()) as {
    orderId: string;
  };
  const cap = (await (await post(`/lumen/api/orders/${order.orderId}/capture`)).json()) as {
    captureId: string;
    status: string;
  };
  expect(cap.status).toBe("COMPLETED");
  expect(seen).toEqual(["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"]);

  const refund = await post(`/mock/captures/${cap.captureId}/refund`);
  expect(refund.status).toBe(200);
  expect(seen.at(-1)).toBe("PAYMENT.CAPTURE.REFUNDED");
  const state = (await (await app.request("/mock/state")).json()) as {
    captures: { refunded: number }[];
  };
  expect(state.captures[0]?.refunded).toBe(9599);
});

it("has no mock endpoints when PayPal is not simulated", async () => {
  const app = createShopsApp({
    env: { PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y" },
  });
  expect((await app.request("/mock/state")).status).toBe(404);
});
