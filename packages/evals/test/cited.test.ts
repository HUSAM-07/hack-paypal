import { describe, expect, it } from "vitest";
import { analyze, type SessionRecord } from "../src/cited/analyze";
import { DESIGNS, MODELS, plan } from "../src/cited/design";
import { cataloguePayload } from "../src/cited/world";

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
