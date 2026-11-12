/**
 * The Trust view: what the guard and PayPal have stopped, and why. A summary (stopped money
 * against paid, and how many credits each reason caught), then every stopped credit with its
 * reason in plain words. Held credits keep the same two decisions as the review list: release
 * (paid at the next payout) or void (cancelled for good).
 */
import type { AgWidgetParams } from "ag-studio";
import { Fragment, useState } from "react";
import { asOfStore, type StudioContext } from "../context";
import { csvFileName, downloadCsv, trustCsv } from "../csvExport";
import { API, privateNote } from "../data";
import { ExportButton } from "./ExportButton";
import { Note } from "./Note";
import { currencyOf, money, num, useOfBrand, useRows } from "./useRows";

type P = AgWidgetParams<never, unknown, StudioContext>;

const FIELDS = [
  "id",
  "creator",
  "brandId",
  "brand",
  "orderId",
  "amount",
  "currency",
  "status",
  "statusKey",
  "reason",
  "reasonCodes",
  "why",
  "date",
  "flagIds",
];

/** Reason chips: the engine's codes in the words the table uses. Order is how often a reviewer meets them. */
const CHIPS: { code: string; label: string }[] = [
  { code: "self_purchase", label: "Creator bought through their own PayPal" },
  { code: "repeat_buyer", label: "Same buyer bought repeatedly" },
  { code: "velocity", label: "Sudden spike in sales" },
  { code: "refund_ring", label: "Buyer refunds often" },
  { code: "open_dispute", label: "Open dispute" },
  { code: "refund", label: "Refunded" },
  { code: "partial_refund", label: "Part-refunded" },
  { code: "dispute", label: "Lost dispute" },
];

