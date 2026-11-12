/** The Trust page of the Studio report: what the guard and PayPal stopped, and why. */
export const trustPage = () => ({
  id: "trust",
  widgets: {
    "trust-summary": {
      type: "cited-trust-summary",
      format: { title: { enabled: true, text: "Held, frozen and voided against paid" } },
    },
    "trust-list": {
      type: "cited-trust-list",
      format: { title: { enabled: true, text: "Every stopped credit, and why" } },
    },
  },
  widgetLayout: {
    "trust-summary": { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 14 },
    "trust-list": { xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 42 },
  },
});
