/**
 * A creator's credits as an AG Grid table inside a Studio widget: every credit with its state,
 * void or hold reason, payout batch and the Shapley split, live from the ledger. It replaces
 * Studio's plain grid so the table can offer an Export CSV that follows the grid's filter and sort.
 */
import type { ColDef, GridApi } from "ag-grid-community";
import { AllEnterpriseModule, ModuleRegistry } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import type { AgWidgetParams } from "ag-studio";
import { studioGridTheme } from "ag-studio";
import { useMemo, useRef } from "react";
import { asOfStore, type StudioContext } from "../context";
import { creditsCsv, csvFileName, downloadCsv } from "../csvExport";
import type { Row } from "../data";
import { ExportButton } from "./ExportButton";
import { currencyOf, money, num, useRows } from "./useRows";

ModuleRegistry.registerModules([AllEnterpriseModule]);

type P = AgWidgetParams<never, unknown, StudioContext>;

const CREDIT_FIELDS = [
  "id",
  "creatorId",
  "orderId",
  "captureId",
  "brand",
  "amount",
  "currency",
  "state",
  "voidReason",
  "holdReason",
  "holdUntil",
  "payoutBatch",
  "splitWith",
];
const SHARE_FIELDS = ["id", "captureId", "creatorId", "creator", "amount", "currency"];

const dash = (x: { value?: unknown }) => (x.value ? String(x.value) : "–");

export function CreditsGrid(p: P) {
  const credits = useRows(p.widgetApi, "credits", CREDIT_FIELDS);
  const shares = useRows(p.widgetApi, "shares", SHARE_FIELDS);
  const creatorId = p.context?.creatorId;
  const rows = useMemo<Row[]>(
    () => (credits ?? []).filter((c) => !creatorId || c.creatorId === creatorId),
    [credits, creatorId],
  );
  // A creator paid in two currencies sees a Currency column, as the other grids do.
  const mixed = new Set(rows.map(currencyOf)).size > 1;

  const api = useRef<GridApi<Row> | null>(null);
  const exportCsv = () => {
    const shown: Row[] = [];
    api.current?.forEachNodeAfterFilterAndSort((n) => n.data && shown.push(n.data));
    const name = csvFileName(["credits", creatorId ?? ""], asOfStore.get());
    downloadCsv(name, creditsCsv(shown, shares ?? []));
    return name;
  };

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: "orderId", headerName: "PayPal order", minWidth: 190 },
      { field: "brand", headerName: "Brand", width: 110 },
      {
        field: "amount",
        headerName: "Amount",
        width: 110,
        type: "rightAligned",
        valueFormatter: (x) =>
          mixed ? num(x.value).toFixed(2) : money(num(x.value), true, currencyOf(x.data)),
      },
      ...(mixed ? [{ field: "currency", headerName: "Currency", width: 100 } as ColDef<Row>] : []),
      { field: "state", headerName: "State", width: 100 },
      { field: "voidReason", headerName: "Void reason", width: 130, valueFormatter: dash },
      {
        field: "holdReason",
        headerName: "Held for review because",
        minWidth: 190,
        valueFormatter: dash,
      },
      { field: "holdUntil", headerName: "Hold ends", width: 120, valueFormatter: dash },
      { field: "payoutBatch", headerName: "Payout batch", minWidth: 150, valueFormatter: dash },
      {
        field: "splitWith",
        headerName: "Shapley split with",
        flex: 1,
        minWidth: 170,
        valueFormatter: dash,
      },
    ],
    [mixed],
  );

  return (
    <div className="cw cw-grid">
      <ExportButton label="your credits" count={rows.length} onExport={exportCsv} />
      <div className="cw-grid-body">
        <AgGridReact<Row>
          theme={studioGridTheme}
          rowData={rows}
          columnDefs={columns}
          getRowId={(x) => String(x.data.id)}
          onGridReady={(e) => {
            api.current = e.api;
          }}
          animateRows
          suppressCellFocus
        />
      </div>
    </div>
  );
}
