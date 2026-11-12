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
import { useMemo } from "react";
import type * as Analyst from "./agents/analyst";
import type { StudioContext } from "./context";
import type { StudioConfig, StudioTables } from "./data";
import { initialState, sourcesFor } from "./layout";
import { citedTheme } from "./theme";
import { ArmStrip, CausedTile, CreatorTiles, DepositMeter, ReviewFlags } from "./widgets/cited";
import { JourneysGrid } from "./widgets/JourneysGrid";
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
          "cited-flags",
          "cited-trust-summary",
          "cited-trust-list",
        ],
      },
    ],
  });

/** The Analyst's chat on the right of the brand view; filters beside it. No builder chrome by default. */
const PANELS: AgPanelConfig = { edit: { right: ["ai", "filters"] }, view: { right: ["filters"] } };

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

export function StudioCanvas(p: StudioCanvasProps) {
  const { config, tables, analyst, initialView, creatorName } = p;
  const data = useMemo(() => sourcesFor(config, tables), [config, tables]);
  const state = useMemo(
    () => initialState(initialView, creatorName, window.innerWidth),
    [initialView, creatorName],
  );
  const ai = useMemo(() => analyst.citedHarness(config), [analyst, config]);
  // Before the journeys grid first renders; setting the same key again is harmless.
  if (config.gridLicenseKey) LicenseManager.setLicenseKey(config.gridLicenseKey);
  return (
    <AgStudioProvider
      {...(config.licenseKey ? { licenseKey: config.licenseKey } : {})}
      modules={[AgStudioAiModule]}
    >
      <div className="st-studio">
        <AgStudio
          data={data}
          initialState={state}
          mode={p.mode}
          panels={PANELS}
          theme={citedTheme}
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
