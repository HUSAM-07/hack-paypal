/**
 * The commission what-if: Maya drags the commission rate (and, if she likes, the deposit) and the
 * dashboard shows what each creator would have been paid and what Winix's return would have been.
 * It re-runs the ledger's own pure maths on the engine's recorded sales (see ../whatif.ts) and
 * never writes to the engine: nothing here is paid, saved or changed.
 */
import type { ColDef } from "ag-grid-community";
import { AllEnterpriseModule, ModuleRegistry } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import type { AgWidgetParams } from "ag-studio";
import { studioGridTheme } from "ag-studio";
import { useMemo, useState, useSyncExternalStore } from "react";
import { type StudioContext, scopeStore, whatIfStore } from "../context";
import {
  COMMISSION_BPS,
  RATE_MAX_BPS,
  RATE_MIN_BPS,
  RATE_STEP_BPS,
  toMinor,
  whatIfFor,
} from "../whatif";
import { money, num, useRows } from "./useRows";

ModuleRegistry.registerModules([AllEnterpriseModule]);

type P = AgWidgetParams<never, unknown, StudioContext>;
type CreatorRow = { id: string; creator: string; today: number; what: number; total?: true };

const GRID_HEAD = 34;
const GRID_ROW = 30;
const pctText = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
const usd = (minor: number) => money(minor / 100);
const change = (minor: number) =>
  minor === 0 ? "no change" : `${minor > 0 ? "+" : "−"}${usd(Math.abs(minor))}`;

