/**
 * schema.org Product/Offer from a page's JSON-LD (and the OpenGraph `product:price` metas as a
 * last cheap resort). The page is untrusted: we read typed fields only, never text to act on.
 */
import type { Money } from "@pact/protocol";
import { parsePrice } from "./money";

export interface PageOffer {
  price: Money;
  shipping?: Money;
  inStock?: boolean;
  variant?: string;
  name?: string;
}

const LD_SCRIPT =
  /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

/** Every JSON-LD block that parses; malformed blocks are skipped. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(LD_SCRIPT)) {
    const body = (m[1] ?? "").trim().replace(/^<!--|-->$/g, "");
    try {
      out.push(JSON.parse(body));
    } catch {
      // Sites ship broken JSON-LD; one bad block must not hide a good one.
    }
  }
  return out;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function hasType(o: Obj, ...types: string[]): boolean {
  const t = o["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === "string" && types.includes(x.replace(/^schema:/, "")));
}

/** Walks arrays, `@graph` and nesting (bounded) and yields every Product-like node. */
function* products(node: unknown, depth = 0): Generator<Obj> {
  if (depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) yield* products(n, depth + 1);
    return;
  }
  if (!isObj(node)) return;
  if (hasType(node, "Product", "ProductGroup", "IndividualProduct", "ProductModel")) yield node;
  if (node["@graph"]) yield* products(node["@graph"], depth + 1);
  for (const key of ["mainEntity", "itemOffered", "hasVariant"]) {
    if (node[key]) yield* products(node[key], depth + 1);
  }
}

function firstOffer(offers: unknown): Obj | undefined {
  const list = Array.isArray(offers) ? offers : [offers];
  const objs = list.filter(isObj);
  return objs.find((o) => hasType(o, "Offer")) ?? objs[0];
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

function readPrice(o: Obj, currency: string | undefined): Money | undefined {
  const spec = Array.isArray(o.priceSpecification)
    ? o.priceSpecification.find(isObj)
    : o.priceSpecification;
  const raw =
    (o.price as unknown) ?? o.lowPrice ?? (isObj(spec) ? (spec.price as unknown) : undefined);
  const cur =
    str(o.priceCurrency) ?? (isObj(spec) ? str(spec.priceCurrency) : undefined) ?? currency;
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  return parsePrice(raw, cur, { schemaOrg: true }) ?? parsePrice(raw, cur);
}

function availability(o: Obj): boolean | undefined {
  const a = str(o.availability);
  if (!a) return undefined;
  const v = a.replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/, "");
  if (/^(InStock|OnlineOnly|LimitedAvailability)$/i.test(v)) return true;
  // Not shippable now, so never "in stock" for an auto-buy.
  if (/^(OutOfStock|SoldOut|Discontinued|BackOrder|PreOrder|PreSale|InStoreOnly)$/i.test(v))
    return false;
  return undefined;
}

function variantOf(product: Obj, offer: Obj): string | undefined {
  const parts = [product.color, product.size, offer.sku ?? product.sku]
    .map(str)
    .filter((x): x is string => x !== undefined);
  return parts.length ? parts.join(" / ").slice(0, 200) : undefined;
}

function shippingOf(offer: Obj, currency: string): Money | undefined {
  const details = Array.isArray(offer.shippingDetails)
    ? offer.shippingDetails.find(isObj)
    : offer.shippingDetails;
  if (!isObj(details) || !isObj(details.shippingRate)) return undefined;
  const rate = details.shippingRate;
  const raw = rate.value as unknown;
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const m = parsePrice(raw, str(rate.currency) ?? currency, { schemaOrg: true });
  return m && m.currency === currency ? m : undefined;
}

/** The first Product with a readable offer price. */
export function offerFromJsonLd(blocks: unknown[]): PageOffer | undefined {
  for (const block of blocks) {
    for (const product of products(block)) {
      const offer = firstOffer(product.offers);
      if (!offer) continue;
      const price = readPrice(offer, undefined);
      if (!price) continue;
      const out: PageOffer = { price };
      const shipping = shippingOf(offer, price.currency);
      if (shipping) out.shipping = shipping;
      const inStock = availability(offer);
      if (inStock !== undefined) out.inStock = inStock;
      const variant = variantOf(product, offer);
      if (variant) out.variant = variant;
      const name = str(product.name);
      if (name) out.name = name.slice(0, 300);
      return out;
    }
  }
  return undefined;
}

const META = /<meta\b[^>]*>/gi;
const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];

/** OpenGraph / product meta tags (`product:price:amount`, `og:price:amount`). */
export function offerFromMeta(html: string): PageOffer | undefined {
  const meta = new Map<string, string>();
  for (const m of html.matchAll(META)) {
    const key = (
      attr(m[0], "property") ??
      attr(m[0], "name") ??
      attr(m[0], "itemprop")
    )?.toLowerCase();
    const content = attr(m[0], "content");
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const amount =
    meta.get("product:price:amount") ?? meta.get("og:price:amount") ?? meta.get("price");
  const currency =
    meta.get("product:price:currency") ??
    meta.get("og:price:currency") ??
    meta.get("pricecurrency");
  if (!amount || !currency) return undefined;
  const price = parsePrice(amount, currency, { schemaOrg: true }) ?? parsePrice(amount, currency);
  if (!price) return undefined;
  const avail = meta.get("product:availability") ?? meta.get("og:availability");
  const out: PageOffer = { price };
  if (avail) {
    if (/out\s?of\s?stock|oos|sold/i.test(avail)) out.inStock = false;
    else if (/in\s?stock|instock|available/i.test(avail)) out.inStock = true;
  }
  return out;
}

export function offerFromHtml(html: string): PageOffer | undefined {
  return offerFromJsonLd(extractJsonLd(html)) ?? offerFromMeta(html);
}
