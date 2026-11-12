/**
 * The Programmes page of the Studio report: starting a programme, and the ones that run. Side by
 * side on a desktop; stacked on a phone, where the 24-column grid would squeeze both to a sliver.
 */
export const programmesPage = (narrow = false) => ({
  id: "programmes",
  widgets: {
    "programme-start": {
      type: "cited-start-programme",
      format: { title: { enabled: true, text: "Start a programme" } },
    },
    "programme-list": {
      type: "cited-programmes",
      format: { title: { enabled: true, text: "Your programmes" } },
    },
  },
  widgetLayout: narrow
    ? {
        "programme-start": { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 46 },
        "programme-list": { xTrack: 0, yTrack: 46, xSpan: 24, ySpan: 40 },
      }
    : {
        "programme-start": { xTrack: 0, yTrack: 0, xSpan: 10, ySpan: 42 },
        "programme-list": { xTrack: 10, yTrack: 0, xSpan: 14, ySpan: 42 },
      },
});
