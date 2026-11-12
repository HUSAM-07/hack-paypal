/**
 * Cross-store journeys and the Shapley split, as an AG Grid master-detail table inside a Studio
 * widget. A row is one PayPal order an agent placed; expanding it shows the agent's store hop
 * (the store it read, the store it paid), the creators it read, and each creator's exact share
 * from the ledger. Rows update in place (getRowId), so a refund void shows without a reload.
 */
import type {
  ColDef,
  GetRowIdParams,
  GridApi,
  ICellRendererParams,
  IDetailCellRendererParams,
} from "ag-grid-community";
import { AllEnterpriseModule, ModuleRegistry } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import type { AgWidgetParams } from "ag-studio";
import { studioGridTheme } from "ag-studio";
import { useMemo, useRef, useSyncExternalStore } from "react";
import { asOfStore, type StudioContext, scopeStore } from "../context";
import { csvFileName, downloadCsv, journeysCsv, scopeSlug } from "../csvExport";
import type { Row } from "../data";
import { ExportButton } from "./ExportButton";
import { money, num, useRows } from "./useRows";

ModuleRegistry.registerModules([AllEnterpriseModule]);

type P = AgWidgetParams<never, unknown, StudioContext>;
type Journey = { [field: string]: unknown; shares: Row[] };

const JOURNEY_FIELDS = [
  "orderId",
  "model",
  "arm",
  "product",
  "category",
  "firstStore",
  "firstPrice",
  "storeChosen",
  "price",
  "saved",
  "commission",
  "voided",
  "holdStatus",
  "holdUntil",
  "firstPayout",
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
          joined its group at whichever store it was paid.
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
  const allJourneys = useRows(p.widgetApi, "journeys", JOURNEY_FIELDS);
  const brands = useRows(p.widgetApi, "brands", ["brandId", "category"]);
  // The orders of the picked brand's category: a vacuum programme shows vacuum sales, not purifiers.
  const category = brands?.find((b) => b.brandId === (p.context?.brandId ?? "winix"))?.category;
  const journeys = useMemo(
    () =>
      allJourneys && category ? allJourneys.filter((j) => j.category === category) : allJourneys,
    [allJourneys, category],
  );
  const shares = useRows(p.widgetApi, "shares", SHARE_FIELDS);
  // "First payout" shows only the orders its cycle covered, like the tiles and arm strip.
  const scope = useSyncExternalStore(scopeStore.subscribe, scopeStore.get);
  const rows = useMemo<Journey[]>(() => {
    const by = new Map<string, Row[]>();
    for (const s of shares ?? [])
      by.set(String(s.orderId), [...(by.get(String(s.orderId)) ?? []), s]);
    return (journeys ?? [])
      .filter((j) => scope !== "first" || j.firstPayout === true)
      .map((j): Journey => ({ ...j, shares: by.get(String(j.orderId)) ?? [] }))
      .sort((a, b) => (String(a.capturedAt) < String(b.capturedAt) ? 1 : -1));
  }, [journeys, shares, scope]);

  // Export what the grid shows: its filter and sort decide the rows, and `shown` the count.
  const api = useRef<GridApi<Journey> | null>(null);
  const exportCsv = () => {
    const shown: Journey[] = [];
    api.current?.forEachNodeAfterFilterAndSort((n) => n.data && shown.push(n.data));
    const name = csvFileName(["journeys", scopeSlug(scope)], asOfStore.get());
    downloadCsv(name, journeysCsv(shown));
    return name;
  };

  const columns = useMemo<ColDef<Journey>[]>(
    () => [
      {
        field: "orderId",
        headerName: "PayPal order",
        cellRenderer: "agGroupCellRenderer",
        flex: 1.2,
        minWidth: 190,
      },
      // The agent and the saving are in each row's detail; the grid keeps to what a brand scans.
      { field: "model", headerName: "Agent", width: 160, hide: true },
      { field: "arm", headerName: "Group", width: 130 },
      { field: "product", headerName: "Product", width: 110 },
      {
        headerName: "Store paid",
        width: 120,
        valueGetter: (x) => shop(x.data?.storeChosen),
      },
      {
        field: "saved",
        headerName: "Saved",
        width: 100,
        hide: true,
        type: "rightAligned",
        valueFormatter: (x) => (num(x.value) > 0 ? money(num(x.value)) : "–"),
      },
      {
        field: "creators",
        headerName: "Creators read",
        flex: 1,
        minWidth: 130,
        valueFormatter: (x) => (x.value ? String(x.value) : "–"),
      },
      {
        headerName: "Commission",
        width: 124,
        type: "rightAligned",
        cellRenderer: Commission,
        enableCellChangeFlash: true,
      },
      { field: "holdStatus", headerName: "30-day hold", width: 132, cellRenderer: StatusPill },
    ],
    [],
  );

  return (
    <div className="cw cw-grid">
      <ExportButton label="cross-store journeys" count={rows.length} onExport={exportCsv} />
      <div className="cw-grid-body">
        <AgGridReact<Journey>
          onGridReady={(e) => {
            api.current = e.api;
          }}
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
    </div>
  );
}
