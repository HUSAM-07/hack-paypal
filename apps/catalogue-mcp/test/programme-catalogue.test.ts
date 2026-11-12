import { PROGRAMME_CATEGORIES } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { PRODUCTS } from "../src/sellers";

// The self-serve flow offers exactly what the catalogue can test, no more and no less.
describe("programme choices mirror the catalogue", () => {
  it("lists every catalogue product under the matching category", () => {
    const catalogueId = { purifier: "air-purifier", "robot-vacuum": "robot-vacuum" } as const;
    const offered = PROGRAMME_CATEGORIES.flatMap((c) =>
      c.products.map((p) => ({
        category: catalogueId[c.id],
        upc: p.upc,
        brand: p.brand,
        name: p.product,
      })),
    );
    expect(offered).toEqual(
      PRODUCTS.map((p) => ({ category: p.category, upc: p.upc, brand: p.brand, name: p.name })),
    );
  });
});
