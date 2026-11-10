/**
 * Stand-in for `@paypal/agent-toolkit/mcp` in the workers test pool only (see vitest.config.ts).
 *
 * In the pool, an isolate that sends a request with axios (which the toolkit uses) makes the
 * pool's next isolate fail to start, so the pool runs this double: the same `PayPalAPI.run`
 * contract and the same requests as toolkit 1.11.0's `get_order`, `pay_order` and
 * `create_refund` (URL from the client's `getBaseUrl()`, headers from `getHeaders()`), sent with
 * the global fetch, which is the path axios takes under workerd. Our bridge, the mock and the
 * worker routes stay real. The real toolkit runs in the Node tests (`packages/paypal`,
 * `apps/catalogue-mcp`) and in workerd under `wrangler dev` (`scripts/toolkit-smoke.ts`).
 */
/** The two axios calls the toolkit makes, over fetch. */
const axios = {
  async get(url: string, o: { headers: Record<string, string> }) {
    const r = await fetch(url, { headers: o.headers });
    return { data: await r.json() };
  },
  async post(url: string, body: unknown, o: { headers: Record<string, string> }) {
    const r = await fetch(url, { method: "POST", headers: o.headers, body: JSON.stringify(body) });
    return { data: await r.json() };
  },
};

interface Client {
  getBaseUrl(): string;
  getHeaders(): Promise<Record<string, string>>;
}

export class PayPalAPI {
  constructor(private readonly client: Client) {}

  async run(method: string, arg: Record<string, unknown>): Promise<string> {
    const base = this.client.getBaseUrl();
    const headers = await this.client.getHeaders();
    try {
      if (method === "get_order") {
        return JSON.stringify(
          (await axios.get(`${base}/v2/checkout/orders/${arg.id}`, { headers })).data,
        );
      }
      if (method === "pay_order") {
        const res = await axios.post(
          `${base}/v2/checkout/orders/${arg.id}/capture`,
          {},
          { headers },
        );
        return JSON.stringify({ status: "success", response: res.data });
      }
      if (method === "create_refund") {
        const url = `${base}/v2/payments/captures/${arg.capture_id}/refund`;
        return JSON.stringify((await axios.post(url, arg, { headers })).data);
      }
      throw new Error(`Invalid method: ${method}`);
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      return JSON.stringify({
        ok: false,
        status,
        code: "PAYPAL_API_HTTP_ERROR",
        message: String(e),
      });
    }
  }
}
