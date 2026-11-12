import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { CITED_TABLES, PRESERVED_TABLES, snapshotSql } from "../scripts/cited-snapshot-sql.mjs";
import { checkCited, LOCKED } from "../scripts/verify-cited.mjs";

const DB = (env as unknown as { DB: D1Database }).DB;

/** Pact's own tables, and the shop's (0011): the reseed must never name them. */
const PACT_TABLES = [
  "users",
  "auth_challenges",
  "threads",
  "thread_members",
  "paypal_webhook_events",
  "paypal_refs",
  "shop_oauth_accounts",
  "shop_watch_index",
  "shop_orders",
];

/** Runs a snapshot file the way `d1 execute --file` does: every statement, one batch. */
async function apply(sql: string) {
  const statements = sql
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("--"))
    .map((l) => DB.prepare(l));
  await DB.batch(statements);
}

async function count(table: string): Promise<number> {
  const row = await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("hosted reseed snapshot", () => {
  beforeAll(async () => {
    await DB.batch([
      DB.prepare(
        "INSERT INTO users (id, username, display_name, created_at) VALUES ('u-keep', 'keep', 'Keep me', '2026-01-01')",
      ),
      DB.prepare(
        "INSERT INTO brands (brand_id, name, category, upc) VALUES ('old', 'Old', 'x', '1')",
      ),
      DB.prepare("INSERT INTO cited_agent_runs (record) VALUES ('{\"old\":true}')"),
    ]);
  });

  it("lists every table that is not Pact's", async () => {
    const { results } = await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    ).all<{ name: string }>();
    const cited = results
      .map((r) => r.name)
      .filter((n) => !PACT_TABLES.includes(n) && !PRESERVED_TABLES.includes(n));
    // A new CITED migration table must join the snapshot, or a reseed would leave stale rows.
    expect([...cited].sort()).toEqual([...CITED_TABLES].sort());
  });

  it("replaces the CITED rows and never touches Pact's", async () => {
    const sql = snapshotSql({
      brands: [{ brand_id: "winix", name: "Winix's", category: "purifier", upc: "100000000001" }],
      cited_agent_runs: [{ record: '{"sessionId":"s1"}' }],
    });
    for (const t of PACT_TABLES) expect(sql).not.toMatch(new RegExp(`\\b${t}\\b`));
    expect(sql).not.toMatch(/BEGIN|COMMIT/);
    await apply(sql);
    expect(await count("users")).toBe(1);
    const brands = await DB.prepare("SELECT brand_id, name FROM brands").all();
    expect(brands.results).toEqual([{ brand_id: "winix", name: "Winix's" }]);
    expect(await count("cited_agent_runs")).toBe(1);
  });

  it("refuses a non-CITED table", () => {
    expect(() => snapshotSql({ users: [{ id: "x" }] })).toThrow(/non-CITED/);
  });
});

describe("hosted data check", () => {
  const good = {
    lift: {
      brands: [
        { brandId: "winix", causedUnits: 62, exposedSales: 69 },
        { brandId: "levoit", causedUnits: 0, exposedSales: 0 },
        { brandId: "roborock", causedUnits: 3, exposedSales: 6 },
        { brandId: "bose", causedUnits: 3, exposedSales: 6 },
      ],
    },
    payouts: {
      batches: [
        { senderBatchId: "a", status: "SUCCESS", createdAt: "1", items: [{ amountMinor: 38396 }] },
        { senderBatchId: "b", status: "SUCCESS", createdAt: "2", items: [{ amountMinor: 7679 }] },
        { senderBatchId: "c", status: "SUCCESS", createdAt: "3", items: [{ amountMinor: 768 }] },
      ],
    },
    invoices: {
      statements: [
        { brandId: "winix", paidMinor: 38396, status: "MARKED_AS_PAID" },
        { brandId: "levoit", paidMinor: 0, status: "NO_CHARGE" },
      ],
    },
    flags: { flags: [{ status: "open", credit: { amountMinor: 768 } }] },
  };

  it("passes the locked numbers", () => {
    expect(LOCKED.programmePaidMinor).toBe(46843);
    expect(checkCited(good)).toEqual([]);
  });

  it("fails when a funded vacuum or headphone programme measured no lift", () => {
    const flat = {
      ...good,
      lift: {
        brands: good.lift.brands.map((b) => (b.brandId === "bose" ? { ...b, causedUnits: 0 } : b)),
      },
    };
    expect(checkCited(flat).join("\n")).toMatch(/bose caused units: got 0, want more than 0/);
  });

  it("fails an empty ledger loudly", () => {
    const problems = checkCited({
      lift: { brands: [] },
      payouts: { batches: [] },
      invoices: { statements: [] },
      flags: { flags: [] },
    });
    expect(problems.join("\n")).toMatch(/winix caused units: got undefined, want 62/);
    expect(problems.join("\n")).toMatch(/programme to date: got 0, want 46843/);
  });
});
