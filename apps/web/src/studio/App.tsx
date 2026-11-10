import type { Scope } from "@cited/studio/tables";
import type { AgStudioApi, AgStudioApiReadyEvent } from "ag-studio";
import { useCallback, useEffect, useRef, useState } from "react";
import { type StudioContext, scopeStore } from "./context";
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
  return window.location.pathname.replace(/\/$/, "").endsWith("/creator") ? "creator" : "brand";
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
        setConfig(c);
        setFirst(d);
        setAsOf(d.asOf);
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
        setAsOf(next.asOf);
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
    return startPolling(tick, POLL_MS);
  }, [config]);

  const go = useCallback((v: StudioContext["view"]) => {
    setView(v);
    const path = v === "creator" ? "/studio/creator" : "/studio";
    window.history.replaceState(null, "", `${path}${window.location.search}`);
    const a = api.current;
    if (a) a.setState({ ...a.getState(), selectedPageId: v });
  }, []);

  const pickScope = useCallback((s: Scope) => {
    setScope(s);
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${searchWithScope(search, s)}`);
  }, []);

  // One object for Studio's lifetime (its `context` is read once); kept in step with the page.
  const context = useRef<StudioContext>({ view, scope, brandId: "winix", creatorId }).current;
  Object.assign(context, { view, scope, creatorId });
  useEffect(() => scopeStore.set(scope), [scope]);
  const [initialView] = useState(viewFromPath);
  const Canvas = loaded?.[0].StudioCanvas;
  const analyst = loaded?.[1];
  const onApiReady = useCallback((e: AgStudioApiReadyEvent) => {
    api.current = e.api as AgStudioApi;
  }, []);

  return (
    <div className="st-page">
      <header className="st-head">
        <div className="st-title">
          <span className="st-mark">CITED</span>
          <h1>{view === "brand" ? "Purifier programme · Winix" : `${creatorName} · creator`}</h1>
          <p>
            {view === "brand"
              ? "Maya, brand manager. Winix pays only for the sales its creators' tests caused."
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
          </nav>
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
            title={asOf ? `Engine clock ${asOf}` : undefined}
          >
            <i aria-hidden="true" />
            {live ? "Live" : "Reconnecting"}
            {asOf ? <small>engine day {asOf.slice(0, 10)}</small> : null}
          </span>
        </div>
      </header>
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
          mode={view === "brand" && !narrow ? "edit" : "view"}
          context={context}
          onApiReady={onApiReady}
        />
      ) : !error ? (
        <p className="st-loading">Loading the programme…</p>
      ) : null}
      <footer className="st-foot">
        <span>
          Live from the CITED engine read API ·{" "}
          {scope === "first" && firstBatch ? `${firstBatch} (first payout)` : "programme to date"} ·
          Analyst: {config?.llm.label ?? "…"}
        </span>
        <span>Credits count at the 80% lower bound. Money is kept in integer cents.</span>
      </footer>
    </div>
  );
}
