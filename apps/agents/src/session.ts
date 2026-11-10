import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { decodePassportBody } from "@pact/protocol";
import type { CheckoutResult, Endpoints, SearchResult } from "./types";

export interface SearchArgs {
  query: string;
  /** Seller whose offer the agent is looking at; recorded in the passport as a store viewed. */
  sellerId?: string;
}

/**
 * One buyer session's hands, both over the catalogue's MCP: `search_product`, then `checkout`,
 * where the agent platform pays the seller from the PayPal wallet the buyer linked to the agent.
 * It holds the passport the catalogue issued and attaches it at checkout, whichever seller the
 * agent picks, so the model never has to copy a signed token by hand.
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
    private readonly opts: {
      coExposed?: boolean;
      /** Demo only: the catalogue honours it in simulated mode so a seeded run picks its arms. */
      sessionId?: string;
      /** Called after every search, once the passport (and so the arm) is known. */
      onPassport?: () => Promise<void>;
    } = {},
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
        ...(args.sellerId ? { sellerId: args.sellerId } : {}),
        // Only the first search can start a co-exposed session; later ones carry the passport.
        ...(this.searches === 0 && this.opts.coExposed ? { coExposed: true } : {}),
        ...(this.searches === 0 && this.opts.sessionId ? { sessionId: this.opts.sessionId } : {}),
      },
    });
    if (res.isError) throw new Error(`search_product failed: ${JSON.stringify(res.content)}`);
    const out = res.structuredContent as unknown as SearchResult | undefined;
    if (!out?.passport) throw new Error("search_product returned no passport");
    this.searches++;
    this.passport = out.passport;
    this.lastSearch = out;
    await this.opts.onPassport?.();
    return out;
  }

  /** Buy an offer: a PayPal order paying its seller, the passport in `custom_id`, captured at once. */
  async checkout(offerId: string): Promise<CheckoutResult> {
    const client = await this.mcp();
    const res = await client.callTool({
      name: "checkout",
      arguments: {
        offerId,
        clientRef: this.sessionRef,
        ...(this.passport ? { passport: this.passport } : {}),
      },
    });
    const out = res.structuredContent as unknown as CheckoutResult | undefined;
    if (res.isError || !out?.orderId) {
      const text = (res.content as { text?: string }[] | undefined)?.[0]?.text;
      throw new Error(`checkout failed for ${offerId}: ${text ?? "no order"}`);
    }
    if (out.status !== "COMPLETED" || !out.captureId) {
      throw new Error(`checkout for ${offerId} ended ${out.status}, not captured`);
    }
    this.checkedOutWithPassport = this.passport !== undefined;
    this.purchase = out;
    return out;
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
