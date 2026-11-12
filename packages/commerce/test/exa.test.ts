import { describe, expect, it } from "vitest";
import { EXA_OBJECTIVE_DESCRIPTION, ToolArgs } from "../src/contract";
import {
  contentsResult,
  createExaClient,
  livePriceContentsRequest,
  OFFER_OUTPUT_SCHEMA,
  offersFromSearch,
  pageContentsRequest,
  productSearchRequest,
  researchDigest,
  researchRequest,
} from "../src/exa";

/** Parameters the build-with-exa skill says never to add without an explicit task need. */
const FORBIDDEN = [
  "numResults",
  "category",
  "includeDomains",
  "excludeDomains",
  "startPublishedDate",
  "endPublishedDate",
  "livecrawl",
  "useAutoprompt",
  "tokensNum",
  "stream",
  "userLocation",
];

function deepKeys(o: unknown, prefix = ""): string[] {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return [];
  return Object.entries(o).flatMap(([k, v]) => [
    prefix + k,
    ...(k === "outputSchema" ? [] : deepKeys(v, `${prefix}${k}.`)),
  ]);
}

describe("Exa request shapes", () => {
  const objective = "Rank shop product pages first; skip reviews; pull the price.";

  it("product search: recommended request + objective, outputSchema, systemPrompt; nothing else", () => {
    const req = productSearchRequest({ query: "sony xm6 headphones", objective });
    expect(Object.keys(req).sort()).toEqual(
      ["contents", "objective", "outputSchema", "query", "systemPrompt", "type"].sort(),
    );
    expect(req.type).toBe("auto");
    expect(req.contents).toEqual({ highlights: true });
    expect(req.objective).toBe(objective);
    expect(req.outputSchema).toEqual(OFFER_OUTPUT_SCHEMA);
    for (const k of deepKeys(req)) expect(FORBIDDEN).not.toContain(k.split(".").pop());
    expect(deepKeys(req)).not.toContain("text");
    expect(deepKeys(req)).not.toContain("summary");
  });

  it("puts a price cap in the query wording, not a filter", () => {
    const req = productSearchRequest({
      query: "robot vacuum",
      objective,
      maxPrice: { amountMinor: 30_000, currency: "USD" },
    });
    expect(req.query).toBe("robot vacuum under $300.00");
  });

  it("research: exactly the recommended request plus objective", () => {
    expect(
      researchRequest({ question: "Is the XM6 better than the QC Ultra?", objective }),
    ).toEqual({
      query: "Is the XM6 better than the QC Ultra?",
      objective,
      type: "auto",
      contents: { highlights: true },
    });
  });

  it("live price reads: /contents with top-level text, maxAgeHours 0 and a livecrawl timeout", () => {
    expect(livePriceContentsRequest("https://shop.example/p/1")).toEqual({
      urls: ["https://shop.example/p/1"],
      text: true,
      maxAgeHours: 0,
      livecrawlTimeout: 10_000,
    });
    expect(pageContentsRequest("https://shop.example/p/1")).toEqual({
      urls: ["https://shop.example/p/1"],
      text: true,
    });
  });

  it("the tool schema carries the verbatim objective description", () => {
    expect(ToolArgs.search_products.shape.objective.description).toBe(EXA_OBJECTIVE_DESCRIPTION);
    expect(ToolArgs.web_research.shape.objective.description).toBe(EXA_OBJECTIVE_DESCRIPTION);
    expect(EXA_OBJECTIVE_DESCRIPTION).toBe(
      "Goal for this search turn; say which documents should rank first, which should be excluded, and what specific facts or figures to pull from them.",
    );
  });

  it("the client posts to /search and /contents with x-api-key", async () => {
    const sent: { url: string; headers: Headers; body: unknown }[] = [];
    const exa = createExaClient({
      apiKey: "test-key",
      fetch: async (input, init) => {
        sent.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json(
          String(input).endsWith("/contents") ? { results: [], statuses: [] } : { results: [] },
        );
      },
    });
    await exa.search(researchRequest({ question: "q", objective }));
    await exa.contents(pageContentsRequest("https://a.example/x"));
    expect(sent.map((s) => s.url)).toEqual([
      "https://api.exa.ai/search",
      "https://api.exa.ai/contents",
    ]);
    expect(sent[0]?.headers.get("x-api-key")).toBe("test-key");
    expect(sent[0]?.body).toEqual(researchRequest({ question: "q", objective }));
  });

  it("errors don't echo the response body", async () => {
    const exa = createExaClient({
      apiKey: "k",
      fetch: async () => new Response("secret echo", { status: 401 }),
    });
    await expect(exa.search(researchRequest({ question: "q", objective }))).rejects.toThrow(
      /^exa \/search → 401$/,
    );
  });
});

