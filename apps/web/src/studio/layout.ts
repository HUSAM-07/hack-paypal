import type { AgReportState } from "ag-studio";
import type { StudioConfig } from "./data";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Studio's data sources: our tables, live (transactions on), keyed by row id. */
export function sourcesFor(
  config: StudioConfig,
  tables: Record<string, Record<string, unknown>[]>,
) {
  return {
    sources: config.tables.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      primaryKeyField: "id",
      transactions: "all" as const,
      data: (tables[t.id] ?? []) as Record<string, string | number | boolean | null>[],
      fields: t.fields.map((f) => ({
        id: f.id,
        name: f.name,
        format: f.format,
        ...(f.format === "currencyFormat" ? { formatOptions: { format: USD } } : {}),
        ...(f.description ? { description: f.description } : {}),
      })),
    })),
  };
}

const creatorFilter = (table: string, creator: string) => ({
  field: { id: `${table}.creator` },
  model: { operator: "equals", value: creator },
});

/** Two pages: Maya's brand view and the creator's view. Widget ids are stable for the agents. */
export function initialState(view: "brand" | "creator", creatorName: string): AgReportState {
  return {
    pages: [
      {
        id: "brand",
        widgets: {
          caused: {
            type: "cited-caused",
            format: { title: { enabled: true, text: "Sales the test caused" } },
          },
          arms: {
            type: "cited-arms",
            format: { title: { enabled: true, text: "Winix share by arm" } },
          },
          deposit: {
            type: "cited-deposit",
            format: { title: { enabled: true, text: "Programme deposit" } },
          },
          journeys: {
            type: "cited-journeys",
            format: {
              title: { enabled: true, text: "Cross-store journeys and the Shapley split" },
            },
          },
        },
        widgetLayout: {
          caused: { xTrack: 0, yTrack: 0, xSpan: 9, ySpan: 23 },
          arms: { xTrack: 9, yTrack: 0, xSpan: 7, ySpan: 23 },
          deposit: { xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 23 },
          journeys: { xTrack: 0, yTrack: 23, xSpan: 24, ySpan: 33 },
        },
      },
      {
        id: "creator",
        widgets: {
          tiles: {
            type: "cited-creator",
            format: { title: { enabled: true, text: "Credits by state" } },
          },
          credits: {
            type: "grid",
            dataMapping: {
              cols: [
                { id: "credits.orderId" },
                { id: "credits.brand" },
                { id: "credits.amount" },
                { id: "credits.state" },
                { id: "credits.voidReason" },
                { id: "credits.holdUntil" },
                { id: "credits.payoutBatch" },
                { id: "credits.splitWith" },
              ],
            },
            format: { title: { enabled: true, text: "Every credit, live from the ledger" } },
          },
          batches: {
            type: "column-chart-grouped",
            dataMapping: {
              categoryKey: [{ id: "payouts.batch" }],
              valueKey: [{ id: "payouts.amount", aggregation: "sum" }],
            },
            format: { title: { enabled: true, text: "Paid by PayPal Payouts batch" } },
          },
        },
        widgetLayout: {
          tiles: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 11 },
          credits: { xTrack: 0, yTrack: 11, xSpan: 16, ySpan: 45 },
          batches: { xTrack: 16, yTrack: 11, xSpan: 8, ySpan: 45 },
        },
        filter: {
          page: [creatorFilter("credits", creatorName)],
          widget: { batches: [creatorFilter("payouts", creatorName)] },
        },
      },
    ],
    selectedPageId: view,
    panels: {
      filters: { collapsed: true },
      data: { collapsed: true },
      edit: { collapsed: true },
      ai: { collapsed: view !== "brand" },
    },
  } as unknown as AgReportState;
}
