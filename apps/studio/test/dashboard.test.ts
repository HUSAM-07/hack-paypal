import { describe, expect, it } from "vitest";
import { buildDashboard } from "../src/index";
import { raw } from "./fixture";

describe("buildDashboard", () => {
  const d = buildDashboard(raw);
  const winix = d.brands.find((b) => b.brandId === "winix");

  it("reports caused units, arm shares and the ledger per brand", () => {
    expect(winix?.causedUnits).toBe(2);
    expect(winix?.arms.map((a) => [a.arm, a.share])).toEqual([
      ["test", 1],
      ["placebo", 0.25],
      ["none", 0],
    ]);
    expect(winix).toMatchObject({ credited: 768 + 500 + 268, voided: 768, paid: 768 });
    expect(winix?.deposit).toMatchObject({ initial: 100000, topUps: 50000, returned: 99232 });
  });

  it("gives a brand without deposits or credits zeros, not gaps", () => {
    const levoit = d.brands.find((b) => b.brandId === "levoit");
    expect(levoit).toMatchObject({ causedUnits: 0, paid: 0, deposit: { deposited: 0 } });
  });

  it("splits co-exposed sales across every creator and keeps void reasons", () => {
    const hf = d.creators.find((c) => c.creatorId === "housefresh");
    expect(hf?.credits.find((x) => x.captureId === "C2")?.split.map((s) => s.name)).toEqual([
      "HouseFresh",
      "Other Lab",
    ]);
    expect(hf?.credits.find((x) => x.state === "voided")?.voidReason).toBe("refund");
  });

  it("turns a cross-store journey into priced hops", () => {
    expect(d.journeys[0]).toMatchObject({
      product: "Winix",
      hops: [
        { shop: "northwind", priceMinor: 9999 },
        { shop: "lumen", priceMinor: 9599 },
      ],
      commissionMinor: 768,
      shares: [{ name: "HouseFresh", amountMinor: 768 }],
    });
  });
});
