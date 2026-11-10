/**
 * Keeps AG Studio's tables in step with the CITED engine. The page polls /studio/api/data; each
 * change becomes one transaction per table (add, update, remove by row id), so every widget
 * reading a changed table updates in place, with no reload. That is how a refund's void, a
 * payout batch or Maya's top-up appears on screen during the demo.
 */
import type { StudioTables, TableId, TableMeta } from "@cited/studio/tables";

export type Row = Record<string, string | number | boolean | null>;
export type { StudioTables, TableId, TableMeta };

export interface StudioConfig {
  licenseKey: string;
  gridLicenseKey: string;
  llm: { kind: "gateway" | "anthropic" | "scripted"; label: string };
  tables: TableMeta[];
}

export const API = "/studio/api";
export const POLL_MS = 2_000;

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(body?.message ?? body?.error ?? `Studio API answered ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface TableTransaction {
  tableId: TableId;
  add: Row[];
  update: Row[];
  remove: string[];
}

const same = (a: Row, b: Row) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
};

/** The transactions that turn `prev` into `next`, one per changed table. Pure. */
export function diffTables(
  prev: StudioTables["tables"],
  next: StudioTables["tables"],
): TableTransaction[] {
  const out: TableTransaction[] = [];
  for (const tableId of Object.keys(next) as TableId[]) {
    const before = new Map((prev[tableId] ?? []).map((r) => [String(r.id), r]));
    const after = new Map(next[tableId].map((r) => [String(r.id), r]));
    const tx: TableTransaction = { tableId, add: [], update: [], remove: [] };
    for (const [id, row] of after) {
      const old = before.get(id);
      if (!old) tx.add.push(row);
      else if (!same(old, row)) tx.update.push(row);
    }
    for (const id of before.keys()) if (!after.has(id)) tx.remove.push(id);
    if (tx.add.length || tx.update.length || tx.remove.length) out.push(tx);
  }
  return out;
}
