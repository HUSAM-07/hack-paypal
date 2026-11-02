import type { Mandate, SpendIntent } from "@pact/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { authorize, type LedgerEntry, splitEqual, splitWeighted } from "./index";

const NOW = new Date("2026-11-05T12:00:00Z");

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: "m1",
    userId: "u1",
    maxPerCharge: { amountMinor: 10_000, currency: "USD" },
    maxTotal: { amountMinor: 30_000, currency: "USD" },
    period: "none",
    validFrom: "2026-11-01T00:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
    status: "active",
    createdAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

function intent(amountMinor: number, overrides: Partial<SpendIntent> = {}): SpendIntent {
  return {
    id: "i1",
    userId: "u1",
    amount: { amountMinor, currency: "USD" },
    merchant: "Acme",
    description: "test",
    initiatedBy: "agent",
    at: NOW.toISOString(),
    ...overrides,
  };
}

describe("authorize", () => {
  it("allows a charge inside the mandate", () => {
    expect(authorize(intent(5_000), [mandate()], [], NOW)).toEqual({
      outcome: "allow",
      mandateId: "m1",
    });
  });

  it("asks a present human when over the per-charge cap", () => {
    const d = authorize(intent(12_000), [mandate()], [], NOW);
    expect(d).toMatchObject({ outcome: "needs_approval", reasons: ["over_per_charge"] });
  });

  it("denies the same overage when unattended", () => {
    const d = authorize(intent(12_000, { initiatedBy: "schedule" }), [mandate()], [], NOW);
    expect(d).toMatchObject({ outcome: "deny", reasons: ["over_per_charge"] });
  });

  it("always denies hard violations, even with a human present", () => {
    const d = authorize(
      intent(1_000, { initiatedBy: "user" }),
      [mandate({ merchantDeny: ["acme"] })],
      [],
      NOW,
    );
    expect(d).toMatchObject({ outcome: "deny", reasons: ["merchant_denied"] });
  });

  it("never funds another pact with a pact-scoped mandate", () => {
    const m = mandate({ pactId: "p1" });
    // A present human is asked, as if no mandate existed; unattended is denied.
    expect(authorize(intent(1_000, { pactId: "p2" }), [m], [], NOW)).toEqual({
      outcome: "needs_approval",
      reasons: ["no_mandate"],
    });
    expect(authorize(intent(1_000), [m], [], NOW).outcome).toBe("needs_approval");
    expect(
      authorize(intent(1_000, { pactId: "p2", initiatedBy: "schedule" }), [m], [], NOW),
    ).toEqual({ outcome: "deny", reasons: ["no_mandate"] });
  });

  it("property: a pact-scoped mandate never allows a spend outside its pact", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.option(fc.constantFrom("p2", "p3"), { nil: undefined }),
        fc.constantFrom("user", "agent", "schedule") as fc.Arbitrary<SpendIntent["initiatedBy"]>,
        (a, pactId, initiatedBy) => {
          const d = authorize(
            intent(a, { initiatedBy, ...(pactId ? { pactId } : {}) }),
            [mandate({ pactId: "p1" })],
            [],
            NOW,
          );
          expect(d.outcome).not.toBe("allow");
        },
      ),
    );
  });

  it("prefers the pact-scoped mandate over a global one", () => {
    const d = authorize(
      intent(1_000, { pactId: "p1" }),
      [mandate({ id: "global" }), mandate({ id: "scoped", pactId: "p1" })],
      [],
      NOW,
    );
    expect(d).toEqual({ outcome: "allow", mandateId: "scoped" });
  });

  it("requires step-up at the threshold", () => {
    const d = authorize(
      intent(5_000),
      [mandate({ stepUpAbove: { amountMinor: 5_000, currency: "USD" } })],
      [],
      NOW,
    );
    expect(d).toMatchObject({ outcome: "needs_approval", reasons: ["step_up_required"] });
  });

  it("counts only the rolling period for periodic mandates", () => {
    const m = mandate({ period: "week", maxTotal: { amountMinor: 10_000, currency: "USD" } });
    const ledger: LedgerEntry[] = [
      { mandateId: "m1", amountMinor: 9_000, currency: "USD", at: "2026-10-20T00:00:00Z" },
      { mandateId: "m1", amountMinor: 6_000, currency: "USD", at: "2026-11-04T00:00:00Z" },
    ];
    expect(authorize(intent(4_000), [m], ledger, NOW).outcome).toBe("allow");
    expect(authorize(intent(4_001), [m], ledger, NOW)).toMatchObject({ reasons: ["over_period"] });
  });

  it("property: unattended spending never exceeds caps or totals", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 20_000 }), { maxLength: 30 }), (amounts) => {
        const m = mandate();
        const ledger: LedgerEntry[] = [];
        for (const a of amounts) {
          const d = authorize(intent(a, { initiatedBy: "schedule" }), [m], ledger, NOW);
          if (d.outcome === "allow") {
            expect(a).toBeLessThanOrEqual(m.maxPerCharge.amountMinor);
            ledger.push({
              mandateId: m.id,
              amountMinor: a,
              currency: "USD",
              at: NOW.toISOString(),
            });
          } else {
            expect(d.outcome).toBe("deny");
          }
        }
        const total = ledger.reduce((s, e) => s + e.amountMinor, 0);
        expect(total).toBeLessThanOrEqual(m.maxTotal.amountMinor);
      }),
    );
  });

  it("property: revoked or expired mandates never allow", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), fc.boolean(), (a, revoked) => {
        const m = revoked
          ? mandate({ status: "revoked" })
          : mandate({ validUntil: "2026-11-02T00:00:00Z" });
        expect(authorize(intent(a), [m], [], NOW).outcome).not.toBe("allow");
      }),
    );
  });
});

