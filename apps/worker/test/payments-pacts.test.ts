import type { Pact } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import {
  capProblem,
  commitMember,
  mandateFor,
  maskEmail,
  nextRuns,
  type PactRefData,
  splitShares,
} from "../src/payments/pacts";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

function data(over: Partial<Pact> = {}): PactRefData {
  const pact: Pact = {
    id: "pact_test1234",
    threadId: "thr_test1234",
    title: "Gift",
    instruction: "split it",
    organizerId: "usr_a",
    members: [
      { userId: "usr_a", displayName: "A", role: "organizer", cap: usd(5_000), status: "invited" },
      { userId: "usr_b", displayName: "B", role: "member", cap: usd(5_000), status: "invited" },
    ],
    trigger: { kind: "manual" },
    action: { kind: "collect", total: usd(9_001) },
    split: { kind: "equal" },
    state: "draft",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
  return {
    pact,
    total: usd(9_001),
    shares: [
      { userId: "usr_a", share: usd(4_501) },
      { userId: "usr_b", share: usd(4_500) },
    ],
  };
}

describe("capProblem", () => {
  it("accepts share ≤ cap ≤ total", () => {
    expect(capProblem(data(), "usr_a", usd(4_501))).toBeNull();
    expect(capProblem(data(), "usr_a", usd(9_001))).toBeNull();
  });
  it.each([
    [usd(4_500), "cap_below_share"],
    [usd(9_002), "cap_above_total"],
    [{ amountMinor: 5_000, currency: "EUR" }, "currency_mismatch"],
  ] as const)("%o → %s", (cap, problem) => {
    expect(capProblem(data(), "usr_a", cap)).toBe(problem);
  });
  it("rejects non-members and closed pacts", () => {
    expect(capProblem(data(), "usr_z", usd(5_000))).toBe("not_a_member");
    expect(capProblem(data({ state: "done" }), "usr_a", usd(5_000))).toBe("pact_closed");
  });
});

describe("mandateFor", () => {
  const base = { id: "mnd_1", userId: "usr_a", cap: usd(4_501), now: NOW };
  it("allows a single charge up to the cap for one-shot pacts", () => {
    const m = mandateFor({ ...base, pact: data().pact });
    expect(m).toMatchObject({
      pactId: "pact_test1234",
      maxPerCharge: usd(4_501),
      maxTotal: usd(4_501),
      maxCharges: 1,
      period: "none",
    });
    expect(Date.parse(m.validUntil) - NOW.getTime()).toBe(90 * 86_400_000);
  });
  it("expires a day after a price watch's deadline", () => {
    const pact = data({
      trigger: {
        kind: "price",
        productRef: "product_x123",
        maxPrice: usd(1),
        deadline: "2026-11-10T00:00:00.000Z",
      },
    }).pact;
    expect(mandateFor({ ...base, pact }).validUntil).toBe("2026-11-11T00:00:00.000Z");
  });
  it("covers every run of a bounded schedule", () => {
    const pact = data({
      trigger: { kind: "schedule", everyDays: 7, startAt: NOW.toISOString(), maxRuns: 4 },
    }).pact;
    expect(mandateFor({ ...base, pact })).toMatchObject({
      maxTotal: usd(18_004),
      maxCharges: 4,
      period: "none",
    });
  });
  it("uses a rolling period for an open-ended schedule", () => {
    const pact = data({
      trigger: { kind: "schedule", everyDays: 3, startAt: NOW.toISOString() },
    }).pact;
    const m = mandateFor({ ...base, pact });
    expect(m).toMatchObject({ period: "week", maxTotal: usd(4_501 * 3) });
    expect(m.maxCharges).toBeUndefined();
  });
});

describe("commitMember", () => {
  it("re-splits under the new cap and arms once everyone is in", () => {
    const one = commitMember(data(), "usr_a", { cap: usd(9_001), mandateId: "mnd_a" }, NOW);
    expect(one?.pact.state).toBe("collecting");
    const two = commitMember(
      one as PactRefData,
      "usr_b",
      { cap: usd(4_500), mandateId: "mnd_b" },
      NOW,
    );
    expect(two?.pact.state).toBe("armed");
    expect(two?.shares?.reduce((s, x) => s + x.share.amountMinor, 0)).toBe(9_001);
    expect(two?.pact.members.map((m) => m.mandateId)).toEqual(["mnd_a", "mnd_b"]);
  });
  it("keeps watch/product/nextRuns and the weighted split when re-splitting", () => {
    const d = {
      ...data({ split: { kind: "weights", weights: { usr_a: 2, usr_b: 1 } } }),
      nextRuns: ["2026-11-02T17:00:00.000Z"],
    };
    const next = commitMember(d, "usr_a", { cap: usd(9_001), mandateId: "mnd_a" }, NOW);
    expect(next?.nextRuns).toEqual(["2026-11-02T17:00:00.000Z"]);
    expect(next?.shares).toEqual([
      { userId: "usr_a", share: usd(6_001) },
      { userId: "usr_b", share: usd(3_000) },
    ]);
  });
  it("returns null when caps can no longer cover the total", () => {
    const d = data();
    d.pact.members[1] = { ...(d.pact.members[1] as Pact["members"][number]), cap: usd(1) };
    expect(commitMember(d, "usr_a", { cap: usd(4_501), mandateId: "mnd_a" }, NOW)).toBeNull();
  });
});

it("maskEmail keeps just enough to recognise the account", () => {
  expect(maskEmail("jane@example.com")).toBe("j•••@example.com");
  expect(maskEmail(undefined)).toBeUndefined();
  expect(maskEmail("nope")).toBeUndefined();
});

describe("splitShares", () => {
  it("honours fixed amounts only when they cover the total within caps", () => {
    const fixed = data({
      split: { kind: "fixed", amounts: { usr_a: usd(5_000), usr_b: usd(4_001) } },
    });
    expect(splitShares(fixed.pact, usd(9_001))?.map((s) => s.share.amountMinor)).toEqual([
      5_000, 4_001,
    ]);
    expect(splitShares(fixed.pact, usd(9_002))).toBeNull();
  });
});

describe("nextRuns", () => {
  const t = { kind: "schedule" as const, everyDays: 21, startAt: "2026-11-05T17:00:00.000Z" };
  it("lists upcoming runs from the start, skipping past ones", () => {
    expect(nextRuns(t, NOW, 3)).toEqual([
      "2026-11-05T17:00:00.000Z",
      "2026-11-26T17:00:00.000Z",
      "2026-12-17T17:00:00.000Z",
    ]);
    expect(nextRuns(t, new Date("2026-11-20T00:00:00Z"), 1)).toEqual(["2026-11-26T17:00:00.000Z"]);
  });
  it("stops at maxRuns and endAt", () => {
    expect(nextRuns({ ...t, maxRuns: 2 }, NOW)).toHaveLength(2);
    expect(nextRuns({ ...t, endAt: "2026-11-30T00:00:00.000Z" }, NOW)).toHaveLength(2);
  });
});
