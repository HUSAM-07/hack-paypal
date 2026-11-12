/**
 * Link previews (Open Graph and Twitter card tags) for the server-rendered pages, so a link pasted
 * into Devpost, Slack or a chat shows a title, a line and the result chart instead of a bare URL.
 * Pages that already carry their own `og:title` (the landing page, /proof, /try, /studio) are left
 * alone; for the rest the tags (siteMeta, from @pact/protocol) are added just before `</head>`.
 */
import { siteMeta } from "@pact/protocol";

interface Preview {
  title: string;
  description: string;
}

/** Longest matching prefix wins. */
const PREVIEWS: [string, Preview][] = [
  [
    "/console/payout",
    {
      title: "CITED: the day-30 payout",
      description:
        "HouseFresh is paid $383.96 by PayPal Payouts for the 51 Winix sales its test caused; Levoit pays $0 and gets its deposit back.",
    },
  ],
  [
    "/console/ledger",
    {
      title: "CITED: does the ledger match PayPal?",
      description:
        "Live checks that every sale is recorded, every payout matches PayPal to the cent, and every deposit is accounted for. PayPal is simulated on the hosted demo.",
    },
  ],
  [
    "/console/statement",
    {
      title: "CITED: the brand's PayPal statement",
      description:
        "Winix's PayPal invoice for the cycle: $383.96 for caused sales, settled against its deposit, $0 due.",
    },
  ],
  [
    "/console",
    {
      title: "CITED: two AI agents, one request",
      description:
        "Same offers, same prices, same ranking. One agent is shown a creator's test, one is held out, and only the test's effect is paid.",
    },
  ],
  [
    "/creators",
    {
      title: "CITED for creators",
      description:
        "Connect PayPal, publish a product test, and get paid by PayPal Payouts for the sales AI shopping agents make because of it.",
    },
  ],
  [
    "/mcp",
    {
      title: "CITED catalogue MCP server",
      description:
        "Point Claude, Cursor or any MCP client at CITED's catalogue and buy an air purifier through PayPal; the creator is credited only if the test caused it.",
    },
  ],
];

export function previewFor(pathname: string): Preview | undefined {
  return PREVIEWS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1];
}

export function previewTags(pathname: string, p: Preview): string {
  return siteMeta({ title: p.title, description: p.description, path: pathname });
}

/** Adds the tags to an HTML page that has none; anything else is returned unchanged. */
export async function withLinkPreview(pathname: string, res: Response): Promise<Response> {
  const preview = previewFor(pathname);
  if (!preview || res.status !== 200) return res;
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const html = await res.text();
  const at = html.indexOf("</head>");
  if (at < 0 || html.includes('property="og:title"')) return new Response(html, res);
  const out = html.slice(0, at) + previewTags(pathname, preview) + html.slice(at);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(out, { status: res.status, statusText: res.statusText, headers });
}
