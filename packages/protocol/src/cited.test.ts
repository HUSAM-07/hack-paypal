import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  armProbabilities,
  CUSTOM_ID_MAX,
  commissionOn,
  DEFAULT_SCHEDULE,
  decodePassportBody,
  encodePassportBody,
  type PassportBody,
} from "./index";

describe("holdout schedule", () => {
  it("is 50/50 while calibrating, then a 5% holdout", () => {
    expect(armProbabilities(0, DEFAULT_SCHEDULE).test).toBeCloseTo(0.5);
    expect(armProbabilities(6, DEFAULT_SCHEDULE).test).toBeCloseTo(0.5);
    expect(armProbabilities(7, DEFAULT_SCHEDULE).test).toBeCloseTo(0.95);
  });

  it("always sums to 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), (day) => {
        const p = armProbabilities(day, DEFAULT_SCHEDULE);
        expect(p.test + p.placebo + p.none).toBeCloseTo(1);
      }),
    );
  });
});

describe("agent affiliate passport", () => {
  const id = fc.stringMatching(/^[A-Za-z0-9_-]{1,24}$/);
  const body = fc.record({
    v: fc.constant(1 as const),
    sessionId: id,
    arm: fc.constantFrom("test", "placebo", "none") as fc.Arbitrary<PassportBody["arm"]>,
    creatorsSeen: fc.array(id, { maxLength: 4 }),
    storesViewed: fc.array(id, { maxLength: 4 }),
  });

  it("round-trips", () => {
    fc.assert(
      fc.property(body, (p) => {
        expect(decodePassportBody(encodePassportBody(p))).toEqual(p);
      }),
    );
  });

  it("fits in custom_id with room for a signature at demo id lengths", () => {
    const p: PassportBody = {
      v: 1,
      sessionId: "s_8f3k2m9q",
      arm: "test",
      creatorsSeen: ["housefresh", "airlab"],
      storesViewed: ["northwind", "lumen", "megamart"],
    };
    expect(encodePassportBody(p).length).toBeLessThan(CUSTOM_ID_MAX - 44);
  });

  it("rejects unknown versions and bad arms", () => {
    expect(() => decodePassportBody("v2|s|test||")).toThrow();
    expect(() => decodePassportBody("v1|s|maybe||")).toThrow();
  });
});

describe("commission", () => {
  it("is 8%, rounded down", () => {
    expect(commissionOn({ amountMinor: 9599, currency: "USD" })).toEqual({
      amountMinor: 767,
      currency: "USD",
    });
  });
});
