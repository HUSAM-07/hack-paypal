import { env } from "cloudflare:workers";
import type { Env } from "../src/env";
import { app } from "../src/index";

export const e = env as unknown as Env;

export async function call<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await app.request(
    `/api${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    },
    e,
  );
  return { status: res.status, json: (await res.json()) as T };
}

export const WINIX = "012345678905";
export const LEVOIT = "012345678912";
export const PRICE = 9599; // $95.99 at Lumen
const MODELS = ["gpt", "gemini", "sonnet"] as const;

/**
 * Seed the pre-registered purifier experiment's shape: 56 exposed / 54 placebo / 36 held-out
 * sessions across three models. Winix buyers are 5+18+18 exposed and 2+7+7 placebo, which
 * the lift maths turns into 51% of 200 exposed sales = 102 caused units.
 */
export async function seedExperiment(): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  const session = (id: string, model: string, arm: string) =>
    stmts.push(
      e.DB.prepare(
        `INSERT INTO agent_sessions (session_id, model, created_at, arm, category, creators_seen, stores_viewed)
         VALUES (?, ?, ?, ?, 'purifier', ?, '["northwind","lumen"]')`,
      ).bind(id, model, "2026-11-01T09:00:00Z", arm, arm === "test" ? '["housefresh"]' : "[]"),
    );
  const sale = (n: number, session: string, model: string, arm: string, upc: string) =>
    stmts.push(
      e.DB.prepare(
        `INSERT INTO sales (capture_id, upc, order_id, shop_id, amount_minor, currency, session_id,
           arm, creators_seen, model, captured_at)
         VALUES (?, ?, ?, 'lumen', ?, 'USD', ?, ?, ?, ?, '2026-11-01T10:00:00Z')`,
      ).bind(
        `CAP-${String(n).padStart(4, "0")}`,
        upc,
        `ORD-${String(n).padStart(4, "0")}`,
        PRICE,
        session,
        arm,
        arm === "test" ? '["housefresh"]' : "[]",
        model,
      ),
    );

  const exposedSessions = [19, 19, 18];
  const placeboSessions = [18, 18, 18];
  const winixExposed = [5, 18, 18];
  const winixPlacebo = [2, 7, 7];
  let n = 0;
  let exposedBuyers = 0;
  MODELS.forEach((model, m) => {
    for (let i = 0; i < (exposedSessions[m] as number); i++) {
      const id = `x-${model}-${i}`;
      session(id, model, "test");
      if (i < (winixExposed[m] as number)) exposedBuyers++;
    }
    for (let i = 0; i < (placeboSessions[m] as number); i++) {
      const id = `p-${model}-${i}`;
      session(id, model, "placebo");
      if (i < (winixPlacebo[m] as number)) sale(++n, id, model, "placebo", WINIX);
      else sale(++n, id, model, "placebo", i % 2 ? LEVOIT : LEVOIT); // the rest buy the rival
    }
    for (let i = 0; i < 12; i++) session(`n-${model}-${i}`, model, "none");
  });
  // 200 exposed Winix sales spread over the 41 exposed Winix buyers (36×5 + 5×4).
  let k = 0;
  MODELS.forEach((model, m) => {
    for (let i = 0; i < (winixExposed[m] as number); i++) {
      const count = k++ < 36 ? 5 : 4;
      for (let j = 0; j < count; j++) sale(++n, `x-${model}-${i}`, model, "test", WINIX);
    }
  });
  // Exposed sessions that did not buy Winix bought the rival.
  MODELS.forEach((model, m) => {
    for (let i = winixExposed[m] as number; i < (exposedSessions[m] as number); i++)
      sale(++n, `x-${model}-${i}`, model, "test", LEVOIT);
  });
  expectLength(exposedBuyers, 41);
  for (let i = 0; i < stmts.length; i += 50) await e.DB.batch(stmts.slice(i, i + 50));
}

function expectLength(got: number, want: number): void {
  if (got !== want) throw new Error(`seed drifted: ${got} != ${want}`);
}