const dateOf = (iso: unknown) => {
  if (typeof iso !== "string" || !iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const codesOf = (r: Record<string, unknown>) =>
  String(r.reasonCodes ?? "")
    .split(",")
    .filter(Boolean);

function useTrust(p: P) {
  // Trust follows the brand picked in the header, like every other brand view.
  const brandId = p.context?.brandId;
  const rows = useOfBrand(useRows(p.widgetApi, "trust", FIELDS), brandId);
  const credits = useOfBrand(
    useRows(p.widgetApi, "credits", ["id", "brandId", "amount", "currency", "state"]),
    brandId,
  );
  return { rows, credits };
}

/** Stopped money beside paid, and a count for each reason. One summary per currency, never added together. */
export function TrustSummary(p: P) {
  const { rows, credits } = useTrust(p);
  if (!rows || !credits) return <div className="cw-empty">Loading…</div>;
  const seen = [...new Set([...rows, ...credits].map(currencyOf))].sort(
    (a, b) => Number(b === "USD") - Number(a === "USD") || (a < b ? -1 : 1),
  );
  const currencies = seen.length ? seen : ["USD"];
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw cw-trust-sum" tabIndex={0}>
      {currencies.map((cur) => (
        <Fragment key={cur}>
          {currencies.length > 1 ? <p className="cw-tiles-currency">Credits in {cur}</p> : null}
          <CurrencySummary
            rows={rows.filter((r) => currencyOf(r) === cur)}
            credits={credits.filter((c) => currencyOf(c) === cur)}
            currency={cur}
          />
        </Fragment>
      ))}
      <Note>
        Every credit the abuse guard or PayPal stopped is listed below with its reason. Nothing here
        is paid until a reviewer releases it or PayPal decides.
      </Note>
    </div>
  );
}

function CurrencySummary(props: {
  rows: Record<string, unknown>[];
  credits: Record<string, unknown>[];
  currency: string;
}) {
  const { rows, credits, currency } = props;
  const m = (n: number) => money(n, true, currency);
  const sum = (key: string) =>
    rows.filter((r) => r.statusKey === key).reduce((a, r) => a + num(r.amount), 0);
  const count = (key: string) => rows.filter((r) => r.statusKey === key).length;
  const held = sum("held");
  const frozen = sum("frozen");
  const voided = sum("voided");
  const paid = credits.filter((c) => c.state === "paid").reduce((a, c) => a + num(c.amount), 0);
  const total = held + frozen + voided + paid;
  const seg = (v: number) => ({ flexGrow: total > 0 ? Math.max(v, 0) : 0, flexBasis: 0 });
  return (
    <>
      <dl className="cw-trust-figures">
        <div className="is-paid">
          <dt>Paid</dt>
          <dd>{m(paid)}</dd>
          <dd className="cw-sub">sent through PayPal Payouts</dd>
        </div>
        <div className="is-held">
          <dt>Held for review</dt>
          <dd>{m(held)}</dd>
          <dd className="cw-sub">
            {count("held")} credit{count("held") === 1 ? "" : "s"}, never paid on their own
          </dd>
        </div>
        <div className="is-frozen">
          <dt>Frozen</dt>
          <dd>{m(frozen)}</dd>
          <dd className="cw-sub">
            {count("frozen")} credit{count("frozen") === 1 ? "" : "s"}, open PayPal dispute
          </dd>
        </div>
        <div className="is-voided">
          <dt>Voided</dt>
          <dd>{m(voided)}</dd>
          <dd className="cw-sub">
            {count("voided")} credit{count("voided") === 1 ? "" : "s"}, never paid
          </dd>
        </div>
      </dl>
      <div
        className="cw-trust-bar"
        role="img"
        aria-label={`Paid ${m(paid)}, held ${m(held)}, frozen ${m(frozen)}, voided ${m(voided)}`}
      >
        <span className="is-paid" style={seg(paid)} />
        <span className="is-held" style={seg(held)} />
        <span className="is-frozen" style={seg(frozen)} />
        <span className="is-voided" style={seg(voided)} />
      </div>
    </>
  );
}

const WORDS: Record<string, string> = {
  held: "Waiting for a reviewer",
  frozen: "Frozen",
  voided: "Voided",
  released: "Released",
};

/** One credit per row, newest sale first within each status. Reason chips narrow the list. */
export function TrustList(p: P) {
  const { rows } = useTrust(p);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; error?: boolean } | null>(null);

  const decide = async (id: string, flagIds: string[], action: "release" | "void") => {
    setBusy(id);
    setConfirming(null);
    try {
      let private_: { private?: boolean; resetsAt?: string } = {};
      // A void closes every open hold on the credit; a release has to decide each one.
      for (const flag of action === "void" ? flagIds.slice(0, 1) : flagIds) {
        const res = await fetch(`${API}/review-flags/${encodeURIComponent(flag)}/${action}`, {
          method: "POST",
          headers: { "x-studio": "review" },
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          private?: boolean;
          resetsAt?: string;
        };
        if (!res.ok) throw new Error(body.error ?? `review answered ${res.status}`);
        private_ = body;
      }
      const done =
        action === "release"
          ? "Released: paid at the next payout run."
          : "Voided: the credit will never be paid, and its share of the deposit is freed.";
      setNote({ id, text: private_.private ? `${done} ${privateNote(private_.resetsAt)}` : done });
    } catch (e) {
      setNote({ id, text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };

  if (!rows) return <div className="cw-empty">Loading…</div>;
  if (!rows.length)
    return (
      <div className="cw-empty">
        Nothing is held, frozen or voided. A creator buying through their own PayPal, a buyer who
        keeps buying or refunding, a sudden spike in sales, a refund or an open dispute would appear
        here.
      </div>
    );
  const counts = CHIPS.map((c) => ({
    ...c,
    n: rows.filter((r) => codesOf(r).includes(c.code)).length,
  })).filter((c) => c.n > 0);
  const shown = pick ? rows.filter((r) => codesOf(r).includes(pick)) : rows;
  // The list is not a grid, so its rows go through the same CSV helper; the chip narrows the file too.
  const exportCsv = () => {
    const name = csvFileName(["trust-review", pick ?? "all"], asOfStore.get());
    downloadCsv(name, trustCsv(shown));
    return name;
  };
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw cw-trust" tabIndex={0}>
      <ExportButton
        label="credits held, frozen or voided"
        count={shown.length}
        onExport={exportCsv}
      />
      <nav className="cw-trust-chips" aria-label="Filter by reason">
        <button type="button" aria-pressed={pick === null} onClick={() => setPick(null)}>
          All <b>{rows.length}</b>
        </button>
        {counts.map((c) => (
          <button
            key={c.code}
            type="button"
            aria-pressed={pick === c.code}
            onClick={() => setPick(pick === c.code ? null : c.code)}
          >
            {c.label} <b>{c.n}</b>
          </button>
        ))}
      </nav>
      <ul className="cw-trust-list">
        {shown.map((r) => {
          const id = String(r.id);
          const flagIds = String(r.flagIds ?? "")
            .split(",")
            .filter(Boolean);
          const key = String(r.statusKey);
          return (
            <li key={id} className={`cw-trust-row is-${key}`}>
              <div className="cw-trust-main">
                <span className="cw-trust-amount">{money(num(r.amount), true, currencyOf(r))}</span>
                <span className={`cw-pill is-${key === "released" ? "paid" : key}`}>
                  {WORDS[key] ?? String(r.status)}
                </span>
              </div>
              <div className="cw-trust-why">
                <b>{String(r.reason)}</b>
                <span>{String(r.why)}</span>
                <small>
                  {String(r.creator)} · {String(r.brand)}
                  {r.date ? ` · sale on ${dateOf(r.date)}` : ""}
                </small>
                {note?.id === id ? (
                  <small
                    className={note.error ? "cw-approval-error" : ""}
                    role={note.error ? "alert" : "status"}
                  >
                    {note.text}
                  </small>
                ) : null}
              </div>
              {flagIds.length ? (
                <div className="cw-flags-actions cw-trust-actions">
                  {confirming === id ? (
                    <>
                      <button
                        type="button"
                        className="is-void"
                        onClick={() => decide(id, flagIds, "void")}
                        disabled={busy !== null}
                      >
                        Void {money(num(r.amount), true, currencyOf(r))} for good
                      </button>
                      <button
                        type="button"
                        className="is-quiet"
                        onClick={() => setConfirming(null)}
                      >
                        Keep it held
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => decide(id, flagIds, "release")}
                        disabled={busy !== null}
                      >
                        {busy === id ? "Saving…" : "Release"}
                      </button>
                      <button
                        type="button"
                        className="is-quiet"
                        onClick={() => setConfirming(id)}
                        disabled={busy !== null}
                      >
                        Void
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
