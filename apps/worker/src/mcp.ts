import type { Context } from "hono";
import type { Env } from "./env";
import { MCP_PAGE_CSP, mcpPage } from "./mcp-page";
import { clientIp } from "./security";

/**
 * GET/POST/DELETE /mcp: the CITED catalogue as a public remote MCP server (Streamable HTTP), so
 * any MCP client can shop through it. Requests are rate-limited per IP here, then handed to the
 * demo Durable Object, where the catalogue and its simulated PayPal live
 * (`publicMcp` in apps/catalogue-mcp/src/public.ts). A browser GET gets a short how-to page.
 */
export const PUBLIC_MCP_PATH = "/mcp";

type Ctx = Context<{ Bindings: Env }>;

/** No cookies or credentials are involved, so any origin may call it (browser-based clients). */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
  "Access-Control-Max-Age": "600",
};

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Cache-Control", "no-store");
  return out;
}

function rpcError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
    { status, headers: { "content-type": "application/json" } },
  );
}

export async function publicMcpHandler(c: Ctx): Promise<Response> {
  const req = c.req.raw;
  if (req.method === "OPTIONS") return withHeaders(new Response(null, { status: 204 }), CORS);
  if (req.method === "GET") {
    // MCP clients GET with `Accept: text/event-stream` for a server stream; we only answer POST.
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("text/event-stream") && !accept.includes("text/html")) {
      return withHeaders(rpcError(405, "Method not allowed: POST JSON-RPC to this URL"), {
        ...CORS,
        Allow: "POST, DELETE",
      });
    }
    return howToPage(new URL(req.url).origin);
  }
  if (req.method !== "POST" && req.method !== "DELETE") {
    return withHeaders(rpcError(405, "Method not allowed"), { ...CORS, Allow: "POST, DELETE" });
  }
  const { success } = await c.env.IP_LIMITER.limit({ key: `mcp:${clientIp(req)}` });
  if (!success) return withHeaders(rpcError(429, "Rate limited; slow down"), CORS);
  const ns = c.env.CITED_DEMO;
  const res = await ns.get(ns.idFromName("demo")).fetch(req);
  return withHeaders(res, CORS);
}

/** A human page: how to connect an agent, and a live feed of the sales public MCP agents made. */
export function howToPage(origin: string): Response {
  return new Response(mcpPage(origin), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Content-Security-Policy": MCP_PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-cache",
    },
  });
}
