import type { PactApi, Wallet } from "@/lib/api";
import type { MockServer } from "./server";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stubs the worker's REST endpoints on top of the mock server's state. */
export function createMockApi(server: MockServer): PactApi {
  const orders = new Map<string, { threadId: string; pactId: string }>();
  return {
    async wallet(): Promise<Wallet> {
      await delay(120);
      return {
        funding: { label: "PayPal · alex@pact.test", linked: true },
        mandates: server.mandates,
        activity: server.activity,
      };
    },
    async revokeMandate(id) {
      await delay(200);
      server.mandates = server.mandates.map((m) =>
        m.mandate.id === id ? { ...m, mandate: { ...m.mandate, status: "revoked" } } : m,
      );
    },
    async paypalClientToken() {
      return "mock-client-token";
    },
    async paypalSetupToken() {
      await delay(300);
      return { vaultSetupToken: `SETUP-${Math.random().toString(36).slice(2, 10).toUpperCase()}` };
    },
    async paypalPaymentToken({ threadId, pactId }) {
      await delay(400);
      void server.commit(threadId, pactId);
      return { mandateId: "mandate_alexps6" };
    },
    async paypalCreateOrder({ threadId, pactId }) {
      await delay(300);
      const orderId = `ORDER-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      orders.set(orderId, { threadId, pactId });
      return { orderId };
    },
    async paypalCaptureOrder(orderId) {
      await delay(300);
      const o = orders.get(orderId);
      if (o) void server.commit(o.threadId, o.pactId);
      return { status: "COMPLETED" };
    },
  };
}
