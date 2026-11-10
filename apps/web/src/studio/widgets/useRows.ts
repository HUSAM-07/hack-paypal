import type { AgDataHandle, AgWidgetApi, AgWidgetField } from "ag-studio";
import { useEffect, useState } from "react";
import type { Row } from "../data";

/**
 * A widget has one data handle, opened once (Studio closes it when the widget goes). Queries are
 * set on it by key, and every response is fanned out to the hooks that asked. Studio
 * re-delivers a query whenever a transaction changes its table, so widgets redraw in place.
 */
interface Hub {
  handle: AgDataHandle;
  fields: Map<string, { wanted: string[]; fields: AgWidgetField[] }>;
  latest: Map<string, Row[]>;
  listeners: Set<() => void>;
}
// Keyed by the handle: Studio can pass a widget a fresh api object while its handle lives on.
const hubs = new WeakMap<AgDataHandle, Hub>();

function hubFor(widgetApi: AgWidgetApi): Hub {
  const handle = widgetApi.getDataHandle();
  const hub = hubs.get(handle);
  if (hub) return hub;
  const h: Hub = { handle, fields: new Map(), latest: new Map(), listeners: new Set() };
  handle.open(
    ({ results }) => {
      for (const { key, response } of results) {
        const spec = h.fields.get(key);
        if (!spec) continue;
        const raw = (response.results as { rows?: Record<string, unknown>[] }).rows ?? [];
        h.latest.set(
          key,
          raw.map((r) => {
            const out: Row = {};
            spec.fields.forEach((f, i) => {
              out[spec.wanted[i] as string] = (r[f.key] ?? null) as Row[string];
            });
            return out;
          }),
        );
      }
      widgetApi.setDisplayState("displayed");
      for (const l of h.listeners) l();
    },
    { batchByFrame: false },
  );
  hubs.set(handle, h);
  return h;
}

/** A custom widget's rows from one Studio table, keyed by our own field ids. */
export function useRows(widgetApi: AgWidgetApi, tableId: string, fieldIds: string[]): Row[] | null {
  const key = `${tableId}:${fieldIds.join(",")}`;
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    const hub = hubFor(widgetApi);
    if (!hub.fields.has(key)) {
      const table = widgetApi.getSchema().find((t) => t.id === tableId);
      const wanted = key.slice(tableId.length + 1).split(",");
      const pairs = wanted
        .map((id) => [id, table?.fields.find((f) => f.fieldId === `${tableId}.${id}`)] as const)
        .filter((p): p is readonly [string, AgWidgetField] => p[1] !== undefined);
      hub.fields.set(key, { wanted: pairs.map((p) => p[0]), fields: pairs.map((p) => p[1]) });
      hub.handle.set(key, { query: { kind: "flat", fields: pairs.map((p) => p[1]) } });
    }
    const listener = () => setRows(hub.latest.get(key) ?? null);
    hub.listeners.add(listener);
    listener();
    return () => {
      hub.listeners.delete(listener);
    };
  }, [widgetApi, tableId, key]);
  return rows;
}

export const money = (n: number | null | undefined, cents = true) =>
  n === null || n === undefined
    ? "–"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      });

export const num = (n: unknown) => (typeof n === "number" ? n : 0);
