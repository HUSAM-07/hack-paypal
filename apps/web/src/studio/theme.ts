import { studioTheme } from "ag-studio";

/**
 * CITED's dark palette, shared with the landing page. Proof green is the one strong colour: it marks
 * what the test caused and what was paid. Amber marks money still held (30-day hold, disputes).
 */
export const C = {
  paper: "#0B0B0A",
  surface: "#131312",
  ink: "#EDEBE5",
  muted: "#8F8C84",
  proof: "#5FD9A0",
  proofTint: "rgba(95, 217, 160, 0.12)",
  amber: "#F0B545",
  amberTint: "rgba(240, 181, 69, 0.12)",
  hairline: "#262522",
  quiet: "#3B3A35",
} as const;

export const SERIF = `"Newsreader", Georgia, "Times New Roman", serif`;
export const SANS = `"Geist", "Geist Fallback", system-ui, sans-serif`;

export const citedTheme = studioTheme.withParams({
  browserColorScheme: "dark",
  backgroundColor: C.paper,
  foregroundColor: C.ink,
  textColor: C.ink,
  subtleTextColor: C.muted,
  accentColor: C.proof,
  borderColor: C.hairline,
  fontFamily: SANS,
  fontSize: 14,
  borderRadius: 6,
  invalidColor: "#FF7B67",
  studioWrapperBackgroundColor: C.paper,
  studioCanvasBackgroundColor: C.paper,
  studioCanvasFontFamily: SANS,
  studioWidgetBackgroundColor: C.surface,
  studioWidgetBorder: { color: C.hairline, width: 1 },
  studioWidgetBorderRadius: 10,
  studioWidgetShadow: "none",
  studioWidgetTitleFontFamily: SERIF,
  studioWidgetTitleFontSize: 19,
  studioWidgetTitleFontWeight: 400,
  studioWidgetTitleTextColor: C.ink,
  studioWidgetSubtitleTextColor: C.muted,
  studioPanelHeaderFontFamily: SERIF,
  studioPanelHeaderFontSize: 17,
  studioPanelHeaderFontWeight: 500,
  studioPanelContainerBackgroundColor: C.surface,
  gridHeaderBackgroundColor: C.paper,
  gridHeaderFontWeight: 500,
  gridHeaderTextColor: C.muted,
  gridOddRowBackgroundColor: C.surface,
  gridRowHoverColor: "#1A1A18",
  valueChangeUpColor: C.proof,
  valueChangeHighlightBackgroundColor: C.proofTint,
  chartAccentColor: C.proof,
  chartFontFamily: SANS,
  chartTextColor: C.ink,
  chartSubtleTextColor: C.muted,
  chartGridLineColor: C.hairline,
  chartAxisLineColor: C.quiet,
  // Proof green first: a chart of money paid reads in the colour the page uses for "paid".
  chartPaletteFills1Color: C.proof,
  chartPaletteFills2Color: C.amber,
  chartPaletteFills3Color: C.muted,
  chartPaletteFills4Color: "#2F7A58",
  chartPaletteFills5Color: "#8A6A2A",
});
