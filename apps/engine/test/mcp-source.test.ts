import { type Arm, signPassport } from "@pact/protocol";
import { expect, it } from "vitest";
import { app } from "../src/index";
import { call, e, PRICE, seedExperiment, WINIX } from "./helpers";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON responses
type Json = Record<string, any>;

const usd = (minor: number) => ({ currency_code: "USD", value: (minor / 100).toFixed(2) });
let seq = 0;

/** One public /mcp checkout as PayPal reports it: order completed, then capture completed. */
async function mcpSale(sessionId: string, arm: Arm) {
  const n = ++seq;
  const passport = await signPassport(
    {
      v: 1,
      sessionId,
      arm,
      creatorsSeen: arm === "none" ? [] : ["housefresh"],
      storesViewed: ["lumen"],
    },
    "test-passport-key",
  );
  const post = (event: unknown) =>
    app.request("/webhooks/paypal", { method: "POST", body: JSON.stringify(event) }, e);
  await post({
    id: `WH-MCP-O-${n}`,
    event_type: "CHECKOUT.ORDER.COMPLETED",
    resource: {
      id: `O-MCP-${n}`,
      status: "COMPLETED",
      purchase_units: [
        {
          reference_id: "lumen",
          custom_id: passport,
          payee: { merchant_id: "lumen" },
          items: [{ name: "Winix", quantity: "1", unit_amount: usd(PRICE), upc: { code: WINIX } }],
        },
      ],
    },
  });
  await post({
    id: `WH-MCP-C-${n}`,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: `C-MCP-${n}`,
      status: "COMPLETED",
      amount: usd(PRICE),
      custom_id: passport,
      create_time: "2026-11-02T10:00:00Z",
      supplementary_data: { related_ids: { order_id: `O-MCP-${n}` } },
    },
  });
}

it("records public /mcp sales apart: the study's numbers and ledger do not move", async () => {
  await call("POST", "/brands", {
    brandId: "winix",
    name: "Winix",
    category: "purifier",
    upc: WINIX,
  });
  await call("POST", "/creators", { creatorId: "housefresh", name: "HouseFresh" });
  await call("POST", "/brands/winix/deposits", { amountMinor: 100_000 });
  await seedExperiment();

  await mcpSale("mcp_aaaaaaaaaaaaaaaa", "test");
  await mcpSale("mcp_bbbbbbbbbbbbbbbb", "placebo");
  await mcpSale("mcp_cccccccccccccccc", "none");

  const row = await e.DB.prepare(
    "SELECT source, arm FROM sales WHERE capture_id = 'C-MCP-1'",
  ).first<Json>();
  expect(row).toEqual({ source: "mcp", arm: "test" });

  const lift = await call<Json>("GET", "/lift/winix");
  expect(lift.json.exposedSales).toBe(57);
  expect(lift.json.causedUnits).toBe(51);
  const rec = await call<Json>("POST", "/credits/recompute");
  expect(rec.json.created).toBe(51);
  const credits = await call<Json>("GET", "/credits");
  expect(credits.json.creators[0].totals).toEqual({
    pending: 39_164,
    voided: 0,
    paid: 0,
    frozen: 0,
    held: 0,
  });

  const study = await call<Json>("GET", "/journeys?limit=200");
  expect(study.json.journeys.some((j: Json) => String(j.orderId).startsWith("O-MCP"))).toBe(false);

  const mcp = await call<Json>("GET", "/journeys?source=mcp");
  const byArm = Object.fromEntries(mcp.json.journeys.map((j: Json) => [j.arm, j]));
  expect(mcp.json.journeys).toHaveLength(3);
  expect(byArm.test).toMatchObject({
    source: "mcp",
    storeChosen: "lumen",
    verdict: { creditable: true },
    commission: { pending: 0, paid: 0, voided: 0 },
  });
  expect(byArm.placebo.verdict.creditable).toBe(false);
  expect(byArm.none.verdict.creditable).toBe(false);

  // Paging: offset moves through the same newest-first list; absent offset is unchanged.
  const ids = mcp.json.journeys.map((j: Json) => j.orderId);
  const p0 = await call<Json>("GET", "/journeys?source=mcp&limit=2&offset=0");
  const p1 = await call<Json>("GET", "/journeys?source=mcp&limit=2&offset=2");
  expect(p0.json.journeys.map((j: Json) => j.orderId)).toEqual(ids.slice(0, 2));
  expect(p1.json.journeys.map((j: Json) => j.orderId)).toEqual(ids.slice(2, 4));
});
