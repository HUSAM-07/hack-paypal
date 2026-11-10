import type { Scope } from "@cited/studio/tables";
import { LicenseManager } from "ag-grid-enterprise";
import type {
  AgCoreDefaultRegistry,
  AgPanelConfig,
  AgStudioApi,
  AgStudioApiReadyEvent,
  AgWidgetFormParams,
  AgWidgetsConfig,
} from "ag-studio";
import { AgStudioAiModule } from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiToolDisplay, citedHarness } from "./agents/analyst";
import { type StudioContext, scopeStore } from "./context";
import { diffTables, getJson, POLL_MS, type StudioConfig, type StudioTables } from "./data";
import { initialState, sourcesFor } from "./layout";
import { citedTheme } from "./theme";
import { ArmStrip, CausedTile, CreatorTiles, DepositMeter, ReviewFlags } from "./widgets/cited";
import { JourneysGrid } from "./widgets/JourneysGrid";

const CREATORS: Record<string, string> = { housefresh: "HouseFresh", airlab: "AirLab" };

// biome-ignore lint/suspicious/noExplicitAny: our widgets take no data mapping
const form = (p: AgWidgetFormParams<any>) => p.createDefaults({});
const widgets = (defaults: AgWidgetsConfig<AgCoreDefaultRegistry>) =>
  // biome-ignore lint/suspicious/noExplicitAny: custom widget registry is open-ended
  createWidgets<any>({
    additionalTypes: [
      {
        id: "cited-caused",
        label: "Caused sales",
        comp: CausedTile,
        form,
        defaultSize: { width: 360, height: 320 },
        minSize: { width: 280, height: 260 },
      },
      {
        id: "cited-arms",
        label: "Arm strip",
        comp: ArmStrip,
        form,
        defaultSize: { width: 320, height: 280 },
        minSize: { width: 260, height: 220 },
      },
      {
        id: "cited-deposit",
        label: "Deposit meter",
        comp: DepositMeter,
        form,
        defaultSize: { width: 320, height: 280 },
        minSize: { width: 260, height: 220 },
      },
      {
        id: "cited-creator",
        label: "Creator credits",
        comp: CreatorTiles,
        form,
        defaultSize: { width: 800, height: 160 },
        minSize: { width: 300, height: 120 },
      },
      {
        id: "cited-flags",
        label: "Held for review",
        comp: ReviewFlags,
        form,
        defaultSize: { width: 900, height: 220 },
        minSize: { width: 360, height: 160 },
      },
      {
        id: "cited-journeys",
        label: "Journeys & Shapley split",
        comp: JourneysGrid,
        form,
        defaultSize: { width: 900, height: 360 },
        minSize: { width: 400, height: 240 },
      },
    ],
    menu: [
      ...defaults.menu,
      {
        label: "CITED",
        widgetIds: [
          "cited-caused",
          "cited-arms",
          "cited-deposit",
          "cited-creator",
          "cited-journeys",
          "cited-flags",
        ],
      },
    ],
  });

/** The Analyst's chat on the right of the brand view; filters beside it. No builder chrome by default. */
const PANELS: AgPanelConfig = { edit: { right: ["ai", "filters"] }, view: { right: ["filters"] } };

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
    const s: Scope = params.get("scope") === "first" ? "first" : "todate";
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
  const api = useRef<AgStudioApi | null>(null);
  const last = useRef<StudioTables | null>(null);

  useEffect(() => {
    Promise.all([getJson<StudioConfig>("/config"), getJson<StudioTables>("/data")])
      .then(([c, d]) => {
        if (c.gridLicenseKey) LicenseManager.setLicenseKey(c.gridLicenseKey);
        last.current = d;
        setConfig(c);
        setFirst(d);
        setAsOf(d.asOf);
        setFirstBatch(d.firstBatch?.label ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Poll the engine; turn each change into transactions so widgets update in place.
  useEffect(() => {
    if (!config) return;
    let stopped = false;
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
      } catch {
        setLive(false);
      }
      if (!stopped) setTimeout(tick, POLL_MS);
    };
    const t = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [config]);

  const go = useCallback((v: StudioContext["view"]) => {
    setView(v);
    const path = v === "creator" ? "/studio/creator" : "/studio";
    window.history.replaceState(null, "", `${path}${window.location.search}`);
    const a = api.current;
    if (a) a.setState({ ...a.getState(), selectedPageId: v });
  }, []);

  // One object for Studio's lifetime (its `context` is read once); kept in step with the page.
  const context = useRef<StudioContext>({ view, scope, brandId: "winix", creatorId }).current;
  Object.assign(context, { view, scope, creatorId });
  useEffect(() => scopeStore.set(scope), [scope]);
  const data = useMemo(
    () => (config && first ? sourcesFor(config, first.tables) : undefined),
    [config, first],
  );
  const state = useMemo(() => initialState(viewFromPath(), creatorName), [creatorName]);
  const ai = useMemo(() => (config ? citedHarness(config) : undefined), [config]);
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
                onClick={() => setScope("first")}
                disabled={!firstBatch}
              >
                First payout
              </button>
              <button
                type="button"
                aria-pressed={scope === "todate"}
                onClick={() => setScope("todate")}
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
          {error}. Start the engine, then reload.
        </p>
      ) : null}
      {config && data && ai ? (
        <AgStudioProvider
          {...(config.licenseKey ? { licenseKey: config.licenseKey } : {})}
          modules={[AgStudioAiModule]}
        >
          <div className="st-studio">
            <AgStudio
              data={data}
              initialState={state}
              mode={view === "brand" && !narrow ? "edit" : "view"}
              panels={PANELS}
              theme={citedTheme}
              context={context}
              widgets={widgets}
              ai={ai}
              aiToolDisplay={aiToolDisplay}
              onApiReady={onApiReady}
            />
          </div>
        </AgStudioProvider>
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
