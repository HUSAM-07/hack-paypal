import { studioTheme } from "ag-studio";

/**
 * CITED's palette, shared with the landing page. Proof cobalt is the one strong colour: it marks
 * what the test caused and what was paid. Amber marks money still held (30-day hold, disputes).
 */
export const C = {
  paper: "#FAFAFA",
  surface: "#FFFFFF",
  ink: "#0A0A0A",
  muted: "#737373",
  proof: "#2547D0",
  proofTint: "#E9EDFB",
  amber: "#B7791F",
  amberTint: "#F5EAD6",
  hairline: "#E5E5E5",
  quiet: "#C4C4C4",
} as const;

export const SERIF = `"Instrument Serif", Georgia, "Times New Roman", serif`;
export const SANS = `"DM Sans", system-ui, sans-serif`;

export const citedTheme = studioTheme.withParams({
  browserColorScheme: "light",
  backgroundColor: C.paper,
  foregroundColor: C.ink,
  textColor: C.ink,
  subtleTextColor: C.muted,
  accentColor: C.proof,
  borderColor: C.hairline,
  fontFamily: SANS,
  fontSize: 14,
  borderRadius: 6,
  invalidColor: "#9B3B2A",
  studioWrapperBackgroundColor: C.paper,
  studioCanvasBackgroundColor: C.paper,
  studioCanvasFontFamily: SANS,
  studioWidgetBackgroundColor: C.surface,
  studioWidgetBorder: { color: C.hairline, width: 1 },
  studioWidgetBorderRadius: 10,
  studioWidgetShadow: "none",
  studioWidgetTitleFontFamily: SERIF,
  studioWidgetTitleFontSize: 19,
  studioWidgetTitleFontWeight: 500,
  studioWidgetTitleTextColor: C.ink,
  studioWidgetSubtitleTextColor: C.muted,
  studioPanelHeaderFontFamily: SERIF,
  studioPanelHeaderFontSize: 17,
  studioPanelHeaderFontWeight: 500,
  studioPanelContainerBackgroundColor: C.surface,
  gridHeaderBackgroundColor: C.paper,
  gridHeaderFontWeight: 600,
  gridHeaderTextColor: C.muted,
  gridOddRowBackgroundColor: C.surface,
  gridRowHoverColor: "#F1EEE7",
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
  chartPaletteFills4Color: "#8FB8A2",
  chartPaletteFills5Color: "#D9B98A",
});