describe("Exa result mapping", () => {
  const res = {
    results: [
      {
        url: "https://bestshop.example/sony-xm6",
        title: "Sony WH-1000XM6 | BestShop",
        highlights: ["Sony WH-1000XM6 now $329.99", "Free shipping"],
        image: "https://bestshop.example/xm6.jpg",
      },
      { url: "https://reviews.example/xm6", title: "XM6 review", highlights: ["We loved it."] },
    ],
    output: {
      content: {
        offers: [
          {
            name: "Sony WH-1000XM6",
            brand: "Sony",
            price: "329.99",
            currency: "USD",
            merchant: "BestShop",
            url: "https://bestshop.example/sony-xm6",
            inStock: true,
          },
          { name: "No price", price: "call us", currency: "USD", url: "https://x.example/a" },
          { name: "Bad url", price: "10", currency: "USD", url: "javascript:alert(1)" },
          {
            name: "Duplicate",
            price: "300",
            currency: "USD",
            url: "https://bestshop.example/sony-xm6",
          },
        ],
      },
    },
  };

  it("maps structured offers to watch-only Exa offers", () => {
    const { offers, sources } = offersFromSearch(res, "2026-11-01T00:00:00.000Z");
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      title: "Sony WH-1000XM6",
      brand: "Sony",
      price: { amountMinor: 32_999, currency: "USD" },
      merchant: { name: "BestShop", domain: "bestshop.example" },
      buyable: false,
      source: "exa",
      inStock: true,
      imageUrl: "https://bestshop.example/xm6.jpg",
      highlights: ["Sony WH-1000XM6 now $329.99", "Free shipping"],
    });
    expect(offers[0]?.merchant.paypalSellerId).toBeUndefined();
    expect(offers[0]?.id).toMatch(/^exa_[0-9a-z]+$/);
    expect(sources).toEqual([
      { n: 1, url: "https://bestshop.example/sony-xm6", title: "Sony WH-1000XM6 | BestShop" },
      { n: 2, url: "https://reviews.example/xm6", title: "XM6 review" },
    ]);
  });

  it("accepts output.content as a JSON string and survives junk", () => {
    expect(
      offersFromSearch(
        { results: [], output: { content: JSON.stringify(res.output.content) } },
        "2026-11-01T00:00:00.000Z",
      ).offers,
    ).toHaveLength(1);
    expect(
      offersFromSearch({ results: [], output: { content: "not json" } }, "2026-11-01T00:00:00.000Z")
        .offers,
    ).toEqual([]);
    expect(offersFromSearch({ results: [] }, "2026-11-01T00:00:00.000Z").offers).toEqual([]);
  });

  it("research digest numbers excerpts to match sources", () => {
    const d = researchDigest(res);
    expect(d.answer.split("\n")[0]).toBe("[1] Sony WH-1000XM6 now $329.99 … Free shipping");
    expect(d.sources).toHaveLength(2);
  });

  it("contents: a failed status is a miss even with HTTP 200", () => {
    const url = "https://a.example/x";
    expect(
      contentsResult(
        { results: [{ url, text: "hi" }], statuses: [{ id: url, status: "error" }] },
        url,
      ),
    ).toBeUndefined();
    expect(
      contentsResult(
        { results: [{ url, text: "hi" }], statuses: [{ id: url, status: "success" }] },
        url,
      )?.text,
    ).toBe("hi");
  });
});
