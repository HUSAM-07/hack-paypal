import { describe, expect, it } from "vitest";
import { brandFromParams, brandOptions, categoryLabel, searchWithBrand } from "./brand";

const rows = [
  { brandId: "bose", brand: "Bose", category: "headphones", scopeKey: "first" },
  { brandId: "bose", brand: "Bose", category: "headphones", scopeKey: "todate" },
  { brandId: "winix", brand: "Winix", category: "purifier", scopeKey: "todate" },
  { brandId: "roborock", brand: "Roborock", category: "robot-vacuum", scopeKey: "todate" },
];

describe("brand switcher", () => {
  it("lists each funded brand once, Winix first", () => {
    expect(brandOptions(rows).map((b) => b.brandId)).toEqual(["winix", "bose", "roborock"]);
    expect(brandOptions(undefined)).toEqual([]);
  });

  it("opens the brand a link names, and Winix for anything else", () => {
    const known = ["winix", "bose", "roborock"];
    expect(brandFromParams(new URLSearchParams("brand=roborock"), known)).toBe("roborock");
    expect(brandFromParams(new URLSearchParams("brand=nobody"), known)).toBe("winix");
    expect(brandFromParams(new URLSearchParams("view=first"), known)).toBe("winix");
  });

  it("keeps every other parameter, and adds nothing for Winix", () => {
    expect(searchWithBrand("?view=first", "roborock")).toBe("?view=first&brand=roborock");
    expect(searchWithBrand("?view=first&brand=bose", "winix")).toBe("?view=first");
    expect(searchWithBrand("", "winix")).toBe("");
  });

  it("names a category for a heading", () => {
    expect(categoryLabel("robot-vacuum")).toBe("Robot vacuum");
    expect(categoryLabel("purifier")).toBe("Purifier");
  });
});
