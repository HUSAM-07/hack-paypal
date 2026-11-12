/**
 * Live price reads, cheapest first: plain fetch + JSON-LD → Exa live contents → Browser Run
 * `/json`. PayPal sellers skip all that: their catalogue quote is authoritative.
 * Every tier's failure falls through to the next; only "nothing could read it" is an error.
 */

import { BrowserRunPrice, priceJsonRequest } from "./browser-run";
import type { Offer, PriceCheck } from "./contract";
import type { CommerceDeps } from "./deps";
import { ShopError } from "./deps";
import { contentsResult, livePriceContentsRequest } from "./exa";
import { offerFromHtml, type PageOffer } from "./jsonld";
import { findPriceInText, parsePrice } from "./money";
import { assertPublicHttpUrl, shortHash } from "./url";

const MAX_HTML_BYTES = 2_000_000;

export interface CheckPriceOptions {
  offerId?: string | undefined;
  /** Currency to assume when the page names none (the watched offer's). */
  currencyHint?: string | undefined;
  /** Skip the KV cache (re-verify before money moves always does). */
  fresh?: boolean;
}

type Method = PriceCheck["method"];

function toCheck(
  url: string,
  read: PageOffer,
  method: Method,
  checkedAt: string,
  offerId?: string,
): PriceCheck {
  const check: PriceCheck = { url, price: read.price, method, checkedAt };
  if (offerId) check.offerId = offerId;
  if (read.shipping) check.shipping = read.shipping;
  if (read.inStock !== undefined) check.inStock = read.inStock;
  if (read.variant) check.variant = read.variant.slice(0, 200);
  return check;
}

async function readText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.byteLength, size - at)), at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export async function readJsonLd(deps: Pick<CommerceDeps, "fetch">, url: string) {
  const res = await deps.fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "CITED-Shop/1.0 (price check)",
    },
    redirect: "follow",
  });
  if (!res.ok) return undefined;
  const type = res.headers.get("content-type") ?? "";
  if (type && !/html|xml/i.test(type)) return undefined;
  return offerFromHtml(await readText(res));
}

export async function readExaLive(
  deps: Pick<CommerceDeps, "exa">,
  url: string,
  currencyHint?: string,
): Promise<PageOffer | undefined> {
  const res = await deps.exa.contents(livePriceContentsRequest(url));
  const r = contentsResult(res, url);
  const price = r?.text ? findPriceInText(r.text, currencyHint) : undefined;
  return price ? { price } : undefined;
}

export async function readBrowserRun(
  deps: Pick<CommerceDeps, "browserRun">,
  url: string,
): Promise<PageOffer | undefined> {
  if (!deps.browserRun) return undefined;
  const parsed = BrowserRunPrice.safeParse(await deps.browserRun.json(priceJsonRequest(url)));
  if (!parsed.success) return undefined;
  const price = parsePrice(parsed.data.price, parsed.data.currency.toUpperCase());
  if (!price) return undefined;
  const out: PageOffer = { price };
  if (parsed.data.inStock !== undefined) out.inStock = parsed.data.inStock;
  if (parsed.data.variant) out.variant = parsed.data.variant;
  return out;
}

/** Live price of any public product page. */
export async function checkPrice(
  deps: CommerceDeps,
  url: string,
  opts: CheckPriceOptions = {},
): Promise<PriceCheck> {
  assertPublicHttpUrl(url);
  const cacheKey = `shop:price:${shortHash(url)}`;
  if (deps.kv && !opts.fresh) {
    const hit = await deps.kv.get(cacheKey);
    if (hit) {
      const cached = JSON.parse(hit) as PriceCheck;
      return opts.offerId ? { ...cached, offerId: opts.offerId } : cached;
    }
  }
  const checkedAt = deps.clock.now().toISOString();
  const tiers: [Method, () => Promise<PageOffer | undefined>][] = [
    ["jsonLd", () => readJsonLd(deps, url)],
    ["exaContents", () => readExaLive(deps, url, opts.currencyHint)],
    ["browserRun", () => readBrowserRun(deps, url)],
  ];
  for (const [method, read] of tiers) {
    let got: PageOffer | undefined;
    try {
      got = await read();
    } catch {
      got = undefined; // A failing tier is just a miss; the next one tries.
    }
    if (got && got.price.amountMinor > 0) {
      const check = toCheck(url, got, method, checkedAt, opts.offerId);
      if (deps.kv) {
        await deps.kv.put(cacheKey, JSON.stringify(check), {
          ttlSeconds: deps.config.priceCacheSeconds ?? 120,
        });
      }
      return check;
    }
  }
  throw new ShopError("price_unavailable", "Couldn't read a price from that page right now.");
}

/**
 * Live price of an offer. PayPal sellers answer from their catalogue (price = unit price,
 * plus shipping/stock/variant); web offers go through `checkPrice`.
 */
export async function checkOfferPrice(
  deps: CommerceDeps,
  offer: Offer,
  opts: { fresh?: boolean } = {},
): Promise<PriceCheck> {
  if (offer.source === "paypalSeller") {
    const at = deps.clock.now();
    const q = await deps.sellers.quote(offer.id, 1, at);
    if (!q) throw new ShopError("not_found", "That seller no longer lists this product.");
    const check: PriceCheck = {
      offerId: offer.id,
      url: offer.url,
      price: q.unit,
      shipping: q.shipping,
      inStock: q.inStock,
      method: "paypalCatalogue",
      checkedAt: at.toISOString(),
    };
    if (q.variant) check.variant = q.variant;
    return check;
  }
  return checkPrice(deps, offer.url, {
    offerId: offer.id,
    currencyHint: offer.price.currency,
    ...(opts.fresh ? { fresh: true } : {}),
  });
}
