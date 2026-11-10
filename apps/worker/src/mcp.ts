import { siteNavLinks } from "@pact/protocol";
import type { Context } from "hono";
import type { Env } from "./env";
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

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** A small human page: the URL and the config to paste into each client. */
export function howToPage(origin: string): Response {
  const url = `${origin}${PUBLIC_MCP_PATH}`;
  const desktop = JSON.stringify(
    { mcpServers: { cited: { command: "npx", args: ["-y", "mcp-remote", url] } } },
    null,
    2,
  );
  const cursor = JSON.stringify({ mcpServers: { cited: { url } } }, null, 2);
  const u = esc(url);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CITED catalogue MCP server</title>
<style>
@font-face{font-family:"Newsreader";font-style:normal;font-weight:200 800;font-display:swap;src:url("/fonts/newsreader-latin-opsz-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-latin-v1.woff2") format("woff2-variations")}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-mono-latin-v1.woff2") format("woff2-variations")}
:root{--bg:#FAF8F4;--ink:#16181D;--muted:#5B5F68;--line:#E6E2DA;--sans:"Geist",ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
main{max-width:720px;margin:0 auto;padding:40px 24px 64px}
.nav{display:flex;align-items:baseline;gap:2rem;max-width:1180px;margin:0 auto;padding:22px 48px 0;font-size:.8rem}
.nav .mark{font-family:"Newsreader",Georgia,serif;font-size:1.15rem;font-weight:600;letter-spacing:.06em;text-decoration:none;margin-right:auto;color:var(--ink)}
.nav a{color:var(--muted);text-decoration:none;padding:.3rem 0;white-space:nowrap}
.nav a:hover{color:var(--ink)}
.nav a[aria-current]{color:var(--ink);box-shadow:inset 0 -1.5px 0 var(--ink)}
@media (max-width:760px){.nav{padding:18px 20px 0;gap:.2rem .9rem;font-size:.72rem;flex-wrap:wrap}.nav .mark{flex-basis:100%}}
h1{font-size:1.6rem;margin:0 0 .5rem}
h2{font-size:1.05rem;margin:2rem 0 .4rem}
p,li{color:var(--muted)}
code,pre{font-family:var(--mono);font-size:.9rem}
pre{background:#fff;border:1px solid var(--line);border-radius:6px;padding:12px 14px;overflow-x:auto;color:var(--ink)}
.url{font-size:1.05rem;color:var(--ink)}
a{color:inherit}
</style></head><body>
<nav class="nav" aria-label="CITED"><a class="mark" href="/">CITED</a>${siteNavLinks("mcp")}</nav>
<main>
<h1>Shop through CITED from your own agent</h1>
<p>A remote MCP server (Streamable HTTP) with two tools: <code>search_product</code> and <code>checkout</code>. Your agent searches offers synced to PayPal and buys one; the order pays the seller through PayPal with a signed passport in <code>custom_id</code>, and the creator is credited only if the test your agent was shown caused the sale. Simulated PayPal: no real money moves. No sign-in.</p>
<p class="url"><code>${u}</code></p>

<h2>Claude Code</h2>
<pre>claude mcp add --transport http cited ${u}</pre>

<h2>Claude Desktop</h2>
<p>Settings → Connectors → Add custom connector, and paste the URL. Or add this to <code>claude_desktop_config.json</code>:</p>
<pre>${esc(desktop)}</pre>

<h2>Cursor</h2>
<p>Add to <code>~/.cursor/mcp.json</code>:</p>
<pre>${esc(cursor)}</pre>

<h2>ChatGPT</h2>
<p>Settings → Connectors → Advanced → Developer mode, then create a connector with the URL above and no authentication.</p>

<h2>Then</h2>
<p>Ask your agent to find and buy an air purifier. Each MCP session is one shopping session with its own passport. Your purchase appears in the engine at <a href="/api/cited/api/journeys?source=mcp"><code>/api/cited/api/journeys?source=mcp</code></a> with a verdict saying whether its arm makes it creditable. These sales are kept apart from the recorded demo numbers on <a href="/console">/console</a>. Limits: 60 requests a minute per IP, three orders per session.</p>
</main></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Content-Security-Policy": PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-cache",
    },
  });
}
