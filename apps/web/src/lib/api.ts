import type { Money } from "@pact/protocol";
import { z } from "zod";
import { ActivityEntry, MandateData } from "@/genui/refs";
import { env } from "./env";

/**
 * REST endpoints the web app expects from the worker. Everything money-related is
 * keyed by server ids; the client never sends an amount it computed itself except
 * the member's chosen cap, which the server re-validates against policy.
 */
export const Wallet = z.object({
  funding: z.object({ label: z.string(), linked: z.boolean() }),
  mandates: z.array(MandateData),
  activity: z.array(ActivityEntry),
});
export type Wallet = z.infer<typeof Wallet>;

export interface PactApi {
  /** GET /api/wallet */
  wallet(): Promise<Wallet>;
  /** POST /api/mandates/:id/revoke */
  revokeMandate(mandateId: string): Promise<void>;
  /** GET /api/paypal/client-token → short-lived v6 SDK client token (never the secret). */
  paypalClientToken(): Promise<string>;
  /** POST /api/paypal/setup-token → Vault v3 setup token for the save-payment session. */
  paypalSetupToken(body: {
    threadId: string;
    pactId: string;
    cap: Money;
  }): Promise<{ vaultSetupToken: string }>;
  /** POST /api/paypal/payment-token → exchanges an approved setup token; server stores the vault id and issues a mandate. */
  paypalPaymentToken(body: {
    threadId: string;
    pactId: string;
    vaultSetupToken: string;
  }): Promise<{ mandateId: string }>;
  /** POST /api/paypal/orders → one-time order for the member's share (server computes the amount). */
  paypalCreateOrder(body: { threadId: string; pactId: string }): Promise<{ orderId: string }>;
  /** POST /api/paypal/orders/:id/capture */
  paypalCaptureOrder(orderId: string): Promise<{ status: string }>;
}

class HttpApi implements PactApi {
  constructor(private base: string) {}

  private async call<T>(path: string, init: RequestInit = {}, schema?: z.ZodType<T>): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      credentials: "include",
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}`);
    const body = res.status === 204 ? undefined : await res.json();
    return schema ? schema.parse(body) : (body as T);
  }

  wallet() {
    return this.call("/api/wallet", {}, Wallet);
  }
  async revokeMandate(id: string) {
    await this.call(`/api/mandates/${encodeURIComponent(id)}/revoke`, { method: "POST" });
  }
  async paypalClientToken() {
    const r = await this.call(
      "/api/paypal/client-token",
      {},
      z.object({ clientToken: z.string() }),
    );
    return r.clientToken;
  }
  paypalSetupToken(body: { threadId: string; pactId: string; cap: Money }) {
    return this.call(
      "/api/paypal/setup-token",
      { method: "POST", body: JSON.stringify(body) },
      z.object({ vaultSetupToken: z.string() }),
    );
  }
  paypalPaymentToken(body: { threadId: string; pactId: string; vaultSetupToken: string }) {
    return this.call(
      "/api/paypal/payment-token",
      { method: "POST", body: JSON.stringify(body) },
      z.object({ mandateId: z.string() }),
    );
  }
  paypalCreateOrder(body: { threadId: string; pactId: string }) {
    return this.call(
      "/api/paypal/orders",
      { method: "POST", body: JSON.stringify(body) },
      z.object({ orderId: z.string() }),
    );
  }
  paypalCaptureOrder(orderId: string) {
    return this.call(
      `/api/paypal/orders/${encodeURIComponent(orderId)}/capture`,
      { method: "POST" },
      z.object({ status: z.string() }),
    );
  }
}

export function createHttpApi(): PactApi {
  return new HttpApi(env.apiUrl);
}
