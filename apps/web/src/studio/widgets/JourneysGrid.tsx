/**
 * Cross-store journeys and the Shapley split, as an AG Grid master-detail table inside a Studio
 * widget. A row is one PayPal order an agent placed; expanding it shows the agent's store hop
 * (the store it read, the store it paid), the creators it read, and each creator's exact share
 * from the ledger. Rows update in place (getRowId), so a refund void shows without a reload.
 */
import type {
  ColDef,
  GetRowIdParams,
  ICellRendererParams,
  IDetailCellRendererParams,
} from "ag-grid-community";
import { AllEnterpriseModule, ModuleRegistry } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import type { AgWidgetParams } from "ag-studio";
import { studioGridTheme } from "ag-studio";
import { useMemo } from "react";
import type { StudioContext } from "../context";
import type { Row } from "../data";
import { money, num, useRows } from "./useRows";

ModuleRegistry.registerModules([AllEnterpriseModule]);

type P = AgWidgetParams<never, unknown, StudioContext>;
type Journey = { [field: string]: unknown; shares: Row[] };

const JOURNEY_FIELDS = [
  "orderId",
  "model",
  "arm",
  "product",
  "firstStore",
  "firstPrice",
  "storeChosen",
  "price",
  "saved",
  "commission",
  "voided",
  "holdStatus",
  "holdUntil",
  "creators",
  "capturedAt",
];
const SHARE_FIELDS = [
  "id",
  "orderId",
  "captureId",
  "creator",
  "amount",
  "state",
  "payoutBatch",
  "splitOf",
];

const shop = (s: unknown) => (typeof s === "string" ? s.charAt(0).toUpperCase() + s.slice(1) : "–");

function StatusPill({ value }: { value: unknown }) {
  const v = String(value ?? "none");
  const text = v === "none" ? "no credit" : v === "held" ? "on hold" : v;
  return <span className={`cw-pill is-${v}`}>{text}</span>;
}

function Commission(p: ICellRendererParams<Journey>) {
  const d = p.data;
  if (!d) return null;
  const paid = num(d.commission);
  const voided = num(d.voided);
  if (paid === 0 && voided > 0) return <s className="cw-void">{money(voided)}</s>;
  return <span>{paid > 0 ? money(paid) : "–"}</span>;
}

function Detail(p: IDetailCellRendererParams<Journey>) {
  const d = p.data;
  if (!d) return null;
  const hopped = d.firstStore !== d.storeChosen;
  return (
    <div className="cw-detail">
      <section>
        <h4>The agent's path</h4>
        <div className="cw-hops">
          {hopped ? (
            <>
              <span className="cw-hop">
                {shop(d.firstStore)}
                <small>read first · {money(num(d.firstPrice))}</small>
              </span>
              <span className="cw-hop-arrow" aria-hidden="true">
                →
              </span>
            </>
          ) : null}
          <span className="cw-hop is-chosen">
            {shop(d.storeChosen)}
            <small>
              paid through PayPal · {money(num(d.price))}
              {num(d.saved) > 0 ? ` · saved ${money(num(d.saved))}` : ""}
            </small>
          </span>
        </div>
        <p className="cw-note">
          {String(d.model)} · {String(d.arm).toLowerCase()} · {String(d.product)}. Order{" "}
          {String(d.orderId)}; the Affiliate Passport rode in <code>custom_id</code>, so the sale
          joined its arm at whichever store it was paid.
        </p>
      </section>
      <section>
        <h4>Shapley split{d.shares.length > 1 ? " · co-exposed" : ""}</h4>
        {d.shares.length ? (
          <table className="cw-shares">
            <tbody>
              {d.shares.map((s) => (
                <tr key={String(s.id)}>
                  <td>{String(s.creator)}</td>
                  <td>
                    <StatusPill value={s.state} />
                  </td>
                  <td className="cw-muted">{s.payoutBatch ? String(s.payoutBatch) : "–"}</td>
                  <td className="cw-num">
                    {s.state === "voided" ? (
                      <s className="cw-void">{money(num(s.amount))}</s>
                    ) : (
                      money(num(s.amount))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="cw-muted">
            No creator credit: this agent was not shown a test, or the sale wasn't caused by one.
          </p>
        )}
      </section>
    </div>
  );
}

export function JourneysGrid(p: P) {
  const journeys = useRows(p.widgetApi, "journeys", JOURNEY_FIELDS);
  const shares = useRows(p.widgetApi, "shares", SHARE_FIELDS);
  const rows = useMemo<Journey[]>(() => {
    const by = new Map<string, Row[]>();
    for (const s of shares ?? [])
      by.set(String(s.orderId), [...(by.get(String(s.orderId)) ?? []), s]);
    return (journeys ?? [])
      .map((j): Journey => ({ ...j, shares: by.get(String(j.orderId)) ?? [] }))
      .sort((a, b) => (String(a.capturedAt) < String(b.capturedAt) ? 1 : -1));
  }, [journeys, shares]);

  const columns = useMemo<ColDef<Journey>[]>(
    () => [
      {
        field: "orderId",
        headerName: "PayPal order",
        cellRenderer: "agGroupCellRenderer",
        minWidth: 210,
      },
      { field: "model", headerName: "Agent", width: 120 },
      { field: "arm", headerName: "Arm", width: 150 },
      { field: "product", headerName: "Product", width: 150 },
      {
        headerName: "Store paid",
        width: 150,
        valueGetter: (x) => shop(x.data?.storeChosen),
      },
      {
        field: "saved",
        headerName: "Saved",
        width: 100,
        type: "rightAligned",
        valueFormatter: (x) => (num(x.value) > 0 ? money(num(x.value)) : "–"),
      },
      {
        field: "creators",
        headerName: "Creators read",
        flex: 1,
        minWidth: 150,
        valueFormatter: (x) => (x.value ? String(x.value) : "–"),
      },
      {
        headerName: "Commission",
        width: 120,
        type: "rightAligned",
        cellRenderer: Commission,
        enableCellChangeFlash: true,
      },
      { field: "holdStatus", headerName: "30-day hold", width: 130, cellRenderer: StatusPill },
    ],
    [],
  );

  return (
    <div className="cw cw-grid">
      <AgGridReact<Journey>
        theme={studioGridTheme}
        rowData={rows}
        columnDefs={columns}
        getRowId={(x: GetRowIdParams<Journey>) => String(x.data.orderId)}
        masterDetail
        isRowMaster={() => true}
        detailCellRenderer={Detail}
        detailRowHeight={190}
        animateRows
        suppressCellFocus
      />
    </div>
  );
}
