/**
 * The brand's programme page: the programmes that run, each with its deposit meter, and the
 * "Start a programme" flow beside them. Both are AG Studio custom widgets reading the same
 * `brands` table as the Winix view, so a programme the brand starts shows up in every dashboard
 * the moment the next read lands (the page asks for one right after confirming).
 */
import { PROGRAMME_CATEGORIES } from "@pact/protocol";
import type { AgWidgetParams } from "ag-studio";
import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import type { StudioContext } from "../context";
import { API } from "../data";
import {
  type Action,
  categoryOf,
  DEMO_NOTE,
  exampleLine,
  type FormState,
  freeProducts,
  initialForm,
  outcomeMessage,
  PROMISES,
  parsePercent,
  productOf,
  reduce,
  requestOf,
  reviewOf,
  STEPS,
  termsProblems,
} from "../programmeForm";
import { money, num, useRows } from "./useRows";
import "./programmes.css";

type P = AgWidgetParams<never, unknown, StudioContext>;

const FIELDS = [
  "brandId",
  "brand",
  "category",
  "commissionRate",
  "scopeKey",
  "exposedSales",
  "causedUnits",
  "paid",
  "deposited",
  "spent",
  "reserved",
  "returned",
  "available",
];

/** The programme this visit started, so the list can say "Just started" beside it. */
let justStarted: string | null = null;
const startedListeners = new Set<() => void>();
const startedStore = {
  get: () => justStarted,
  set(id: string | null) {
    justStarted = id;
    for (const l of startedListeners) l();
  },
  subscribe(l: () => void) {
    startedListeners.add(l);
    return () => startedListeners.delete(l);
  },
};

/** Asks the page for a fresh read now, instead of at the next 15-second poll. */
export const REFRESH_EVENT = "cited:refresh";

const categoryLabel = (id: string) => PROGRAMME_CATEGORIES.find((c) => c.id === id)?.label ?? id;
const productName = (brandId: string, brand: string) => {
  for (const c of PROGRAMME_CATEGORIES) {
    const p = c.products.find((x) => x.brandId === brandId);
    if (p) return `${p.brand} ${p.product}`;
  }
  return brand;
};
const ratePct = (rate: unknown) =>
  typeof rate === "number" ? `${Number((rate * 100).toFixed(2))}%` : "–";

