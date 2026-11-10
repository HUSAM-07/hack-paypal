/**
 * CITED's own AG Studio widgets. Each reads a Studio table through the widget API (so the
 * agents, filters and transactions see the same rows) and draws what a stock chart can't:
 * the proof behind a number, not just the number.
 */
import type { AgWidgetParams } from "ag-studio";
import { useState, useSyncExternalStore } from "react";
import { type StudioContext, scopeStore } from "../context";
import { API, privateNote } from "../data";
import { money, num, useRows } from "./useRows";

type P = AgWidgetParams<never, unknown, StudioContext>;

const pts = (x: unknown) =>
  typeof x === "number" ? `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pts` : "–";
const pct = (x: unknown) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "–");

const BRAND_FIELDS = [
  "brandId",
  "brand",
  "scopeKey",
  "exposedSales",
  "causedUnits",
  "lowerBound",
  "lift",
  "credited",
  "pending",
  "frozen",
  "held",
  "voided",
  "paid",
  "deposited",
  "initialDeposit",
  "topUps",
  "spent",
  "reserved",
  "returned",
  "available",
];

function useBrand(p: P, brandId: string) {
  const rows = useRows(p.widgetApi, "brands", BRAND_FIELDS);
  const scope = useSyncExternalStore(scopeStore.subscribe, scopeStore.get);
  return {
    rows,
    scope,
    row: rows?.find((r) => r.brandId === brandId && r.scopeKey === scope) ?? null,
    rival: rows?.find((r) => r.brandId !== brandId && r.scopeKey === scope) ?? null,
  };
}

/** The signature tile: only the sales the test caused, as a lower bound, beside Levoit's $0. */
export function CausedTile(p: P) {
  const { row, rival, scope } = useBrand(p, p.context?.brandId ?? "winix");
  if (!row) return <div className="cw-empty">Waiting for the first agent sale.</div>;
  const caused = num(row.causedUnits);
  const exposed = num(row.exposedSales);
  const notCredited = Math.max(0, exposed - caused);
  const share = exposed > 0 ? caused / exposed : 0;
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw cw-caused" tabIndex={0}>
      <div className="cw-caused-figure">
        <span className="cw-plus">+{caused}</span>
        <span className="cw-caused-unit">
          extra {String(row.brand)} sales
          <small>caused by the creators' tests</small>
        </span>
      </div>
      <div
        className="cw-proofbar"
        role="img"
        aria-label={`${caused} of ${exposed} exposed sales credited`}
      >
        <span className="cw-proofbar-caused" style={{ flexGrow: caused }} />
        <span className="cw-proofbar-rest" style={{ flexGrow: Math.max(notCredited, 0.0001) }} />
      </div>
      <p className="cw-proofbar-legend">
        <b>{caused}</b> of <b>{exposed}</b> sales by agents shown the test
        {notCredited > 0 ? (
          <>
            {" "}
            ·{" "}
            <span className="cw-muted">
              {notCredited} could have happened anyway: nobody is paid for them
            </span>
          </>
        ) : null}
      </p>
      <p className="cw-note">
        {scope === "todate" ? (
          <>
            At least {caused}: lift is {pts(row.lift)}, and the engine credits only its 80% lower
            bound ({pct(row.lowerBound)} of exposed sales).
          </>
        ) : (
          <>
            The cycle the first payout settled: {caused} sales credited ({pct(share)} of {exposed}{" "}
            exposed), {money(num(row.voided))} voided by a refund before it ran.
          </>
        )}
      </p>
      <dl className="cw-figures">
        <div>
          <dt>Credited</dt>
          <dd>{money(num(row.credited))}</dd>
        </div>
        <div>
          <dt>Voided</dt>
          <dd className={num(row.voided) > 0 ? "is-void" : ""}>{money(num(row.voided))}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd className="is-paid">{money(num(row.paid))}</dd>
        </div>
        {num(row.held) > 0 ? (
          <div>
            <dt title="Held for review by the abuse guard: never paid automatically">Held</dt>
            <dd className="is-held">{money(num(row.held))}</dd>
          </div>
        ) : null}
      </dl>
      {rival ? (
        <div className="cw-rival">
          <span>
            <b>{String(rival.brand)}</b> · {num(rival.causedUnits)} caused
          </span>
          <span className="cw-rival-amount">{money(num(rival.paid))}</span>
          <small>
            {scope === "todate" ? `lift bound ${pts(rival.lowerBound)}: ` : ""}a close or negative
            verdict pays nothing
          </small>
        </div>
      ) : null}
    </div>
  );
}

