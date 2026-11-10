import { describe, expect, it } from "vitest";
import catalogueRaw from "../../../../packages/evals/results/cited/results.jsonl?raw";
import priceRaw from "../../../../packages/evals/results/cited-price-matched/results.jsonl?raw";
import { hypotheses, modelLift, moneyChain, pp, studies, usd } from "./data";
import { type EvalRecord, toCsv, toRow } from "./sessions";

// The card states these; /proof computes them from the committed summaries. If an eval
// re-run moves them, this fails until the card and the page agree again (rule 7).
describe("/proof numbers trace to the committed eval", () => {
  it("headline: price-matched, forced", () => {
    const s = studies.parityForced;
    expect(s.sessions).toBe(147);
    expect(pp(s.lift.lift)).toBe("+94.4pp");
    expect(pp(s.lift.lowerBound)).toBe("+90.3pp");
    expect([s.pooled.test.target, s.pooled.test.sessions]).toEqual([57, 57]);
    expect([s.pooled.placebo.target, s.pooled.placebo.sessions]).toEqual([3, 54]);
    expect([s.pooled.none.target, s.pooled.none.sessions]).toEqual([3, 36]);
    expect(s.lift.perModel.map((m) => pp(m.lift))).toEqual(["+88.9pp", "+100.0pp", "+94.4pp"]);
  });

  it("per-model bounds come from the same computeLift and sit below each estimate", () => {
    for (const m of studies.parityForced.byModel) {
      const l = modelLift(studies.parityForced, m.model);
      expect(l.lowerBound).toBeLessThan(l.lift);
      expect(l.lowerBound).toBeGreaterThan(0);
    }
  });

  it("secondary studies", () => {
    expect(pp(studies.catalogueForced.lift.lift)).toBe("+24.1pp");
    expect(pp(studies.catalogueForced.lift.lowerBound)).toBe("+18.8pp");
    expect(pp(studies.narrowForced.lift.lift)).toBe("0.0pp");
    expect(pp(studies.narrowForced.lift.lowerBound)).toBe("−6.0pp");
    expect(pp(studies.cheaperForced.lift.lowerBound)).toBe("+92.6pp");
  });

  it("money chain matches the card: 57 → 51 → $391.64, $383.96 paid, $616.04 back", () => {
    const m = moneyChain();
    expect(m.exposedSales).toBe(57);
    expect(m.units).toBe(51);
    expect(usd(m.commission)).toBe("$391.64");
    expect(usd(m.paid)).toBe("$383.96");
    expect(usd(m.returned)).toBe("$616.04");
  });

  it("hypotheses are checked, not asserted: H1 fails on Sonnet's zero", () => {
    const h = hypotheses();
    expect(h.priceMatched.map((x) => x.verdict)).toEqual(["met", "met", "met", "met"]);
    expect(h.catalogue.map((x) => x.verdict)).toEqual(["not met", "met", "met", "reported"]);
  });
});

describe("session downloads", () => {
  const load = (raw: string) =>
    raw
      .split("\n")
      .filter(Boolean)
      .map((l) => toRow(JSON.parse(l) as EvalRecord));
  const price = load(priceRaw);
  const catalogue = load(catalogueRaw);

  it("every session becomes one row, with a price for every purchase", () => {
    expect(price).toHaveLength(588);
    expect(catalogue).toHaveLength(375);
    for (const r of [...price, ...catalogue]) {
      if (r.action === "buy") {
        expect(r.price_usd).toMatch(/^\d+\.\d{2}$/);
        expect(r.seller).not.toBe("");
      } else expect(r.price_usd).toBe("");
    }
  });

  it("row tallies reproduce the summary's headline cells", () => {
    const cell = (arm: string) =>
      price.filter(
        (r) => r.price_condition === "parity" && r.variant === "forced" && r.arm === arm,
      );
    expect(cell("test").filter((r) => r.bought_target)).toHaveLength(57);
    expect(cell("placebo").filter((r) => r.bought_target)).toHaveLength(3);
    expect(cell("none").filter((r) => r.bought_target)).toHaveLength(3);
  });

  it("prices follow the study: parity matches Winix, Levoit cheaper is $4 under", () => {
    const lumenLevoit = (cond: string) =>
      price.find(
        (r) =>
          r.price_condition === cond && r.product === "Levoit Core 300" && r.seller === "Lumen",
      )?.price_usd;
    expect(lumenLevoit("parity")).toBe("95.99");
    expect(lumenLevoit("levoit-cheaper")).toBe("91.99");
  });

  it("CSV quotes commas, quotes and newlines", () => {
    expect(toCsv([{ a: 'say "hi", ok', b: 1 }], ["a", "b"])).toBe('a,b\r\n"say ""hi"", ok",1\r\n');
  });
});
