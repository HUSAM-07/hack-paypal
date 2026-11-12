import type { Scope } from "@cited/studio/tables";
import type { AgStudioApi, AgStudioApiReadyEvent } from "ag-studio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "../landing/SiteHeader";
import {
  brandFromParams,
  brandOptions,
  categoryLabel,
  DEFAULT_BRAND,
  searchWithBrand,
} from "./brand";
import { asOfStore, type StudioContext, scopeStore, whatIfStore } from "./context";
import { diffTables, getJson, POLL_MS, type StudioConfig, type StudioTables } from "./data";
import { startPolling } from "./poll";
import { scopeFromParams, searchWithScope } from "./scope";

const CREATORS: Record<string, string> = { housefresh: "HouseFresh", airlab: "AirLab" };

/**
 * AG Studio (with AG Grid and AG Charts) and the Analyst load as their own chunks, requested on
 * first render so they download alongside /config and /data while the header is on screen.
 */
type Parts = [typeof import("./StudioCanvas"), typeof import("./agents/analyst")];
const loadParts = (): Promise<Parts> =>
  Promise.all([import("./StudioCanvas"), import("./agents/analyst")]);

const NARROW = "(max-width: 760px)";
/** Phones get the dashboards without the chat panel, which would leave the canvas no width. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const m = window.matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Demo creators by name; creators onboarded at /creators by their `c-` id. Anything else: HouseFresh. */
export function creatorFromParams(params: URLSearchParams): string {
  const id = params.get("creator") ?? "";
  return Object.hasOwn(CREATORS, id) || /^c-[0-9a-f]{12}$/.test(id) ? id : "housefresh";
}

/** The byline a new creator chose, passed along by /creators. Plain text, rendered by React. */
function displayName(raw: string | null): string | undefined {
  const s = Array.from(raw ?? "", (ch) =>
    ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch,
  )
    .join("")
    .trim()
    .slice(0, 80);
  return s || undefined;
}

function viewFromPath(): StudioContext["view"] {
  if (window.location.pathname.replace(/\/$/, "").endsWith("/creator")) return "creator";
  const page = new URLSearchParams(window.location.search).get("page");
  return page === "trust" ? "trust" : page === "programmes" ? "programmes" : "brand";
}

