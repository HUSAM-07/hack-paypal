import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { decodePassportBody } from "@pact/protocol";
import type { CheckoutResult, Endpoints, SearchResult } from "./types";

export interface SearchArgs {
  query: string;
  /** Shop the agent is browsing; recorded in the passport as a store viewed. */
  shopId?: string;
}

/**
 * One buyer session's hands: search over MCP, checkout over the shop's agent API.
 * It holds the passport the catalogue issued and attaches it at checkout, whichever shop
 * the agent picks, so the model never has to copy a signed token by hand.
 */
export class ShopperSession {
  passport: string | undefined;
  searches = 0;
  lastSearch: SearchResult | undefined;
  purchase: CheckoutResult | undefined;
  checkedOutWithPassport = false;
  private client: Client | undefined;

  constructor(
    private readonly ep: Endpoints,
    private readonly sessionRef: string,
    private readonly opts: { coExposed?: boolean } = {},
  ) {}

  private async mcp(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(new URL(`${this.ep.catalogueUrl}/mcp`), {
      ...(this.ep.catalogueFetch ? { fetch: this.ep.catalogueFetch } : {}),
    });
    const client = new Client({ name: "cited-shopper-agent", version: "0.0.0" });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  async search(args: SearchArgs): Promise<SearchResult> {
    const client = await this.mcp();
    const res = await client.callTool({
      name: "search_product",
      arguments: {
        query: args.query,
        ...(this.passport ? { passport: this.passport } : {}),
        ...(args.shopId ? { shopId: args.shopId } : {}),
        // Only the first search can start a co-exposed session; later ones carry the passport.
        ...(this.searches === 0 && this.opts.coExposed ? { coExposed: true } : {}),
      },
    });
    if (res.isError) throw new Error(`search_product failed: ${JSON.stringify(res.content)}`);
    const out = res.structuredContent as unknown as SearchResult | undefined;
    if (!out?.passport) throw new Error("search_product returned no passport");
    this.searches++;
    this.passport = out.passport;
    this.lastSearch = out;
    return out;
  }

  /** Create the order at the chosen shop with the passport in `custom_id`, then capture it. */
  async checkout(shopId: string, upc: string): Promise<CheckoutResult> {
    const f = this.ep.shopsFetch ?? fetch;
    const base = `${this.ep.shopsUrl}/${encodeURIComponent(shopId)}/api/orders`;
    const created = await f(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upc,
        clientRef: this.sessionRef,
        ...(this.passport ? { passport: this.passport } : {}),
      }),
    });
    const order = (await created.json()) as {
      orderId?: string;
      total?: CheckoutResult["total"];
      error?: { message: string };
    };
    if (!created.ok || !order.orderId || !order.total) {
      throw new Error(`checkout failed at ${shopId}: ${order.error?.message ?? created.status}`);
    }
    const captured = await f(`${base}/${order.orderId}/capture`, { method: "POST" });
    const cap = (await captured.json()) as {
      status?: string;
      captureId?: string | null;
      error?: { message: string };
    };
    if (!captured.ok) {
      throw new Error(`capture failed at ${shopId}: ${cap.error?.message ?? captured.status}`);
    }
    this.checkedOutWithPassport = this.passport !== undefined;
    this.purchase = {
      orderId: order.orderId,
      shopId,
      upc,
      total: order.total,
      captureId: cap.captureId ?? null,
      status: cap.status ?? "UNKNOWN",
    };
    return this.purchase;
  }

  /** Decoded for logging only; the engine verifies the signature, not the runner. */
  passportBody() {
    if (!this.passport) return null;
    try {
      return decodePassportBody(this.passport.slice(0, this.passport.lastIndexOf(".")));
    } catch {
      return null;
    }
  }

  async close() {
    await this.client?.close().catch(() => undefined);
  }
}
