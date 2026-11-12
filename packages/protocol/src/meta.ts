import { SITE_TOKENS } from "./theme";

/**
 * Page metadata shared by every CITED page: icons, the web manifest, browser theme colours,
 * description and share cards, plus the sitemap and robots.txt. Colours come from SITE_TOKENS,
 * so the icons and the browser chrome follow the theme.
 */

/** The canonical origin for share cards (both deploy targets serve the same pages). */
export const SITE_ORIGIN = "https://caaash.shipwith.si";

export const SITE_NAME = "CITED";
export const SITE_TAGLINE = "Affiliate marketing, rebuilt on PayPal for AI agents";
export const SITE_DESCRIPTION =
  "CITED pays creators on proven lift, not last-click cookies. AI shopping agents are randomly shown a creator's test, a placebo or nothing; PayPal Payouts credit only the sales the test caused.";

export const SITE_OG_IMAGE = {
  path: "/og/cited-proof-v2.png",
  width: 1200,
  height: 630,
  alt: "Bar chart: 100% of AI agents shown a creator's test bought the Winix, against 6% shown a placebo and 8% shown nothing.",
};

/**
 * The mark's geometry, in a 24×24 box: a disc with a "C" cut out, open to the right (the holdout
 * gap), and a dot cut out in its mouth (the credited sale). The top bar draws it with
 * currentColor (SITE_MARK_SVG); the icons draw it with the tokens.
 */
export const SITE_MARK = {
  disc: { cx: 12, cy: 12, r: 11 },
  arc: "M15.47 16.14A5.4 5.4 0 1 1 15.47 7.86",
  arcWidth: 2.8,
  dot: { cx: 17.4, cy: 12, r: 1.9 },
} as const;

export const markCutouts = (stroke: string) => {
  const { arc, arcWidth, dot } = SITE_MARK;
  return `<path d="${arc}" fill="none" stroke="${stroke}" stroke-width="${arcWidth}" stroke-linecap="round"/><circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="${stroke}"/>`;
};

/**
 * favicon.svg: the mark in the primary colour with real (transparent) cut-outs, switching to the
 * dark theme's primary when the browser chrome is dark.
 */
export function faviconSvg(): string {
  const { disc } = SITE_MARK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${SITE_NAME}</title><style>.m{fill:${SITE_TOKENS.light.primary}}@media (prefers-color-scheme:dark){.m{fill:${SITE_TOKENS.dark.primary}}}</style><mask id="c"><rect width="24" height="24" fill="white"/>${markCutouts("black")}</mask><circle class="m" cx="${disc.cx}" cy="${disc.cy}" r="${disc.r}" mask="url(#c)"/></svg>\n`;
}

/**
 * The app icon (apple-touch, manifest): the dark theme's primary mark on its background, with
 * `inset` of padding as a fraction of the side (maskable icons need a safe zone).
 */
export function appIconSvg(size: number, inset = 0.18, rounded = true): string {
  const { background, primary } = SITE_TOKENS.dark;
  const pad = size * inset;
  const scale = (size - 2 * pad) / 24;
  const rx = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${rx}" fill="${background}"/><g transform="translate(${pad} ${pad}) scale(${scale})"><circle cx="${SITE_MARK.disc.cx}" cy="${SITE_MARK.disc.cy}" r="${SITE_MARK.disc.r}" fill="${primary}"/>${markCutouts(background)}</g></svg>`;
}

/** The PNG icons generated from appIconSvg (apps/web/scripts/gen-icons.ts). */
export const SITE_ICONS = [
  { file: "apple-touch-icon.png", size: 180, purpose: "apple" },
  { file: "icon-192.png", size: 192, purpose: "any" },
  { file: "icon-512.png", size: 512, purpose: "any" },
  { file: "icon-maskable-512.png", size: 512, purpose: "maskable" },
] as const;

export function webManifest(): string {
  return `${JSON.stringify(
    {
      name: `${SITE_NAME}: ${SITE_TAGLINE}`,
      short_name: SITE_NAME,
      description: SITE_DESCRIPTION,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: SITE_TOKENS.dark.background,
      theme_color: SITE_TOKENS.dark.background,
      icons: [
        { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
        ...SITE_ICONS.filter((i) => i.purpose !== "apple").map((i) => ({
          src: `/icons/${i.file}`,
          sizes: `${i.size}x${i.size}`,
          type: "image/png",
          purpose: i.purpose,
        })),
      ],
    },
    null,
    2,
  )}\n`;
}

/** Icons, manifest and the browser's theme colours (they follow the visitor's OS theme). */
export const SITE_ICONS_HTML = [
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
  '<link rel="manifest" href="/site.webmanifest">',
  `<meta name="theme-color" content="${SITE_TOKENS.light.background}" media="(prefers-color-scheme: light)">`,
  `<meta name="theme-color" content="${SITE_TOKENS.dark.background}" media="(prefers-color-scheme: dark)">`,
  '<meta name="color-scheme" content="light dark">',
].join("");

const attr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Description, canonical URL and share cards for one page. `path` is the page's public path;
 * `noindex` keeps search engines off pages that are not meant to be found (404, apps).
 */
export function siteMeta({
  title,
  description = SITE_DESCRIPTION,
  path,
  noindex = false,
}: {
  title: string;
  description?: string;
  path: string;
  noindex?: boolean;
}): string {
  const url = `${SITE_ORIGIN}${path}`;
  const image = `${SITE_ORIGIN}${SITE_OG_IMAGE.path}`;
  const t = attr(title);
  const d = attr(description);
  return [
    `<meta name="description" content="${d}">`,
    noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="${SITE_OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${SITE_OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${attr(SITE_OG_IMAGE.alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<meta name="twitter:image:alt" content="${attr(SITE_OG_IMAGE.alt)}">`,
  ].join("");
}

/** The public pages listed in the sitemap (apps, Studio and error pages stay out). */
export const SITE_PAGES: readonly { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/proof", priority: 0.9 },
  { path: "/try", priority: 0.8 },
  { path: "/console", priority: 0.8 },
  { path: "/console/payout", priority: 0.7 },
  { path: "/console/ledger", priority: 0.6 },
  { path: "/mcp", priority: 0.7 },
  { path: "/creators", priority: 0.7 },
];

export function sitemapXml(origin: string): string {
  const urls = SITE_PAGES.map(
    (p) =>
      `  <url><loc>${origin}${p.path}</loc><priority>${p.priority.toFixed(1)}</priority></url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\nDisallow: /studio\n\nSitemap: ${origin}/sitemap.xml\n`;
}
