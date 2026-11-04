import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Catalogue } from "./catalogue";

/** A fresh server per request (stateless transport); the catalogue holds the shared state. */
export function createMcpServer(catalogue: Catalogue): McpServer {
  const server = new McpServer({ name: "cited-catalogue", version: "0.0.0" });

  server.registerTool(
    "search_product",
    {
      title: "Search products",
      description:
        "Search air purifier listings across Northwind, Lumen and MegaMart. Returns shop id, UPC and price per listing, plus any independent creator test content. Pass the passport from a previous call to continue the same session, and keep the returned passport for checkout.",
      inputSchema: {
        query: z.string().min(1).max(200),
        passport: z.string().max(127).optional(),
        shopId: z.string().max(24).optional(),
        coExposed: z.boolean().optional(),
        sessionId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,24}$/)
          .optional(),
      },
    },
    async (args) => {
      const result = await catalogue.search(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}