const ARM_ORDER = ["test", "placebo", "none"] as const;
const ARM_CLASS: Record<string, string> = {
  test: "is-test",
  placebo: "is-placebo",
  none: "is-none",
};

/** The three arms side by side: the same offers in the same order; only the test differs. */
export function ArmStrip(p: P) {
  const brandId = p.context?.brandId ?? "winix";
  const rows = useRows(p.widgetApi, "arms", [
    "brandId",
    "brand",
    "armKey",
    "arm",
    "sessions",
    "purchases",
    "share",
  ]);
  const mine = ARM_ORDER.map((k) =>
    rows?.find((r) => r.brandId === brandId && r.armKey === k),
  ).filter((r): r is NonNullable<typeof r> => !!r);
  if (!mine.length) return <div className="cw-empty">No agent sessions yet.</div>;
  const test = mine.find((r) => r.armKey === "test");
  const placebo = mine.find((r) => r.armKey === "placebo");
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw cw-arms" tabIndex={0}>
      {mine.map((r) => (
        <div key={String(r.armKey)} className={`cw-arm ${ARM_CLASS[String(r.armKey)] ?? ""}`}>
          <div className="cw-arm-label">
            {String(r.arm)}
            <small>
              {num(r.purchases)} of {num(r.sessions)} agents bought {String(r.brand)}
            </small>
          </div>
          <div className="cw-arm-track">
            <span style={{ width: `${Math.round(num(r.share) * 100)}%` }} />
          </div>
          <div className="cw-arm-share">{pct(r.share)}</div>
        </div>
      ))}
      <p className="cw-note">
        {test && placebo ? (
          <>
            Shown the test vs. the same creator's other content:{" "}
            <b>{pts(num(test.share) - num(placebo.share))}</b>.
          </>
        ) : null}{" "}
        Every arm sees the same offers in the same order; only the test is added or withheld.
      </p>
    </div>
  );
}

