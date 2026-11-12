/**
 * The commission what-if: Maya drags the commission rate (and, if she likes, the deposit) and the
 * dashboard shows what creators would have earned and what Winix's return would have been.
 * It re-runs the ledger's own pure maths on the engine's recorded sales (see ../whatif.ts) and
 * never writes to the engine: nothing here is paid, saved or changed.
 */
import type { AgWidgetParams } from "ag-studio";
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
import { money, useRows } from "./useRows";

type P = AgWidgetParams<never, unknown, StudioContext>;

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
        <b>What-if only.</b> Nothing here is paid or saved.
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
          <dd className="cw-sub">
            {dueToDeposit
              ? `${today.causedUnits} today: the deposit would run out`
              : "same as today"}
          </dd>
        </div>
        <div className="cw-wi-tile is-paid">
          <dt>Creators earn</dt>
          <dd>{usd(what.kept.amountMinor)}</dd>
          <dd className="cw-sub">
            {usd(today.kept.amountMinor)} today
            {unchanged ? "" : ` (${change(what.kept.amountMinor - today.kept.amountMinor)})`}
          </dd>
        </div>
        <div className="cw-wi-tile">
          <dt>{brandName}'s cost per caused sale</dt>
          <dd>{what.costPerCausedSale ? usd(costNow) : "–"}</dd>
          <dd className="cw-sub">
            {today.costPerCausedSale ? usd(costWas) : "–"} today
            {unchanged || !what.costPerCausedSale || !today.costPerCausedSale
              ? ""
              : ` (${change(costNow - costWas)})`}
          </dd>
        </div>
        <div className="cw-wi-tile">
          <dt>Unspent deposit refunded</dt>
          <dd>{usd(what.refunded.amountMinor)}</dd>
          <dd className="cw-sub">
            {usd(today.refunded.amountMinor)} today
            {unchanged
              ? ""
              : ` (${change(what.refunded.amountMinor - today.refunded.amountMinor)})`}
          </dd>
        </div>
      </dl>
    </div>
  );
}
