import { describe, expect, it } from "vitest";
import { analyze, type SessionRecord } from "../src/cited/analyze";
import { DESIGNS, MODELS, plan, VACUUM_DESIGNS, VACUUM_SEED } from "../src/cited/design";
import {
  cataloguePayload,
  INTENTS,
  intentsFor,
  SEARCH_QUERY,
  TARGET_UPC,
  userMessage,
  VACUUM_SEARCH_QUERY,
} from "../src/cited/world";

describe("cited eval design", () => {
  it("plan matches the pre-registered sizes and is reproducible", () => {
    const p = plan();
    expect(p).toHaveLength(375);
    expect(plan().map((s) => s.id)).toEqual(p.map((s) => s.id));
    for (const d of DESIGNS) {
      const n = p.filter((s) => s.study === d.study && s.variant === d.variant).length;
      expect(n).toBe(MODELS.length * (d.perModel.test + d.perModel.placebo + d.perModel.none));
    }
  });

  it("ranking is identical across arms; only the creator content differs", () => {
    for (const study of ["purifier", "narrow"] as const) {
      const t = cataloguePayload(study, "test", "a");
      const p = cataloguePayload(study, "placebo", "a");
      const n = cataloguePayload(study, "none", "a");
      expect(p.listings).toEqual(t.listings);
      expect(n.listings).toEqual(t.listings);
      expect(n.creatorContent).toHaveLength(0);
      expect(t.creatorContent[0]?.kind).toBe("test");
      expect(p.creatorContent[0]?.kind).toBe("placebo");
    }
  });

  it("counts declines as non-target and drops invalid sessions", () => {
    const mk = (
      model: string,
      arm: SessionRecord["arm"],
      action: "buy" | "decline" | "invalid",
      upc?: string,
    ): SessionRecord => ({
      id: `${model}${arm}${Math.random()}`,
      study: "purifier",
      variant: "abstain",
      model,
      arm,
      intent: 0,
      outcome: { action, ...(upc ? { upc } : {}), attempts: 1 },
    });
    const recs = [
      mk("m", "test", "buy", "W"),
      mk("m", "test", "decline"),
      mk("m", "test", "invalid"),
      mk("m", "placebo", "buy", "L"),
      mk("m", "placebo", "buy", "W"),
    ];
    const a = analyze(recs, "W", ["m"]);
    expect(a.pooled.test).toMatchObject({ sessions: 2, target: 1, declines: 1 });
    expect(a.invalid).toBe(1);
    expect(a.lift.lift).toBeCloseTo(0, 10);
  });
});

describe("robot-vacuum study", () => {
  const ROBOROCK = TARGET_UPC.vacuum;
  const ROOMBA = "100000000007";
  const lumen = (study: "vacuum", price: "parity" | "rival-cheaper", upc: string) =>
    cataloguePayload(study, "none", "a", price).listings.find(
      (l) => l.shopId === "lumen" && l.upc === upc,
    )?.price.amountMinor;

  it("plan is 588 sessions, reproducible, balanced per model and arm", () => {
    const p = plan(VACUUM_DESIGNS, VACUUM_SEED);
    expect(p).toHaveLength(588);
    expect(plan(VACUUM_DESIGNS, VACUUM_SEED).map((s) => s.id)).toEqual(p.map((s) => s.id));
    expect(new Set(p.map((s) => s.id)).size).toBe(588);
    for (const d of VACUUM_DESIGNS) {
      for (const model of MODELS) {
        const cell = p.filter(
          (s) =>
            s.study === "vacuum" &&
            s.price === d.price &&
            s.variant === d.variant &&
            s.model === model,
        );
        expect(cell).toHaveLength(49);
        for (const arm of ["test", "placebo", "none"] as const)
          expect(cell.filter((s) => s.arm === arm)).toHaveLength(d.perModel[arm]);
      }
    }
  });

  it("the study only draws sessions of its own study", () => {
    expect(new Set(plan(VACUUM_DESIGNS, VACUUM_SEED).map((s) => s.study))).toEqual(
      new Set(["vacuum"]),
    );
    expect(plan().every((s) => s.study !== "vacuum")).toBe(true);
  });

  it("ranking is identical across arms; only the creator content differs", () => {
    for (const price of ["parity", "rival-cheaper"] as const) {
      const t = cataloguePayload("vacuum", "test", "a", price);
      const p = cataloguePayload("vacuum", "placebo", "a", price);
      const n = cataloguePayload("vacuum", "none", "a", price);
      expect(p.listings).toEqual(t.listings);
      expect(n.listings).toEqual(t.listings);
      expect(n.creatorContent).toHaveLength(0);
      expect(t.creatorContent.map((c) => [c.creatorId, c.kind])).toEqual([["crumblab", "test"]]);
      expect(p.creatorContent.map((c) => [c.creatorId, c.kind])).toEqual([["crumblab", "placebo"]]);
      expect(t.creatorContent[0]?.verdictUpc).toBe(ROBOROCK);
    }
  });

  it("lists only robot vacuums, six offers, at the stated prices", () => {
    const { listings } = cataloguePayload("vacuum", "test", "a", "parity");
    expect(listings).toHaveLength(6);
    expect(new Set(listings.map((l) => l.upc))).toEqual(new Set([ROBOROCK, ROOMBA]));
    expect(lumen("vacuum", "parity", ROBOROCK)).toBe(29599);
    expect(lumen("vacuum", "parity", ROOMBA)).toBe(29599);
    expect(lumen("vacuum", "rival-cheaper", ROBOROCK)).toBe(29599);
    expect(lumen("vacuum", "rival-cheaper", ROOMBA)).toBe(29199);
  });

  it("the purifier payload is untouched by the new category", () => {
    const { listings } = cataloguePayload("purifier", "test", "a", "parity");
    expect(listings).toHaveLength(6);
    expect(listings.every((l) => ["Winix", "Levoit"].includes(l.brand))).toBe(true);
    expect(cataloguePayload("purifier", "test", "a").listings[0]?.upc).toBe(TARGET_UPC.purifier);
  });

  it("buyer requests name no brand and a different search query is shown", () => {
    const brands = /roborock|irobot|roomba|winix|levoit|purifier/i;
    for (const i of intentsFor("vacuum")) expect(i).not.toMatch(brands);
    expect(intentsFor("vacuum")).toHaveLength(4);
    expect(intentsFor("purifier")).toBe(INTENTS);
    const msg = userMessage("hi", {}, VACUUM_SEARCH_QUERY);
    expect(msg).toContain(`'${VACUUM_SEARCH_QUERY}'`);
    expect(userMessage("hi", {})).toContain(`'${SEARCH_QUERY}'`);
  });
});
