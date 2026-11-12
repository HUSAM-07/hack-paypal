import { describe, expect, it } from "vitest";
import catalogueRaw from "../../../../packages/evals/results/cited/results.jsonl?raw";
import priceRaw from "../../../../packages/evals/results/cited-price-matched/results.jsonl?raw";
import vacuumRaw from "../../../../packages/evals/results/cited-robot-vacuum/results.jsonl?raw";
import {
  hypotheses,
  modelLift,
  moneyChain,
  pp,
  studies,
  usd,
  vacuumChain,
  vacuumHypotheses,
} from "./data";
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

// The second category. These are the numbers /proof, the README and the Devpost text state; they
// are read from the committed robot-vacuum summary, which came from a real run (rule 7).
describe("/proof robot-vacuum numbers trace to the committed eval", () => {
  it("price-matched, forced: a real but smaller lift, and Sonnet's zero", () => {
    const s = studies.vacuumParityForced;
    expect(s.sessions).toBe(147);
    expect(pp(s.lift.lift)).toBe("+16.7pp");
    expect(pp(s.lift.lowerBound)).toBe("+11.7pp");
    expect([s.pooled.test.target, s.pooled.test.sessions]).toEqual([57, 57]);
    expect([s.pooled.placebo.target, s.pooled.placebo.sessions]).toEqual([45, 54]);
    expect([s.pooled.none.target, s.pooled.none.sessions]).toEqual([31, 36]);
    expect(s.lift.perModel.map((m) => pp(m.lift))).toEqual(["+33.3pp", "+16.7pp", "0.0pp"]);
    expect(s.invalid).toBe(0);
  });

  it("Roomba $4 cheaper, and the abstain-allowed variants", () => {
    expect(pp(studies.vacuumCheaperForced.lift.lift)).toBe("+74.1pp");
    expect(pp(studies.vacuumCheaperForced.lift.lowerBound)).toBe("+68.6pp");
    expect(pp(studies.vacuumParityAbstain.lift.lift)).toBe("+48.1pp");
    expect(pp(studies.vacuumParityAbstainBuyers.lift.lowerBound)).toBe("+16.1pp");
    expect(pp(studies.vacuumCheaperAbstain.lift.lowerBound)).toBe("+64.1pp");
    expect(pp(studies.vacuumCheaperAbstainBuyers.lift.lowerBound)).toBe("+82.0pp");
  });

  it("derived chain: 50 exposed sales, 5 caused units, $118.39 of a $3,000 deposit", () => {
    expect(vacuumChain.exposedSales).toBe(50);
    expect(vacuumChain.units).toBe(5);
    expect(usd(vacuumChain.commission.amountMinor)).toBe("$118.39");
    expect(usd(vacuumChain.refund.amountMinor)).toBe("$2,881.61");
  });

  it("hypotheses are checked, not asserted: V1 fails on Sonnet's zero", () => {
    expect(vacuumHypotheses().map((x) => x.verdict)).toEqual(["not met", "met", "met", "met"]);
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
  const vacuum = load(vacuumRaw);

  it("every session becomes one row, with a price for every purchase", () => {
    expect(price).toHaveLength(588);
    expect(catalogue).toHaveLength(375);
    expect(vacuum).toHaveLength(588);
    for (const r of [...price, ...catalogue, ...vacuum]) {
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

  it("robot-vacuum rows: study, product, price and the target follow the study", () => {
    expect(new Set(vacuum.map((r) => r.study))).toEqual(new Set(["robot-vacuum"]));
    const cell = (arm: string) =>
      vacuum.filter(
        (r) => r.price_condition === "parity" && r.variant === "forced" && r.arm === arm,
      );
    expect(cell("test").filter((r) => r.bought_target)).toHaveLength(57);
    expect(cell("placebo").filter((r) => r.bought_target)).toHaveLength(45);
    expect(cell("none").filter((r) => r.bought_target)).toHaveLength(31);
    const price = (cond: string, product: string, seller: string) =>
      vacuum.find((r) => r.price_condition === cond && r.product === product && r.seller === seller)
        ?.price_usd;
    expect(price("parity", "Roborock Q7 Max", "Lumen")).toBe("295.99");
    expect(price("parity", "iRobot Roomba Combo j5", "Lumen")).toBe("295.99");
    expect(price("rival-cheaper", "iRobot Roomba Combo j5", "Lumen")).toBe("291.99");
    expect(new Set(vacuum.filter((r) => r.action === "buy").map((r) => r.product))).toEqual(
      new Set(["Roborock Q7 Max", "iRobot Roomba Combo j5"]),
    );
  });

  it("CSV quotes commas, quotes and newlines", () => {
    expect(toCsv([{ a: 'say "hi", ok', b: 1 }], ["a", "b"])).toBe('a,b\r\n"say ""hi"", ok",1\r\n');
  });
});
