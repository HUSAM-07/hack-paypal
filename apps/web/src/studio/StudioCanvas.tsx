/**
 * Everything that needs AG Studio, AG Grid and AG Charts: the dashboards themselves. The page
 * shell (App) loads this module and the Analyst in their own chunks, so the header paints before
 * the multi-megabyte Studio bundle arrives.
 */
import { LicenseManager } from "ag-grid-enterprise";
import type {
  AgCoreDefaultRegistry,
  AgPanelConfig,
  AgStudioApiReadyEvent,
  AgWidgetFormParams,
  AgWidgetsConfig,
} from "ag-studio";
import { AgStudioAiModule } from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { useEffect, useMemo, useRef } from "react";
import type * as Analyst from "./agents/analyst";
import type { StudioContext } from "./context";
import type { StudioConfig, StudioTables } from "./data";
import { currenciesIn, initialState, sourcesFor } from "./layout";
import { citedTheme } from "./theme";
import { CreditsGrid } from "./widgets/CreditsGrid";
import { ArmStrip, CausedTile, CreatorTiles, DepositMeter, ReviewFlags } from "./widgets/cited";
import { JourneysGrid } from "./widgets/JourneysGrid";
import { ProgrammesList, StartProgramme } from "./widgets/programmes";
import { TrustList, TrustSummary } from "./widgets/trust";
import { WhatIfPanel } from "./widgets/WhatIf";

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
        id: "cited-whatif",
        label: "Commission what-if",
        comp: WhatIfPanel,
        form,
        defaultSize: { width: 900, height: 380 },
        minSize: { width: 300, height: 300 },
      },
      {
        id: "cited-trust-summary",
        label: "Trust summary",
        comp: TrustSummary,
        form,
        defaultSize: { width: 900, height: 200 },
        minSize: { width: 300, height: 160 },
      },
      {
        id: "cited-trust-list",
        label: "Trust review",
        comp: TrustList,
        form,
        defaultSize: { width: 900, height: 360 },
        minSize: { width: 320, height: 200 },
      },
      {
        id: "cited-start-programme",
        label: "Start a programme",
        comp: StartProgramme,
        form,
        defaultSize: { width: 420, height: 520 },
        minSize: { width: 300, height: 360 },
      },
      {
        id: "cited-programmes",
        label: "Programmes",
        comp: ProgrammesList,
        form,
        defaultSize: { width: 620, height: 520 },
        minSize: { width: 320, height: 240 },
      },
      {
        id: "cited-credits",
        label: "Creator credits table",
        comp: CreditsGrid,
        form,
        defaultSize: { width: 900, height: 360 },
        minSize: { width: 320, height: 240 },
      },
      {
        id: "cited-journeys",
        label: "Journeys & creator split (Shapley)",
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
          "cited-whatif",
          "cited-journeys",
          "cited-credits",
          "cited-flags",
          "cited-trust-summary",
          "cited-trust-list",
          "cited-start-programme",
          "cited-programmes",
        ],
      },
    ],
  });

/** The Analyst's chat folds into a rail on the right; the page chips already scope the data, so no filters panel. */
const PANELS: AgPanelConfig = { edit: { right: ["ai"] }, view: { right: [] } };
/** On a phone the side panels would take the canvas width, so no view opens them there. */
const PHONE_PANELS: AgPanelConfig = { edit: { right: [] }, view: { right: [] } };
const PHONE_MAX_WIDTH = 760;
/** Widgets are dashed cards, as on the landing; Studio draws no widget border unless asked. */
const LAYOUT = { widgetBorderEnabled: true };

export interface StudioCanvasProps {
  config: StudioConfig;
  /** The first /data response; later changes arrive as transactions. */
  tables: StudioTables["tables"];
  analyst: typeof Analyst;
  /** The view the page opened on; Studio's state is built once from it. */
  initialView: StudioContext["view"];
  creatorName: string;
  mode: "edit" | "view";
  context: StudioContext;
  onApiReady: (e: AgStudioApiReadyEvent) => void;
}

/**
 * AG Studio sizes its canvas to its container and scrolls inside it, which squeezed the dashboard
 * into a short window. This grows the container to the canvas's own height, so the page scrolls.
 */
function useFitCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let observed: Element | null = null;
    const fit = () => {
      const canvas = host.querySelector(".ag-studio-layout-canvas");
      if (canvas && canvas !== observed) {
        if (observed) ro.unobserve(observed);
        ro.observe(canvas);
        observed = canvas;
      }
      if (canvas)
        host.style.minHeight = `${Math.ceil(canvas.getBoundingClientRect().height) + 24}px`;
    };
    const ro = new ResizeObserver(fit);
    const mo = new MutationObserver(fit);
    mo.observe(host, { childList: true, subtree: true });
    fit();
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return ref;
}

export function StudioCanvas(p: StudioCanvasProps) {
  const { config, tables, analyst, initialView, creatorName } = p;
  const fitRef = useFitCanvas();
  const data = useMemo(
    () => sourcesFor(config, tables, creatorName),
    [config, tables, creatorName],
  );
  // A creator paid in two currencies sees a Currency column in their grids.
  const mixed = useMemo(
    () => currenciesIn((tables.credits ?? []).filter((r) => r.creator === creatorName)).length > 1,
    [tables, creatorName],
  );
  const state = useMemo(
    () => initialState(initialView, creatorName, window.innerWidth, mixed, p.context.brandName),
    [initialView, creatorName, mixed, p.context.brandName],
  );
  // The harness reads the view the page opened on; `context` is one object for Studio's lifetime.
  const ai = useMemo(() => analyst.citedHarness(config, p.context), [analyst, config, p.context]);
  // Before the journeys grid first renders; setting the same key again is harmless.
  const phoneProgrammes = initialView === "programmes" && window.innerWidth < PHONE_MAX_WIDTH;
  if (config.gridLicenseKey) LicenseManager.setLicenseKey(config.gridLicenseKey);
  return (
    <AgStudioProvider
      {...(config.licenseKey ? { licenseKey: config.licenseKey } : {})}
      modules={[AgStudioAiModule]}
    >
      <div ref={fitRef} className={`st-studio${phoneProgrammes ? " is-phone-programmes" : ""}`}>
        <AgStudio
          data={data}
          initialState={state}
          mode={p.mode}
          panels={window.innerWidth < PHONE_MAX_WIDTH ? PHONE_PANELS : PANELS}
          theme={citedTheme}
          layout={LAYOUT}
          context={p.context}
          widgets={widgets}
          ai={ai}
          aiToolDisplay={analyst.aiToolDisplay}
          onApiReady={p.onApiReady}
        />
      </div>
    </AgStudioProvider>
  );
}
