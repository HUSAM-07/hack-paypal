import { MS_PER_DAY } from "@pact/attribution";
import type { Env } from "./env";

/** The engine's "now": the demo clock if it has been set, else the real clock. */
export async function nowOf(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT now FROM clock WHERE id = 1").first<{ now: string }>();
  return row?.now ?? new Date().toISOString();
}

/** Move the demo clock forward (never back). Starts from the real time if unset. */
export async function advanceClock(
  env: Env,
  by: { days: number } | { to: string },
): Promise<string> {
  const current = new Date(await nowOf(env)).getTime();
  const next = "days" in by ? current + by.days * MS_PER_DAY : new Date(by.to).getTime();
  if (!Number.isFinite(next) || next < current) throw new Error("the clock only moves forward");
  const iso = new Date(next).toISOString();
  await env.DB.prepare(
    "INSERT INTO clock (id, now) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET now = excluded.now",
  )
    .bind(iso)
    .run();
  return iso;
}
