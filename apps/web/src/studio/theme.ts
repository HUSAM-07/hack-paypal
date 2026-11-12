import { studioTheme } from "ag-studio";

/**
 * AG Studio, AG Grid and AG Charts read CITED's semantic tokens (packages/protocol/src/theme.ts),
 * never a colour of their own. The Theming API writes each param into a CSS variable, so
 * `var(--border)` follows the page's light or dark theme. Charts draw on a canvas: Studio resolves
 * their params from computed styles and re-reads them when the page's colours change (its style
 * sensor watches the grid's foreground and background), so a theme flip repaints them too.
 *
 * Chart colours must resolve to plain colours (Studio converts only rgb() to hex), so chart params
 * use base tokens, never the color-mix() tints.
 */
const t = (name: string) => `var(--${name})`;

const SANS = t("font-sans");
const SERIF = t("font-serif");

export const citedTheme = studioTheme.withParams({
  browserColorScheme: "inherit",
  backgroundColor: t("card"),
  foregroundColor: t("foreground"),
  textColor: t("foreground"),
  subtleTextColor: t("muted-foreground"),
  accentColor: t("primary"),
  borderColor: t("border"),
  fontFamily: SANS,
  fontSize: 14,
  borderRadius: 6,
  invalidColor: t("destructive"),
  studioWrapperBackgroundColor: t("background"),
  studioCanvasBackgroundColor: t("background"),
  studioCanvasFontFamily: SANS,
  studioWidgetBackgroundColor: t("card"),
  studioWidgetBorder: { style: "dashed", color: t("border"), width: 1 },
  studioWidgetBorderRadius: 6,
  studioWidgetShadow: "none",
  studioWidgetTitleFontFamily: SERIF,
  studioWidgetTitleFontSize: 22,
  studioWidgetTitleFontWeight: 400,
  studioWidgetTitleTextColor: t("foreground"),
  studioWidgetSubtitleTextColor: t("muted-foreground"),
  studioPanelHeaderFontFamily: SERIF,
  studioPanelHeaderFontSize: 20,
  studioPanelHeaderFontWeight: 400,
  studioPanelContainerBackgroundColor: t("card"),
  gridHeaderBackgroundColor: t("band"),
  gridHeaderFontWeight: 600,
  gridHeaderTextColor: t("muted-foreground"),
  gridOddRowBackgroundColor: t("card"),
  gridRowHoverColor: t("hover"),
  valueChangeUpColor: t("primary"),
  valueChangeHighlightBackgroundColor: t("primary-soft"),
  chartAccentColor: t("primary"),
  chartFontFamily: SANS,
  chartTextColor: t("foreground"),
  chartSubtleTextColor: t("muted-foreground"),
  chartGridLineColor: t("border"),
  chartAxisLineColor: t("subtle"),
  // Primary first: a chart of money paid reads in the colour the page uses for "paid".
  chartPaletteFills1Color: t("chart-1"),
  chartPaletteFills2Color: t("chart-4"),
  chartPaletteFills3Color: t("chart-2"),
  chartPaletteFills4Color: t("chart-3"),
  chartPaletteFills5Color: t("chart-5"),
});