/** Every programme with its deposit meter; a new one is empty until sales arrive. */
export function ProgrammesList(p: P) {
  const rows = useRows(p.widgetApi, "brands", FIELDS);
  const fresh = useSyncExternalStore(startedStore.subscribe, startedStore.get);
  const programmes = useMemo(() => {
    const list = (rows ?? []).filter((r) => r.scopeKey === "todate");
    return [...list].sort(
      (a, b) =>
        Number(b.brandId === fresh) - Number(a.brandId === fresh) ||
        String(a.category).localeCompare(String(b.category)) ||
        String(a.brand).localeCompare(String(b.brand)),
    );
  }, [rows, fresh]);
  if (!rows) return <div className="cw-empty">Loading the programmes…</div>;
  if (!programmes.length) return <div className="cw-empty">No programme has been started yet.</div>;
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw pg-list" tabIndex={0}>
      {programmes.map((r) => {
        const parts = [
          { key: "paid", label: "Paid to creators", value: num(r.spent) },
          { key: "held", label: "Reserved for pending credits", value: num(r.reserved) },
          { key: "left", label: "Left in the programme", value: num(r.available) },
          { key: "returned", label: "Returned to the brand", value: num(r.returned) },
        ];
        const isNew = r.brandId === fresh;
        const empty = num(r.exposedSales) === 0 && num(r.paid) === 0;
        return (
          <article key={String(r.brandId)} className={`pg-card${isNew ? " is-new" : ""}`}>
            <header className="pg-card-head">
              <h2>{productName(String(r.brandId), String(r.brand))}</h2>
              <span className="pg-chip">{categoryLabel(String(r.category))}</span>
              {isNew ? <span className="pg-new">Just started</span> : null}
            </header>
            <p className="pg-terms">
              <b>{money(num(r.deposited))}</b> deposited · pays creators{" "}
              <b>{ratePct(r.commissionRate)}</b> of each sale the test caused
            </p>
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
            <dl className="pg-ledger">
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
            <p className="pg-sales">
              {empty ? (
                <>No sales yet. The meter fills as agents shop and the test is measured.</>
              ) : (
                <>
                  <b>{num(r.causedUnits)}</b> of <b>{num(r.exposedSales)}</b> sales by agents shown
                  the test were caused by it.
                </>
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
}

const usd = (minor: number) =>
  (minor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Pick a category and product, set the terms, read the summary, confirm. */
export function StartProgramme(p: P) {
  const rows = useRows(p.widgetApi, "brands", ["brandId", "scopeKey"]);
  const running = useMemo(() => new Set((rows ?? []).map((r) => String(r.brandId))), [rows]);
  const demo = !!p.context?.demo;
  const [form, send] = useReducer(
    (s: FormState, a: Action) => reduce(s, a, running),
    undefined,
    () => initialForm(new Set<string>()),
  );
  // The first read arrives after the first render: settle on a category that still has a product.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!rows || settled) return;
    setSettled(true);
    send({ type: "reset" });
  }, [rows, settled]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const confirm = async () => {
    const req = requestOf(form);
    if (!req || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/programmes`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-studio": "programme" },
        body: JSON.stringify(req),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        brandId?: string;
        private?: boolean;
        resetsAt?: string;
      };
      if (!res.ok)
        throw new Error(body.message ?? body.error ?? `The programme answered ${res.status}`);
      const product = productOf(req.upc);
      setOutcome(
        outcomeMessage({
          private: body.private,
          resetsAt: body.resetsAt,
          depositMinor: req.depositMinor,
          brand: product?.brand ?? "The",
        }),
      );
      startedStore.set(body.brandId ?? product?.brandId ?? null);
      send({ type: "done" });
      window.dispatchEvent(new Event(REFRESH_EVENT));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return <div className="cw-empty">Loading the catalogue…</div>;
  const stepIndex = STEPS.findIndex((s) => s.id === form.step);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls when the widget is small; keyboard users must reach it (WCAG 2.1.1)
    <div className="cw pg-start" tabIndex={0}>
      {form.step !== "done" ? (
        <ol className="pg-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={s.id === form.step ? "step" : undefined}
              className={i < stepIndex ? "is-past" : i === stepIndex ? "is-now" : ""}
            >
              <span>{i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
      ) : null}

      {form.step === "category" ? (
        <CategoryStep form={form} running={running} send={send} />
      ) : form.step === "terms" ? (
        <TermsStep form={form} send={send} />
      ) : form.step === "review" ? (
        <ReviewStep
          form={form}
          demo={demo}
          busy={busy}
          error={error}
          onConfirm={confirm}
          send={send}
        />
      ) : (
        <div className="pg-done" role="status">
          <p className="pg-done-head">Programme started</p>
          <p>{outcome}</p>
          <p className="cw-muted">
            It now appears under Your programmes, empty until the first sale arrives.
          </p>
          <button
            type="button"
            className="pg-btn is-quiet"
            onClick={() => {
              setOutcome(null);
              send({ type: "reset" });
            }}
          >
            Start another programme
          </button>
        </div>
      )}
      {form.step !== "done" && demo ? (
        <p className="pg-demo">
          <b>Demo mode.</b> {DEMO_NOTE}
        </p>
      ) : null}
    </div>
  );
}

function CategoryStep(props: {
  form: FormState;
  running: ReadonlySet<string>;
  send: (a: Action) => void;
}) {
  const { form, running, send } = props;
  const category = categoryOf(form.category);
  return (
    <div className="pg-step">
      <fieldset className="pg-fieldset">
        <legend>Pick a category the catalogue can test</legend>
        <div className="pg-choices">
          {PROGRAMME_CATEGORIES.map((c) => {
            const open = freeProducts(c, running).length;
            return (
              <label key={c.id} className={`pg-choice${form.category === c.id ? " is-on" : ""}`}>
                <input
                  type="radio"
                  name="pg-category"
                  checked={form.category === c.id}
                  onChange={() => send({ type: "category", category: c.id })}
                />
                <span className="pg-choice-title">{c.label}</span>
                <small>
                  {open === 0
                    ? "Every product here already has a programme"
                    : c.products.map((x) => `${x.brand} ${x.product}`).join(" · ")}
                </small>
              </label>
            );
          })}
        </div>
      </fieldset>
      {category ? (
        <fieldset className="pg-fieldset">
          <legend>Your product</legend>
          <div className="pg-choices">
            {category.products.map((x) => {
              const taken = running.has(x.brandId);
              return (
                <label
                  key={x.upc}
                  className={`pg-choice${form.upc === x.upc ? " is-on" : ""}${taken ? " is-off" : ""}`}
                >
                  <input
                    type="radio"
                    name="pg-product"
                    checked={form.upc === x.upc}
                    disabled={taken}
                    onChange={() => send({ type: "product", upc: x.upc })}
                  />
                  <span className="pg-choice-title">
                    {x.brand} {x.product}
                  </span>
                  <small>{taken ? "Already has a programme" : "Ready to fund"}</small>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      <p className="cw-note">Each product has one programme, so no sale is ever paid for twice.</p>
      <div className="pg-actions">
        <button
          type="button"
          className="pg-btn"
          disabled={!form.upc}
          onClick={() => send({ type: "next" })}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function TermsStep(props: { form: FormState; send: (a: Action) => void }) {
  const { form, send } = props;
  const problems = termsProblems(form);
  const bps = parsePercent(form.commission);
  const example = bps !== null && !problems.commission ? exampleLine(form.upc, bps) : null;
  return (
    <div className="pg-step">
      <div className="pg-field">
        <label htmlFor="pg-deposit">Deposit</label>
        <div className={`pg-input${problems.deposit ? " is-bad" : ""}`}>
          <span aria-hidden="true">$</span>
          <input
            id="pg-deposit"
            inputMode="decimal"
            autoComplete="off"
            value={form.deposit}
            aria-invalid={!!problems.deposit}
            aria-describedby="pg-deposit-help"
            onChange={(e) => send({ type: "deposit", value: e.target.value })}
          />
        </div>
        <div className="pg-presets">
          {["250", "500", "1000"].map((v) => (
            <button
              key={v}
              type="button"
              className={`pg-preset${form.deposit === v ? " is-on" : ""}`}
              onClick={() => send({ type: "deposit", value: v })}
            >
              {usd(Number(v) * 100)}
            </button>
          ))}
        </div>
        <small id="pg-deposit-help" className={problems.deposit ? "pg-bad" : "cw-muted"}>
          {problems.deposit ?? "This is the most the programme can ever pay creators."}
        </small>
      </div>
      <div className="pg-field">
        <label htmlFor="pg-commission">Commission rate</label>
        <div className={`pg-input${problems.commission ? " is-bad" : ""}`}>
          <input
            id="pg-commission"
            inputMode="decimal"
            autoComplete="off"
            value={form.commission}
            aria-invalid={!!problems.commission}
            aria-describedby="pg-commission-help"
            onChange={(e) => send({ type: "commission", value: e.target.value })}
          />
          <span aria-hidden="true">%</span>
        </div>
        <small id="pg-commission-help" className={problems.commission ? "pg-bad" : "cw-muted"}>
          {problems.commission ?? example ?? "Paid on each sale a creator's test caused."}
        </small>
      </div>
      <div className="pg-actions">
        <button type="button" className="pg-btn is-quiet" onClick={() => send({ type: "back" })}>
          Back
        </button>
        <button
          type="button"
          className="pg-btn"
          disabled={!!(problems.deposit || problems.commission)}
          onClick={() => send({ type: "next" })}
        >
          Review
        </button>
      </div>
    </div>
  );
}

function ReviewStep(props: {
  form: FormState;
  demo: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  send: (a: Action) => void;
}) {
  const { form, demo, busy, error, onConfirm, send } = props;
  const review = reviewOf(form);
  const req = requestOf(form);
  if (!review || !req) return <p className="pg-bad">Go back and fix the terms.</p>;
  return (
    <div className="pg-step">
      <h2 className="pg-review-head">{review.heading}</h2>
      <dl className="pg-review">
        {review.rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <ul className="pg-promises">
        {PROMISES.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {error ? (
        <p className="pg-bad" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pg-actions">
        <button
          type="button"
          className="pg-btn is-quiet"
          disabled={busy}
          onClick={() => send({ type: "back" })}
        >
          Back
        </button>
        <button type="button" className="pg-btn" disabled={busy} onClick={onConfirm}>
          {busy
            ? "Starting…"
            : demo
              ? `Confirm in demo mode · ${usd(req.depositMinor)}`
              : `Confirm and fund ${usd(req.depositMinor)}`}
        </button>
      </div>
    </div>
  );
}
