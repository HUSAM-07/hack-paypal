import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { getPayPal } from "../src/paypal";
import { call, e, LEVOIT, seedExperiment, WINIX } from "./helpers";

type Json = Record<string, any>;

let seq = 0;
const refundEvent = (captureId: string, value: string) =>
  app.request(
    "/webhooks/paypal",
    {
      method: "POST",
      body: JSON.stringify({
        id: `WH-R-${++seq}`,
        event_type: "PAYMENT.CAPTURE.REFUNDED",
        resource: {
          id: `REF-${seq}`,
          status: "COMPLETED",
          amount: { currency_code: "USD", value },
          links: [{ rel: "up", href: `https://api.paypal.com/v2/payments/captures/${captureId}` }],
        },
      }),
    },
    e,
  );

describe("refunds, top-ups and access", () => {
  it("a refund voids one pending credit; a refund after payout only flags it", async () => {
    await call("POST", "/brands", {
      brandId: "winix",
      name: "Winix",
      category: "purifier",
      upc: WINIX,
    });
    await call("POST", "/brands", {
      brandId: "levoit",
      name: "Levoit",
      category: "purifier",
      upc: LEVOIT,
    });
    await call("POST", "/creators", {
      creatorId: "housefresh",
      name: "HouseFresh",
      paypalId: "HOUSEFRESH-PP",
    });
    await call("POST", "/brands/winix/deposits", { amountMinor: 100_000 });
    await seedExperiment();
    await call("POST", "/credits/recompute");

    const credits = (await call<Json>("GET", "/credits")).json.creators[0].credits as Json[];
    const [first, second] = credits;
    expect((await refundEvent(first?.captureId, "95.99")).status).toBe(200);

    const after = (await call<Json>("GET", "/credits")).json.creators[0];
    expect(after.credits.filter((c: Json) => c.state === "voided")).toHaveLength(1);
    expect(after.credits.find((c: Json) => c.id === first?.id)).toMatchObject({
      state: "voided",
      voidReason: "refund",
    });
    expect(after.totals.voided).toBe(first?.amountMinor);
    expect(after.totals.pending).toBe(39_164 - first?.amountMinor);

    // Pay at day 30: the voided credit is not paid, and its money goes back with the rest.
    await call("POST", "/clock/advance", { to: "2026-12-02T00:00:00.000Z" });
    const paid = (await call<Json>("GET", "/credits")).json.creators[0].totals;
    expect(paid.paid).toBe(39_164 - first?.amountMinor);
    const close = (await call<Json>("POST", "/cycle/close", { brandIds: ["winix"] })).json
      .brands[0];
    expect(close.returnedNow).toBe(100_000 - paid.paid);

    // A refund that lands after the credit was paid cannot claw it back: it is flagged for a person.
    await refundEvent(second?.captureId, "95.99");
    const flagged = await call<Json>("GET", "/credits");
    expect(flagged.json.creators[0].credits.find((c: Json) => c.id === second?.id).state).toBe(
      "paid",
    );
    expect(flagged.json.reviewFlags).toMatchObject([{ creditId: second?.id, reason: "refund" }]);
  });

  it("an approved top-up adds a deposit once, however often it is approved", async () => {
    const approve = () =>
      call<Json>("POST", "/approvals/ap-1/approve", { brandId: "levoit", amountMinor: 50_000 });
    expect((await call("POST", "/brands/levoit/deposits", { amountMinor: 100_000 })).status).toBe(
      201,
    );
    const a = await approve();
    const b = await approve();
    expect(a.status).toBe(201);
    expect(b.json.captureId).toBe(a.json.captureId);
    const levoit = (await call<Json>("GET", "/deposits")).json.brands.find(
      (x: Json) => x.brandId === "levoit",
    );
    expect(levoit).toMatchObject({ deposited: 150_000, available: 150_000 });
    expect(levoit.deposits.map((d: Json) => d.kind)).toEqual(["initial", "topup"]);
    expect(getPayPal(e).mock?.state.captures.size).toBe(3);

    // A refund spans deposits when it must: the whole 150,000 comes back across both captures.
    const close = (await call<Json>("POST", "/cycle/close", { brandIds: ["levoit"] })).json
      .brands[0];
    expect(
      close.refunds.map((r: Json) => r.amountMinor).sort((a: number, b: number) => a - b),
    ).toEqual([50_000, 100_000]);
  });

  it("needs the API token when one is set, and refuses to run open outside simulated mode", async () => {
    const withToken = { ...e, ENGINE_API_TOKEN: "s3cret" };
    expect((await app.request("/api/clock", {}, withToken)).status).toBe(401);
    const ok = await app.request(
      "/api/clock",
      { headers: { authorization: "Bearer s3cret" } },
      withToken,
    );
    expect(ok.status).toBe(200);
    expect((await app.request("/api/clock", {}, { ...e, PAYPAL_MODE: "sandbox" })).status).toBe(
      503,
    );
  });
});