/** /studio/creator for the creator, /studio?page=trust (or programmes) for those pages, /studio for the brand. */
export function urlFor(v: StudioContext["view"], search: string): string {
  const q = new URLSearchParams(search);
  q.delete("page");
  if (v === "trust" || v === "programmes") q.set("page", v);
  const rest = q.toString();
  return `${v === "creator" ? "/studio/creator" : "/studio"}${rest ? `?${rest}` : ""}`;
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const [view, setView] = useState<StudioContext["view"]>(viewFromPath);
  const narrow = useNarrow();
  const [scope, setScope] = useState<Scope>(() => {
    const s = scopeFromParams(params);
    scopeStore.set(s);
    return s;
  });
  const creatorId = creatorFromParams(params);
  const creatorName = CREATORS[creatorId] ?? displayName(params.get("name")) ?? creatorId;
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [first, setFirst] = useState<StudioTables | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [firstBatch, setFirstBatch] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [loaded, setLoaded] = useState<Parts | null>(null);
  const api = useRef<AgStudioApi | null>(null);
  const last = useRef<StudioTables | null>(null);

  useEffect(() => {
    loadParts()
      .then(setLoaded)
      .catch((e: Error) => setError(e.message));
    Promise.all([getJson<StudioConfig>("/config"), getJson<StudioTables>("/data")])
      .then(([c, d]) => {
        last.current = d;
        whatIfStore.set(d.whatIf ?? null);
        setConfig(c);
        setFirst(d);
        setAsOf(d.asOf);
        asOfStore.set(d.asOf);
        setFirstBatch(d.firstBatch?.label ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Poll the engine; turn each change into transactions so widgets update in place. Only while
  // someone is looking (see poll.ts): every poll reads every table.
  useEffect(() => {
    if (!config) return;
    const tick = async () => {
      try {
        const next = await getJson<StudioTables>("/data");
        setLive(true);
        whatIfStore.set(next.whatIf ?? null);
        setAsOf(next.asOf);
        asOfStore.set(next.asOf);
        setFirstBatch(next.firstBatch?.label ?? null);
        const engine = api.current?.getDataEngine();
        if (engine?.applyTransaction && last.current && next.version !== last.current.version) {
          const txs = diffTables(last.current.tables, next.tables);
          if (txs.length) await engine.applyTransaction(txs.map((t) => ({ ...t })));
        }
        last.current = next;
        return true;
      } catch {
        setLive(false);
        return false;
      }
    };
    // "Start a programme" asks for a read right after confirming, so it shows up at once.
    const refresh = () => void tick();
    window.addEventListener("cited:refresh", refresh);
    const stop = startPolling(tick, POLL_MS);
    return () => {
      window.removeEventListener("cited:refresh", refresh);
      stop();
    };
  }, [config]);

  const go = useCallback((v: StudioContext["view"]) => {
    // The Creator Analyst and the brand Analyst are different agents with their own question
    // chips, chosen when Studio starts; crossing between them reopens the page on the new view.
    if ((v === "creator") !== (viewFromPath() === "creator")) {
      window.location.assign(urlFor(v, window.location.search));
      return;
    }
    setView(v);
    window.history.replaceState(null, "", urlFor(v, window.location.search));
    const a = api.current;
    if (a) a.setState({ ...a.getState(), selectedPageId: v });
  }, []);

  const pickScope = useCallback((s: Scope) => {
    setScope(s);
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${searchWithScope(search, s)}`);
  }, []);

  // One object for Studio's lifetime (its `context` is read once); kept in step with the page.
  const context = useRef<StudioContext>({ view, scope, brandId: DEFAULT_BRAND, creatorId }).current;
  // The brands come from the data Studio loaded; Studio's context is read once, so the brand view
  // opens on one brand and the switcher reloads the page on another (the Analyst starts on it).
  const brands = useMemo(() => brandOptions(first?.tables.brands), [first]);
  const brandId = brandFromParams(
    params,
    brands.map((b) => b.brandId),
  );
  const brand = brands.find((b) => b.brandId === brandId);
  const brandName = brand?.brand ?? "Winix";
  const programme = categoryLabel(brand?.category || "purifier");
  Object.assign(context, {
    view,
    scope,
    creatorId,
    brandId,
    brandName,
    category: brand?.category || "purifier",
    brandIds: brands.map((b) => b.brandId),
    rivalName: brands.find((b) => b.brandId !== brandId && b.category === brand?.category)?.brand,
    demo: !!config?.privateWrites,
  });
  const pickBrand = useCallback((id: string) => {
    const { pathname, search } = window.location;
    window.location.assign(`${pathname}${searchWithBrand(search, id)}`);
  }, []);
  useEffect(() => scopeStore.set(scope), [scope]);
  const [initialView] = useState(viewFromPath);
  // One title per view, so a screen-reader user hears which dashboard they are on.
  useEffect(() => {
    const name =
      view === "brand"
        ? `${programme} programme`
        : view === "trust"
          ? "Trust review"
          : view === "programmes"
            ? "Programmes"
            : `${creatorName} creator`;
    document.title = `${name} · CITED AG Studio`;
  }, [view, creatorName, programme]);
  const Canvas = loaded?.[0].StudioCanvas;
  const analyst = loaded?.[1];
  const onApiReady = useCallback((e: AgStudioApiReadyEvent) => {
    api.current = e.api as AgStudioApi;
  }, []);

  return (
    <>
      <SiteHeader current="studio" skip />
      <div className="st-page">
        <section className="st-head" aria-labelledby="st-h1">
          <div className="st-title">
            <span className="st-mark">AG Studio</span>
            <h1 id="st-h1">
              {view === "brand"
                ? `${programme} programme · ${brandName}`
                : view === "trust"
                  ? `Trust review · ${brandName}`
                  : view === "programmes"
                    ? "Programmes · start one"
                    : `${creatorName} · creator`}
            </h1>
            <p>
              {view === "brand"
                ? `Maya, brand manager. ${brandName} pays only for the sales its creators' tests caused.`
                : view === "trust"
                  ? "Every credit that was held, frozen or voided, and exactly why. Nothing here is paid until a person or PayPal decides."
                  : view === "programmes"
                    ? "Fund a category the catalogue can test. You pay only for sales a creator's test caused; unspent money comes back through a PayPal refund."
                    : "Every credit from the purifier test: pending, held for review, frozen, voided or paid."}
            </p>
          </div>
          <div className="st-controls">
            <nav className="st-seg" aria-label="View">
              <button type="button" aria-pressed={view === "brand"} onClick={() => go("brand")}>
                Brand
              </button>
              <button type="button" aria-pressed={view === "creator"} onClick={() => go("creator")}>
                Creator
              </button>
              <button type="button" aria-pressed={view === "trust"} onClick={() => go("trust")}>
                Trust
              </button>
              <button
                type="button"
                aria-pressed={view === "programmes"}
                onClick={() => go("programmes")}
              >
                Programmes
              </button>
            </nav>
            {(view === "brand" || view === "trust") && brands.length > 1 ? (
              <nav className="st-seg" aria-label="Brand programme">
                {brands.map((b) => (
                  <button
                    key={b.brandId}
                    type="button"
                    aria-pressed={b.brandId === brandId}
                    onClick={() => (b.brandId === brandId ? undefined : pickBrand(b.brandId))}
                  >
                    {b.brand}
                  </button>
                ))}
              </nav>
            ) : null}
            {view === "brand" ? (
              <nav className="st-seg" aria-label="Money shown">
                <button
                  type="button"
                  aria-pressed={scope === "first"}
                  onClick={() => pickScope("first")}
                  disabled={!firstBatch}
                >
                  First payout
                </button>
                <button
                  type="button"
                  aria-pressed={scope === "todate"}
                  onClick={() => pickScope("todate")}
                >
                  Programme to date
                </button>
              </nav>
            ) : null}
            <span
              className={`st-live${live ? "" : " is-stale"}`}
              role="status"
              title={asOf ? `Simulated engine clock: ${asOf}` : undefined}
            >
              <i aria-hidden="true" />
              {live ? "Live" : "Reconnecting"}
              {asOf ? <small>simulated clock {asOf.slice(0, 10)}</small> : null}
            </span>
          </div>
        </section>
        <main id="main" className="st-main">
          {error ? (
            <p className="st-error" role="alert">
              The programme figures could not load ({error}). Reload the page in a moment.
            </p>
          ) : null}
          {config && first && Canvas && analyst ? (
            <Canvas
              config={config}
              tables={first.tables}
              analyst={analyst}
              initialView={initialView}
              creatorName={creatorName}
              mode={(view === "brand" || view === "creator") && !narrow ? "edit" : "view"}
              context={context}
              onApiReady={onApiReady}
            />
          ) : !error ? (
            <p className="st-loading">Loading the programme…</p>
          ) : null}
        </main>
        <footer className="st-foot">
          <span>
            Live from the CITED engine read API ·{" "}
            {scope === "first" && firstBatch ? `${firstBatch} (first payout)` : "programme to date"}{" "}
            · Analyst: {config?.llm.label ?? "…"}
          </span>
          <span>Credits count at the 80% lower bound. Money is kept in integer cents.</span>
        </footer>
      </div>
    </>
  );
}