export function WhatIfPanel(p: P) {
  const brandId = p.context?.brandId ?? "winix";
  const scope = useSyncExternalStore(scopeStore.subscribe, scopeStore.get);
  const data = useSyncExternalStore(whatIfStore.subscribe, whatIfStore.get);
  const brands = useRows(p.widgetApi, "brands", ["brandId", "brand", "scopeKey", "deposited"]);
  const credits = useRows(p.widgetApi, "credits", ["id", "state", "firstPayout"]);
  const creators = useRows(p.widgetApi, "creators", ["creatorId", "creator"]);
  const [bps, setBps] = useState(COMMISSION_BPS);
  const [depositText, setDepositText] = useState<string | null>(null);

  const brandRow = brands?.find((b) => b.brandId === brandId && b.scopeKey === scope);
  const brandName = String(brandRow?.brand ?? "The brand");
  // Today's deposit for this view: the first payout is funded by the initial deposit alone.
  const todayDeposit = toMinor(brandRow?.deposited);
  const typed = depositText === null ? Number.NaN : Math.round(Number(depositText) * 100);
  const deposit = Number.isFinite(typed) && typed >= 0 ? typed : todayDeposit;
  const unchanged = bps === COMMISSION_BPS && deposit === todayDeposit;

  const result = useMemo(() => {
    if (!credits || !brandRow) return null;
    const run = (commissionBps: number, depositMinor: number) =>
      whatIfFor(data, brandId, scope, credits, { commissionBps, depositMinor });
    const today = run(COMMISSION_BPS, todayDeposit);
    const what = unchanged ? today : run(bps, deposit);
    return today && what ? { today, what } : null;
  }, [data, brandId, scope, credits, brandRow, todayDeposit, bps, deposit, unchanged]);

  const rows = useMemo<CreatorRow[]>(() => {
    if (!result) return [];
    const name = new Map((creators ?? []).map((c) => [String(c.creatorId), String(c.creator)]));
    const keptBy = (r: typeof result.today) =>
      new Map(r.creators.map((c) => [c.creatorId, c.kept.amountMinor]));
    const was = keptBy(result.today);
    const now = keptBy(result.what);
    return [...new Set([...was.keys(), ...now.keys()])].sort().map((id) => ({
      id,
      creator: name.get(id) ?? id,
      today: was.get(id) ?? 0,
      what: now.get(id) ?? 0,
    }));
  }, [result, creators]);

  const columns = useMemo<ColDef<CreatorRow>[]>(
    () => [
      { field: "creator", headerName: "Creator", flex: 1, minWidth: 96 },
      {
        field: "today",
        headerName: `Today, ${pctText(COMMISSION_BPS)}`,
        width: 116,
        type: "rightAligned",
        valueFormatter: (x) => usd(num(x.value)),
      },
      {
        field: "what",
        headerName: `At ${pctText(bps)}`,
        width: 96,
        type: "rightAligned",
        valueFormatter: (x) => usd(num(x.value)),
        cellClass: "cw-wi-what",
      },
      {
        headerName: "Change",
        width: 96,
        type: "rightAligned",
        valueGetter: (x) => num(x.data?.what) - num(x.data?.today),
        valueFormatter: (x) => change(num(x.value)),
      },
    ],
    [bps],
  );
  const gridRows = useMemo<CreatorRow[]>(
    () => [
      ...rows,
      {
        id: "total",
        creator: "All creators",
        today: rows.reduce((a, r) => a + r.today, 0),
        what: rows.reduce((a, r) => a + r.what, 0),
        total: true,
      },
    ],
    [rows],
  );

  if (data?.truncated)
    return (
      <div className="cw-empty">
        There are too many recorded sales to re-price in the browser, so the what-if is switched
        off.
      </div>
    );
  if (!result) return <div className="cw-empty">Waiting for the programme's recorded sales…</div>;
  const { today, what } = result;
  const reset = () => {
    setBps(COMMISSION_BPS);
    setDepositText(null);
  };
  const dueToDeposit = what.causedUnits < today.causedUnits;
  const costNow = what.costPerCausedSale?.amountMinor ?? 0;
  const costWas = today.costPerCausedSale?.amountMinor ?? 0;

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw cw-wi" tabIndex={0}>
      <p className="cw-wi-flag">
        <b>What-if only.</b> Nothing here is paid or saved. It re-prices the sales already recorded
        and leaves the real figures as they are.
      </p>
      <div className="cw-wi-controls">
        <label className="cw-wi-rate">
          <span>
            Commission rate <output htmlFor="wi-rate">{pctText(bps)}</output>
          </span>
          <input
            id="wi-rate"
            type="range"
            min={RATE_MIN_BPS}
            max={RATE_MAX_BPS}
            step={RATE_STEP_BPS}
            value={bps}
            onChange={(e) => setBps(Number(e.target.value))}
          />
        </label>
        <label className="cw-wi-deposit">
          <span>Deposit, in dollars</span>
          <input
            type="number"
            min={0}
            step={50}
            inputMode="decimal"
            value={depositText ?? String(todayDeposit / 100)}
            onChange={(e) => setDepositText(e.target.value)}
          />
        </label>
        <button type="button" className="cw-wi-reset" onClick={reset} disabled={unchanged}>
          Back to today's {pctText(COMMISSION_BPS)}
        </button>
      </div>
      <dl className="cw-wi-tiles" aria-live="polite">
        <div className="cw-wi-tile">
          <dt>Sales the test caused</dt>
          <dd>{what.causedUnits}</dd>
          <small>
            {dueToDeposit
              ? `${today.causedUnits} today: the deposit would run out`
              : "same as today"}
          </small>
        </div>
        <div className="cw-wi-tile is-paid">
          <dt>Creators earn</dt>
          <dd>{usd(what.kept.amountMinor)}</dd>
          <small>
            {usd(today.kept.amountMinor)} today
            {unchanged ? "" : ` (${change(what.kept.amountMinor - today.kept.amountMinor)})`}
          </small>
        </div>
        <div className="cw-wi-tile">
          <dt>{brandName}'s cost per caused sale</dt>
          <dd>{what.costPerCausedSale ? usd(costNow) : "–"}</dd>
          <small>
            {today.costPerCausedSale ? usd(costWas) : "–"} today
            {unchanged || !what.costPerCausedSale || !today.costPerCausedSale
              ? ""
              : ` (${change(costNow - costWas)})`}
          </small>
        </div>
        <div className="cw-wi-tile">
          <dt>Unspent deposit refunded</dt>
          <dd>{usd(what.refunded.amountMinor)}</dd>
          <small>
            {usd(today.refunded.amountMinor)} today
            {unchanged
              ? ""
              : ` (${change(what.refunded.amountMinor - today.refunded.amountMinor)})`}
          </small>
        </div>
      </dl>
      <div className="cw-wi-grid" style={{ height: GRID_HEAD + GRID_ROW * gridRows.length + 2 }}>
        <AgGridReact<CreatorRow>
          theme={studioGridTheme}
          rowData={gridRows}
          columnDefs={columns}
          defaultColDef={{ sortable: false, suppressMovable: true, suppressHeaderMenuButton: true }}
          getRowClass={(x) => (x.data?.total ? "cw-wi-total" : undefined)}
          getRowId={(x) => x.data.id}
          headerHeight={GRID_HEAD}
          rowHeight={GRID_ROW}
          suppressCellFocus
        />
      </div>
      <p className="cw-note">
        Credited {usd(what.credited.amountMinor)}
        {what.voided.amountMinor > 0
          ? `, less ${usd(what.voided.amountMinor)} that stays voided by a refund`
          : ""}
        . Earnings are what is paid or still to be paid; a credit already voided by a refund stays
        voided. The rate sets the price of each sale, not how many the test caused. Sales are shared
        between creators by the same Shapley split, and no credit can draw more than the deposit.
      </p>
    </div>
  );
}
