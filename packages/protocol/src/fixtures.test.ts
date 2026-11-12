import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VerifiedTest } from "./cited";
import {
  airlabWinixTest,
  crumblabPlacebo,
  crumblabRoborockTest,
  fixtures,
  housefreshPlacebo,
  housefreshWinixTest,
  narrowCloseTest,
  UPC_LEVOIT_CORE300,
  UPC_ROBOROCK_Q7MAX,
  UPC_ROOMBA_J5,
  UPC_WINIX_A230,
  VACUUM_SHOP_PRICES,
  vacuumFixtures,
} from "./fixtures";

const dir = join(import.meta.dirname, "..", "fixtures");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("fixtures", () => {
  it("has six files, each valid against VerifiedTest", () => {
    expect(files).toHaveLength(6);
    for (const f of files) {
      expect(() =>
        VerifiedTest.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))),
      ).not.toThrow();
    }
  });

  it("exports all four with unique ids", () => {
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(4);
  });

  it("every fixture has a disclosure", () => {
    for (const f of fixtures) expect(f.disclosure.length).toBeGreaterThan(20);
  });

  it("head-to-head and AirLab tests both favour Winix and share SKUs", () => {
    expect(housefreshWinixTest.verdictUpc).toBe(UPC_WINIX_A230);
    expect(airlabWinixTest.verdictUpc).toBe(UPC_WINIX_A230);
    expect(housefreshWinixTest.skus.map((s) => s.upc)).toEqual([
      UPC_WINIX_A230,
      UPC_LEVOIT_CORE300,
    ]);
    expect(airlabWinixTest.skus).toEqual(housefreshWinixTest.skus);
    expect(airlabWinixTest.creatorId).not.toBe(housefreshWinixTest.creatorId);
  });

  it("placebo is same creator, unrelated product, no verdict", () => {
    expect(housefreshPlacebo.kind).toBe("placebo");
    expect(housefreshPlacebo.creatorId).toBe(housefreshWinixTest.creatorId);
    expect(housefreshPlacebo.verdictUpc).toBeUndefined();
    const purifierUpcs = housefreshWinixTest.skus.map((s) => s.upc);
    expect(housefreshPlacebo.skus.some((s) => purifierUpcs.includes(s.upc))).toBe(false);
  });

  it("narrow test has no verdict", () => {
    expect(narrowCloseTest.kind).toBe("test");
    expect(narrowCloseTest.verdictUpc).toBeUndefined();
  });

  it("robot-vacuum fixtures: a verdict for Roborock, and a same-creator placebo with no verdict", () => {
    expect(crumblabRoborockTest.verdictUpc).toBe(UPC_ROBOROCK_Q7MAX);
    expect(crumblabRoborockTest.skus.map((s) => s.upc)).toEqual([
      UPC_ROBOROCK_Q7MAX,
      UPC_ROOMBA_J5,
    ]);
    expect(crumblabPlacebo.kind).toBe("placebo");
    expect(crumblabPlacebo.creatorId).toBe(crumblabRoborockTest.creatorId);
    expect(crumblabPlacebo.verdictUpc).toBeUndefined();
    const tested = crumblabRoborockTest.skus.map((s) => s.upc);
    expect(crumblabPlacebo.skus.some((s) => tested.includes(s.upc))).toBe(false);
    expect(new Set(vacuumFixtures.map((f) => f.id)).size).toBe(2);
    for (const f of vacuumFixtures) expect(f.disclosure).toMatch(/fictional/);
  });

  it("the two vacuums cost the same at every seller", () => {
    for (const prices of Object.values(VACUUM_SHOP_PRICES)) {
      expect(prices[UPC_ROBOROCK_Q7MAX]).toBe(prices[UPC_ROOMBA_J5]);
    }
  });
});
