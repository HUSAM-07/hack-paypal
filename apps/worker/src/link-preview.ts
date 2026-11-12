/**
 * Link previews (Open Graph and Twitter card tags) for the server-rendered pages, so a link pasted
 * into Devpost, Slack or a chat shows a title, a line and the result chart instead of a bare URL.
 * Pages that already carry their own `og:title` (the landing page, /proof, /try, /studio) are left
 * alone; for the rest the tags are added just before `</head>`.
 */
const ORIGIN = "https://pact-worker.vincent-wesley-liem.workers.dev";
const IMAGE = `${ORIGIN}/og/cited-proof-v1.png`;
const IMAGE_ALT =
  "Bar chart: 100% of AI agents shown a creator's test bought the Winix, against 6% shown a placebo and 8% shown nothing.";

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

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function previewFor(pathname: string): Preview | undefined {
  return PREVIEWS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1];
}

export function previewTags(pathname: string, p: Preview): string {
  const t = esc(p.title);
  const d = esc(p.description);
  return [
    `<meta name="description" content="${d}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="CITED">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${ORIGIN}${esc(pathname)}">`,
    `<meta property="og:image" content="${IMAGE}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(IMAGE_ALT)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${IMAGE}">`,
  ].join("");
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