/** Where the deposit went: paid to creators, held, left, and returned to the brand. */
export function DepositMeter(p: P) {
  const { row, scope } = useBrand(p, p.context?.brandId ?? "winix");
  if (!row) return <div className="cw-empty">No deposit yet.</div>;
  const deposited = num(row.deposited);
  const parts = [
    { key: "paid", label: "Paid to creators", value: num(row.spent) },
    { key: "held", label: "Reserved for pending credits", value: num(row.reserved) },
    { key: "left", label: "Left in the programme", value: num(row.available) },
    { key: "returned", label: "Returned to the brand", value: num(row.returned) },
  ];
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw cw-deposit" tabIndex={0}>
      <div className="cw-deposit-head">
        <span className="cw-deposit-total">{money(deposited)}</span>
        <span className="cw-muted">
          {scope === "todate" && num(row.topUps) > 0
            ? `deposited: ${money(num(row.initialDeposit))} + ${money(num(row.topUps))} approved top-up`
            : "deposited into the purifier programme"}
        </span>
      </div>
      <div className="cw-meter" role="img" aria-label="Deposit breakdown">
        {parts.map((x) =>
          x.value > 0 ? (
            <span
              key={x.key}
              className={`cw-meter-${x.key}`}
              style={{ flexGrow: x.value }}
              title={`${x.label}: ${money(x.value)}`}
            />
          ) : null,
        )}
      </div>
      <dl className="cw-ledger">
        {parts.map((x) => (
          <div key={x.key} className={`cw-ledger-${x.key}`}>
            <dt>
              <i />
              {x.label}
            </dt>
            <dd>{money(x.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="cw-note">
        {String(row.brand)} pays only for its own lifted units. Unspent money goes back through
        PayPal refunds; a top-up funds the category, never a creator or a verdict.
      </p>
    </div>
  );
}

const STATES = [
  { key: "pending", label: "Pending", hint: "30-day hold" },
  { key: "frozen", label: "Frozen", hint: "open PayPal dispute" },
  { key: "held", label: "Held for review", hint: "never paid automatically" },
  { key: "voided", label: "Voided", hint: "refund or lost dispute" },
  { key: "paid", label: "Paid", hint: "PayPal Payouts" },
] as const;

/** A creator's credits by state, with the counts behind each amount. */
export function CreatorTiles(p: P) {
  const creatorId = p.context?.creatorId ?? "housefresh";
  const rows = useRows(p.widgetApi, "creators", [
    "creatorId",
    "creator",
    "pending",
    "frozen",
    "held",
    "voided",
    "paid",
    "credits",
    "voidedCount",
    "frozenCount",
    "heldCount",
    "heldReasons",
    "coExposed",
    "firstPayout",
  ]);
  const row = rows?.find((r) => r.creatorId === creatorId);
  if (!row) return <div className="cw-empty">No credits yet for this creator.</div>;
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw cw-tiles" tabIndex={0}>
      {STATES.map((s) => (
        <div key={s.key} className={`cw-tile is-${s.key}`}>
          <span className="cw-tile-label">{s.label}</span>
          <span className="cw-tile-value">{money(num(row[s.key]))}</span>
          <small>
            {s.key === "voided"
              ? `${num(row.voidedCount)} credit${num(row.voidedCount) === 1 ? "" : "s"} · ${s.hint}`
              : s.key === "frozen"
                ? `${num(row.frozenCount)} credit${num(row.frozenCount) === 1 ? "" : "s"} · ${s.hint}`
                : s.key === "held"
                  ? num(row.heldCount) > 0
                    ? `${num(row.heldCount)} credit${num(row.heldCount) === 1 ? "" : "s"} · ${String(row.heldReasons).toLowerCase()}`
                    : s.hint
                  : s.key === "paid"
                    ? `${money(num(row.firstPayout))} in the first payout`
                    : s.hint}
          </small>
        </div>
      ))}
      <p className="cw-note cw-tiles-note">
        {num(row.credits)} credits in all; {num(row.coExposed)} shared with another creator the
        agent also read, split by Shapley value.
      </p>
    </div>
  );
}

const FLAG_FIELDS = [
  "id",
  "creator",
  "amount",
  "reason",
  "detail",
  "status",
  "hold",
  "kind",
  "orderId",
];
const WAITING = "Waiting for a reviewer";

/**
 * Credits the abuse guard held, with the reviewer's two decisions. Release: the credit is paid at
 * the next payout. Void: it is voided for good, so it asks once more before it goes.
 */
export function ReviewFlags(p: P) {
  const rows = useRows(p.widgetApi, "flags", FLAG_FIELDS);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  const decide = async (id: string, action: "release" | "void") => {
    setBusy(id);
    setConfirming(null);
    try {
      const res = await fetch(`${API}/review-flags/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "x-studio": "review" },
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        private?: boolean;
        resetsAt?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `review answered ${res.status}`);
      const done =
        action === "release"
          ? "Released: paid at the next payout run."
          : "Voided: the credit will never be paid, and its share of the deposit is freed.";
      setNote({ id, text: body.private ? `${done} ${privateNote(body.resetsAt)}` : done });
    } catch (e) {
      setNote({ id, text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  if (!rows) return <div className="cw-empty">Loading review flags…</div>;
  if (!rows.length)
    return (
      <div className="cw-empty">
        Nothing held for review. Self-purchases, repeat buyers, sales spikes and refund rings land
        here.
      </div>
    );
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw cw-flags" tabIndex={0}>
      <table className="cw-flags-table">
        <thead>
          <tr>
            <th scope="col">Creator</th>
            <th scope="col" className="is-num">
              Credit
            </th>
            <th scope="col">Reason</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="cw-sr">Decision</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const id = String(r.id);
            const open = r.hold === true && r.status === WAITING;
            return (
              <tr key={id}>
                <td>{String(r.creator)}</td>
                <td className="is-num">{money(num(r.amount))}</td>
                <td>
                  {String(r.reason)}
                  <small>{String(r.detail)}</small>
                </td>
                <td>
                  <span className={`cw-pill ${open ? "is-held" : ""}`}>{String(r.status)}</span>
                  {note?.id === id ? (
                    <small
                      className={note.error ? "cw-approval-error" : ""}
                      role={note.error ? "alert" : "status"}
                    >
                      {note.text}
                    </small>
                  ) : null}
                </td>
                <td className="cw-flags-actions">
                  {open ? (
                    confirming === id ? (
                      <>
                        <button
                          type="button"
                          className="is-void"
                          onClick={() => decide(id, "void")}
                          disabled={busy !== null}
                        >
                          Void {money(num(r.amount))} for good
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
                          onClick={() => decide(id, "release")}
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
                    )
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="cw-note">
        A held credit is never paid automatically. Release pays it at the next payout run; void
        cancels it and frees its share of the deposit.
      </p>
    </div>
  );
}
