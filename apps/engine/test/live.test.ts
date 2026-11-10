import { LIVE_CATEGORY } from "@pact/protocol";
import { expect, it } from "vitest";
import { call, e, PRICE, seedExperiment, WINIX } from "./helpers";

type Json = Record<string, any>;

it("live runs' sales are joined but never touch a programme's lift, ledger or journeys", async () => {
  await call("POST", "/brands", {
    brandId: "winix",
    name: "Winix",
    category: "purifier",
    upc: WINIX,
  });
  await call("POST", "/creators", { creatorId: "housefresh", name: "HouseFresh" });
  await call("POST", "/brands/winix/deposits", { amountMinor: 100_000 });
  await seedExperiment();

  // A live exposed Winix sale, captured before every demo sale, so it would be first in line.
  await call("POST", "/sessions", {
    sessionId: "live-abc",
    model: "claude-sonnet-5-5",
    arm: "test",
    category: LIVE_CATEGORY,
    creatorsSeen: ["housefresh"],
  });
  await e.DB.prepare(
    `INSERT INTO sales (capture_id, upc, order_id, shop_id, amount_minor, currency, session_id,
       arm, creators_seen, model, captured_at)
     VALUES ('CAP-LIVE', ?, 'ORD-LIVE', 'lumen', ?, 'USD', 'live-abc', 'test', '["housefresh"]',
       'claude-sonnet-5-5', '2026-10-01T00:00:00Z')`,
  )
    .bind(WINIX, PRICE)
    .run();

  const lift = await call<Json>("GET", "/lift/winix");
  expect(lift.json.exposedSales).toBe(57);
  expect(lift.json.causedUnits).toBe(51);

  const rec = await call<Json>("POST", "/credits/recompute");
  expect(rec.json.created).toBe(51);
  const live = await e.DB.prepare(
    "SELECT COUNT(*) AS n FROM credits WHERE capture_id = 'CAP-LIVE'",
  ).first<{ n: number }>();
  expect(live?.n).toBe(0);

  const j = await call<Json>("GET", "/journeys?limit=200");
  expect(j.json.journeys.some((x: Json) => x.orderId === "ORD-LIVE")).toBe(false);
});
