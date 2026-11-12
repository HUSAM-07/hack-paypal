import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Catalogue } from "./catalogue";
import { type CheckoutDeps, CheckoutError, checkout, orderStatus } from "./checkout";

const json = (out: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(out) }],
  structuredContent: out as Record<string, unknown>,
});

/** A fresh server per request (stateless transport); the catalogue holds the shared state. */
export function createMcpServer(catalogue: Catalogue, deps?: Omit<CheckoutDeps, "catalogue">) {
  const server = new McpServer({ name: "cited-catalogue", version: "0.0.0" });

  server.registerTool(
    "search_product",
    {
      title: "Search products",
      description:
        "Search air purifier, robot vacuum or noise-cancelling headphone offers from merchants synced to PayPal (Northwind, Lumen, MegaMart). Each offer has an offerId, the product (UPC, brand, name, specs), the seller and the price, plus any independent creator test content. Pass the passport from a previous call to continue the same session; checkout attaches it.",
      inputSchema: {
        query: z.string().min(1).max(200),
        passport: z.string().max(127).optional(),
        sellerId: z.string().max(24).optional(),
        coExposed: z.boolean().optional(),
        sessionId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,24}$/)
          .optional(),
      },
    },
    async (args) => json(await catalogue.search(args)),
  );

  if (deps) {
    server.registerTool(
      "checkout",
      {
        title: "Buy an offer with the buyer's PayPal",
        description:
          "Buy one offer. The platform creates a PayPal order paying the seller directly, charges the PayPal wallet the buyer linked to this agent, and returns the order and capture, read back with the PayPal Agent Toolkit. No website, no redirect.",
        inputSchema: {
          offerId: z.string().min(1).max(64),
          passport: z.string().max(127).optional(),
          quantity: z.number().int().min(1).max(10).optional(),
          clientRef: z.string().max(64).optional(),
        },
      },
      async (args) => {
        try {
          return json(await checkout({ catalogue, ...deps }, args));
        } catch (e) {
          if (!(e instanceof CheckoutError)) throw e;
          return {
            isError: true,
            content: [{ type: "text" as const, text: `${e.code}: ${e.message}` }],
          };
        }
      },
    );
    server.registerTool(
      "get_order",
      {
        title: "Order status (PayPal Agent Toolkit)",
        description:
          "Read an order from PayPal with the PayPal Agent Toolkit's get_order tool: status, seller, capture and the passport in custom_id.",
        inputSchema: { orderId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) },
        annotations: { readOnlyHint: true },
      },
      async ({ orderId }) => {
        try {
          return json(await orderStatus(deps.paypal, orderId));
        } catch (e) {
          if (!(e instanceof CheckoutError)) throw e;
          return {
            isError: true,
            content: [{ type: "text" as const, text: `${e.code}: ${e.message}` }],
          };
        }
      },
    );
  }

  return server;
}