describe("splitEqual", () => {
  it("splits evenly and pushes overflow past low caps", () => {
    const s = splitEqual(45_000, [
      { userId: "a", capMinor: 16_000 },
      { userId: "b", capMinor: 10_000 },
      { userId: "c", capMinor: 20_000 },
    ]);
    expect(s && Object.fromEntries(s)).toEqual({ a: 16_000, b: 10_000, c: 19_000 });
  });

  it("returns null when caps can't cover the total", () => {
    expect(
      splitEqual(100, [
        { userId: "a", capMinor: 40 },
        { userId: "b", capMinor: 50 },
      ]),
    ).toBeNull();
  });

  it("property: sums to the total and respects every cap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 500_000 }), { minLength: 1, maxLength: 20 }),
        (total, caps) => {
          const members = caps.map((capMinor, i) => ({ userId: `u${i}`, capMinor }));
          const s = splitEqual(total, members);
          const capacity = caps.reduce((a, b) => a + b, 0);
          if (capacity < total) {
            expect(s).toBeNull();
            return;
          }
          expect(s).not.toBeNull();
          let sum = 0;
          for (const m of members) {
            const share = s?.get(m.userId) ?? -1;
            expect(share).toBeGreaterThanOrEqual(0);
            expect(share).toBeLessThanOrEqual(m.capMinor);
            sum += share;
          }
          expect(sum).toBe(total);
        },
      ),
    );
  });
});

describe("splitWeighted", () => {
  it("splits two thirds / one third exactly", () => {
    const parts = splitWeighted(12_900, [
      { userId: "a", weight: 2, capMinor: 10_000 },
      { userId: "b", weight: 1, capMinor: 5_000 },
    ]);
    expect(Object.fromEntries(parts ?? [])).toEqual({ a: 8_600, b: 4_300 });
  });

  it("moves the excess off a capped member, by weight", () => {
    const parts = splitWeighted(9_000, [
      { userId: "a", weight: 1, capMinor: 1_000 },
      { userId: "b", weight: 1, capMinor: 10_000 },
      { userId: "c", weight: 2, capMinor: 10_000 },
    ]);
    expect(Object.fromEntries(parts ?? [])).toEqual({ a: 1_000, b: 2_667, c: 5_333 });
  });

  it("returns null when caps can't cover the total", () => {
    expect(splitWeighted(100, [{ userId: "a", weight: 1, capMinor: 99 }])).toBeNull();
  });

  it("always sums to the total and respects caps (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(
          fc.record({
            weight: fc.integer({ min: 1, max: 10 }),
            capMinor: fc.integer({ min: 0, max: 500_000 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (total, raw) => {
          const members = raw.map((m, i) => ({ ...m, userId: `u${i}` }));
          const parts = splitWeighted(total, members);
          const capacity = members.reduce((s, m) => s + m.capMinor, 0);
          if (capacity < total) return parts === null;
          if (!parts) return false;
          const sum = [...parts.values()].reduce((s, v) => s + v, 0);
          return sum === total && members.every((m) => (parts.get(m.userId) ?? 0) <= m.capMinor);
        },
      ),
    );
  });
});
