import { describe, expect, it } from "vitest";
import { PRICE_JSON_SCHEMA } from "../src/browser-run";
import { PriceCheck } from "../src/contract";
import { ShopError } from "../src/deps";
import { checkOfferPrice, checkPrice } from "../src/price";
import { assertPublicHttpUrl } from "../src/url";
import { fakeExa, makeDeps, pageFetch } from "./helpers";

const URL1 = "https://bestshop.example/p/xm6";
const jsonLdPage = (price: string) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "XM6",
    offers: { "@type": "Offer", price, priceCurrency: "USD", availability: "InStock" },
  })}</script>`;

describe("checkPrice cascade", () => {
  it("1. plain fetch + JSON-LD", async () => {
    const { deps } = makeDeps({ fetch: pageFetch({ [URL1]: jsonLdPage("299.00") }).fetch });
    const c = await checkPrice(deps, URL1, { offerId: "exa_1" });
    expect(c).toMatchObject({
      method: "jsonLd",
      price: { amountMinor: 29_900, currency: "USD" },
      inStock: true,
      offerId: "exa_1",
    });
    expect(PriceCheck.safeParse(c).success).toBe(true);
  });

  it("2. falls back to Exa live contents when the page has no structured price", async () => {
    const exa = fakeExa({
      contents: () => ({
        results: [{ url: URL1, text: "Sony XM6. Our price: $289.95. Free returns." }],
        statuses: [{ id: URL1, status: "success" }],
      }),
    });
    const { deps } = makeDeps({
      exa: exa.client,
      fetch: pageFetch({ [URL1]: "<html>no data</html>" }).fetch,
    });
    const c = await checkPrice(deps, URL1);
    expect(c).toMatchObject({
      method: "exaContents",
      price: { amountMinor: 28_995, currency: "USD" },
    });
    expect(exa.calls[0]?.body).toEqual({
      urls: [URL1],
      text: true,
      maxAgeHours: 0,
      livecrawlTimeout: 10_000,
    });
  });

  it("3. falls back to Browser Run /json with a JSON schema", async () => {
    const asked: unknown[] = [];
    const { deps } = makeDeps({
      browserRun: {
        async json(req) {
          asked.push(req);
          return { price: "279.00", currency: "usd", inStock: false, variant: "Silver" };
        },
      },
    });
    const c = await checkPrice(deps, URL1);
    expect(c).toMatchObject({
      method: "browserRun",
      price: { amountMinor: 27_900, currency: "USD" },
      inStock: false,
      variant: "Silver",
    });
    expect(asked[0]).toMatchObject({
      url: URL1,
      response_format: { type: "json_schema", schema: PRICE_JSON_SCHEMA },
    });
  });

  it("a throwing tier is a miss, and nothing readable is a price_unavailable error", async () => {
    const { deps } = makeDeps({
      fetch: async () => {
        throw new Error("network down");
      },
      browserRun: { json: async () => ({ price: "free!", currency: "USD" }) },
    });
    await expect(checkPrice(deps, URL1)).rejects.toMatchObject({ code: "price_unavailable" });
  });

  it("caches in KV unless asked for a fresh read", async () => {
    let price = "299.00";
    const pages = pageFetch({ [URL1]: () => jsonLdPage(price) });
    const { deps } = makeDeps({ fetch: pages.fetch, kv: true });
    expect((await checkPrice(deps, URL1)).price.amountMinor).toBe(29_900);
    price = "199.00";
    expect((await checkPrice(deps, URL1)).price.amountMinor).toBe(29_900);
    expect((await checkPrice(deps, URL1, { fresh: true })).price.amountMinor).toBe(19_900);
    expect(pages.seen).toHaveLength(2);
  });

  it("PayPal sellers answer from their catalogue", async () => {
    const { deps, sellers } = makeDeps();
    const offer = await sellers.get("pp_sony_xm6", deps.clock.now());
    const c = await checkOfferPrice(deps, offer as NonNullable<typeof offer>);
    expect(c).toMatchObject({
      method: "paypalCatalogue",
      price: { amountMinor: 39_999 },
      inStock: true,
      variant: "Black",
    });
  });
});

describe("URL guard", () => {
  it.each([
    "http://localhost/x",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "file:///etc/passwd",
    "https://user:pw@shop.example/",
    "http://intranet/",
    "not a url",
  ])("refuses %s", (u) => {
    expect(() => assertPublicHttpUrl(u)).toThrow(ShopError);
  });

  it.each(["https://shop.example/p/1", "http://fcbarcelona.com/shop", "https://172.32.0.1/"])(
    "allows %s",
    (u) => {
      expect(() => assertPublicHttpUrl(u)).not.toThrow();
    },
  );
});
