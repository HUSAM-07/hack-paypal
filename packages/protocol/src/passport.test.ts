import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CUSTOM_ID_MAX, type PassportBody } from "./cited";
import { addStoreViewed, signPassport, verifyPassport } from "./passport";

const KEY = "test-key-1";
const body: PassportBody = {
  v: 1,
  sessionId: "sess_8f3kQ2",
  arm: "test",
  creatorsSeen: ["cr_ana", "cr_bo"],
  storesViewed: ["northwind", "lumen", "megamart"],
};

const shortId = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
const bodyArb = fc.record({
  v: fc.constant(1 as const),
  sessionId: shortId,
  arm: fc.constantFrom("test", "placebo", "none" as const),
  creatorsSeen: fc.array(shortId, { maxLength: 2 }),
  storesViewed: fc.array(shortId, { maxLength: 3 }),
}) as fc.Arbitrary<PassportBody>;

describe("passport", () => {
  it("fits custom_id at realistic sizes", async () => {
    const t = await signPassport(body, KEY);
    expect(t.length).toBeLessThanOrEqual(CUSTOM_ID_MAX);
  });

  it("round-trips any body", async () => {
    await fc.assert(
      fc.asyncProperty(bodyArb, async (b) => {
        const r = await verifyPassport(await signPassport(b, KEY), KEY);
        expect(r).toEqual({ ok: true, body: b });
      }),
    );
  });

  it("rejects any single-character tamper", async () => {
    const t = await signPassport(body, KEY);
    await fc.assert(
      fc.asyncProperty(fc.nat(t.length - 1), fc.constantFrom(..."abcxyz019|,._-"), async (i, c) => {
        fc.pre(t[i] !== c);
        const r = await verifyPassport(t.slice(0, i) + c + t.slice(i + 1), KEY);
        expect(r.ok).toBe(false);
      }),
    );
  });

  it("rejects arm swap, wrong key, unknown version, over-length, junk", async () => {
    const t = await signPassport(body, KEY);
    expect(await verifyPassport(t.replace("|test|", "|none|"), KEY)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(await verifyPassport(t, "other-key")).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyPassport(t.replace(/^v1/, "v2"), KEY)).toEqual({
      ok: false,
      reason: "unknown_version",
    });
    expect(await verifyPassport(`${t}${"a".repeat(CUSTOM_ID_MAX)}`, KEY)).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(await verifyPassport("garbage", KEY)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses to sign a passport that cannot fit", async () => {
    const long = "a".repeat(24);
    await expect(
      signPassport(
        {
          ...body,
          sessionId: long,
          creatorsSeen: [long, long, long, long],
          storesViewed: [long, long, long, long],
        },
        KEY,
      ),
    ).rejects.toThrow(/custom_id/);
  });
});

describe("addStoreViewed", () => {
  it("appends, dedupes and caps at 4", () => {
    const b = { ...body, storesViewed: [] };
    const one = addStoreViewed(b, "a");
    expect(addStoreViewed(one, "a")).toBe(one);
    const full = ["b", "c", "d", "e"].reduce(addStoreViewed, one);
    expect(full.storesViewed).toEqual(["b", "c", "d", "e"]);
  });
});
