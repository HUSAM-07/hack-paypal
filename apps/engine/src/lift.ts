import { type BrandCredit, creditBrand, type ModelCounts } from "@pact/attribution";
import type { Arm } from "@pact/protocol";
import type { Env } from "./env";
import type { Brand } from "./programme";

export interface BrandLiftData {
  brand: Brand;
  /** Sessions per arm in the brand's category (all models) and how many bought the SKU. */
  arms: Record<Arm, { sessions: number; purchases: number }>;
  strata: ModelCounts[];
  /** Captured sales of the brand's SKU made by exposed-arm sessions. */
  exposedSales: number;
}

type Row = Record<string, unknown>;

/** Arm counts for one brand: sessions in its category and the ones that bought its SKU. */
export async function brandLiftData(env: Env, brand: Brand): Promise<BrandLiftData> {
  const sessions = (
    await env.DB.prepare(
      `SELECT model, arm, COUNT(*) AS n FROM agent_sessions
       WHERE category = ? AND arm IS NOT NULL GROUP BY model, arm`,
    )
      .bind(brand.category)
      .all<Row>()
  ).results;
  const buyers = (
    await env.DB.prepare(
      `SELECT s.model AS model, s.arm AS arm, COUNT(DISTINCT s.session_id) AS n
       FROM sales x JOIN agent_sessions s ON s.session_id = x.session_id
       WHERE x.upc = ? AND s.category = ? AND x.unattributed_reason IS NULL
       GROUP BY s.model, s.arm`,
    )
      .bind(brand.upc, brand.category)
      .all<Row>()
  ).results;
  const exposed = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sales x JOIN agent_sessions s ON s.session_id = x.session_id
     WHERE x.upc = ? AND s.category = ? AND s.arm = 'test' AND x.unattributed_reason IS NULL`,
  )
    .bind(brand.upc, brand.category)
    .first<{ n: number }>();

  const arms: BrandLiftData["arms"] = {
    test: { sessions: 0, purchases: 0 },
    placebo: { sessions: 0, purchases: 0 },
    none: { sessions: 0, purchases: 0 },
  };
  const byModel = new Map<string, ModelCounts>();
  const slot = (model: string) => {
    let m = byModel.get(model);
    if (!m) {
      m = { model, exposed: { sessions: 0, purchases: 0 }, placebo: { sessions: 0, purchases: 0 } };
      byModel.set(model, m);
    }
    return m;
  };
  const tally = (rows: Row[], field: "sessions" | "purchases") => {
    for (const r of rows) {
      const arm = r.arm as Arm;
      if (!(arm in arms)) continue;
      const n = r.n as number;
      arms[arm][field] += n;
      if (arm === "test") slot(r.model as string).exposed[field] += n;
      if (arm === "placebo") slot(r.model as string).placebo[field] += n;
    }
  };
  tally(sessions, "sessions");
  tally(buyers, "purchases");
  const strata = [...byModel.values()].sort((a, b) => (a.model < b.model ? -1 : 1));
  return { brand, arms, strata, exposedSales: exposed?.n ?? 0 };
}

/** Lift → attributable fraction at the 80% bound → whole caused units (price only sizes the commission). */
export function evaluateBrand(data: BrandLiftData, unitPriceMinor = 0): BrandCredit {
  return creditBrand({
    strata: data.strata,
    exposedSales: data.exposedSales,
    unitPrice: { amountMinor: unitPriceMinor, currency: data.brand.currency },
  });
}
