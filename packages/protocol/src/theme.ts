/**
 * The CITED design system: the one place colour values live. Every page, server-rendered or
 * React, reads these semantic custom properties and never a literal colour (a test enforces it).
 *
 * The names follow shadcn/ui's semantic set (background, foreground, primary, muted, accent, border,
 * ring, destructive, ...), the palette is its neutral scale with a blue primary, plus three
 * CITED roles: `warning` (money still held, the placebo arm), `subtle` (faint marks, the
 * nothing arm) and `paypal` (PayPal's own blue, for its name only).
 */

const LIGHT = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  "card-foreground": "#0a0a0a",
  popover: "#ffffff",
  "popover-foreground": "#0a0a0a",
  primary: "#1447e6",
  "primary-foreground": "#fafafa",
  secondary: "#f4f4f5",
  "secondary-foreground": "#18181b",
  muted: "#f5f5f5",
  "muted-foreground": "#737373",
  accent: "#f5f5f5",
  "accent-foreground": "#171717",
  destructive: "#e7000b",
  "destructive-foreground": "#fafafa",
  warning: "#b45309",
  "warning-foreground": "#fafafa",
  subtle: "#d4d4d4",
  border: "#e5e5e5",
  input: "#e5e5e5",
  ring: "#a1a1a1",
  paypal: "#003087",
  "chart-1": "#1447e6",
  "chart-2": "#5b7ff0",
  "chart-3": "#a5b8f7",
  "chart-4": "#b45309",
  "chart-5": "#a1a1a1",
  "shadow-color": "rgb(0 0 0 / 0.12)",
};

/** Every token, with the dark theme's value (same names as LIGHT, enforced by the type). */
const DARK: Record<keyof typeof LIGHT, string> = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  "card-foreground": "#fafafa",
  popover: "#171717",
  "popover-foreground": "#fafafa",
  primary: "#50a2ff",
  "primary-foreground": "#1c398e",
  secondary: "#27272a",
  "secondary-foreground": "#fafafa",
  muted: "#262626",
  "muted-foreground": "#a1a1a1",
  accent: "#262626",
  "accent-foreground": "#fafafa",
  destructive: "#ff6467",
  "destructive-foreground": "#0a0a0a",
  warning: "#fbbf24",
  "warning-foreground": "#0a0a0a",
  subtle: "#404040",
  border: "rgb(255 255 255 / 0.1)",
  input: "rgb(255 255 255 / 0.15)",
  ring: "#737373",
  paypal: "#7fb0ff",
  "chart-1": "#50a2ff",
  "chart-2": "#3b6fd8",
  "chart-3": "#28447e",
  "chart-4": "#fbbf24",
  "chart-5": "#737373",
  "shadow-color": "rgb(0 0 0 / 0.55)",
};

export type SiteToken = keyof typeof LIGHT;
export const SITE_TOKENS: { light: Record<SiteToken, string>; dark: Record<SiteToken, string> } = {
  light: LIGHT,
  dark: DARK,
};

/**
 * Tokens derived from the palette (tints, bands, hover), plus type and layout. They hold no colour
 * of their own, so a theme swap only has to change SITE_TOKENS.
 */
const DERIVED = [
  "--radius:.45rem",
  "--band:color-mix(in oklab,var(--muted) 45%,transparent)",
  "--hover:color-mix(in oklab,var(--muted) 70%,transparent)",
  "--primary-soft:color-mix(in oklab,var(--primary) 12%,transparent)",
  "--warning-soft:color-mix(in oklab,var(--warning) 14%,transparent)",
  "--destructive-soft:color-mix(in oklab,var(--destructive) 12%,transparent)",
  "--fill:color-mix(in oklab,var(--foreground) 5%,transparent)",
  "--fill-strong:color-mix(in oklab,var(--foreground) 9%,transparent)",
  "--shadow-sticker:drop-shadow(0 6px 10px var(--shadow-color)) drop-shadow(0 1px 1px var(--shadow-color))",
  "--shadow-pop:0 0 0 1px var(--border),0 16px 40px -12px var(--shadow-color)",
  '--font-sans:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif',
  '--font-serif:"Instrument Serif",ui-serif,Georgia,serif',
  '--font-mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace',
  '--font-hand:"Caveat","Bradley Hand",cursive',
  "--frame:768px",
  "--frame-wide:1200px",
  "--pad:24px",
].join(";");

const decl = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");

/**
 * Light by default, dark when the OS asks for it, and either one when the visitor chose it with
 * the top bar's toggle (public/theme.js puts `.light` or `.dark` on <html> before first paint).
 */
export const SITE_TOKENS_CSS = [
  `:root{color-scheme:light;${decl(SITE_TOKENS.light)};${DERIVED}}`,
  `@media (prefers-color-scheme:dark){:root:not(.light){color-scheme:dark;${decl(SITE_TOKENS.dark)}}}`,
  `:root.dark{color-scheme:dark;${decl(SITE_TOKENS.dark)}}`,
].join("");

/** Self-hosted fonts (the CSP allows `font-src 'self'` only). */
export const SITE_FONTS_CSS = [
  '@font-face{font-family:"DM Sans";font-style:normal;font-weight:100 1000;font-display:swap;src:url("/fonts/dm-sans-latin-v1.woff2") format("woff2-variations")}',
  '@font-face{font-family:"Instrument Serif";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/instrument-serif-latin-v1.woff2") format("woff2")}',
  '@font-face{font-family:"Instrument Serif";font-style:italic;font-weight:400;font-display:swap;src:url("/fonts/instrument-serif-latin-italic-v1.woff2") format("woff2")}',
  '@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/geist-mono-latin-v1.woff2") format("woff2-variations")}',
  '@font-face{font-family:"Caveat";font-style:normal;font-weight:400 700;font-display:swap;src:url("/fonts/caveat-latin-v1.woff2") format("woff2-variations")}',
].join("");

/**
 * Base rules and the shared layout primitives, as on the landing: a bordered column (`.ui-frame`,
 * or `.ui-frame-wide` for app pages), sections divided by dashed rules (`.ui-band`) with a tinted
 * heading strip (`.ui-band-h`), rows, a two-column cell grid, pill buttons and mono labels.
 */
export const SITE_BASE_CSS = [
  "html{-webkit-text-size-adjust:100%}",
  "body{margin:0;background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-synthesis-weight:none;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}",
  "::selection{background:var(--primary-soft);color:var(--foreground)}",
  ":focus-visible{outline:2px solid var(--primary);outline-offset:2px}",
  ".theme-sun{display:none}:root.dark .theme-sun{display:block}:root.dark .theme-moon{display:none}",
  "@media (prefers-color-scheme:dark){:root:not(.light) .theme-sun{display:block}:root:not(.light) .theme-moon{display:none}}",
  ".ui-frame,.ui-frame-wide{box-sizing:border-box;position:relative;margin:0 auto;min-height:100dvh;border-inline:1px solid var(--border);background:var(--background)}",
  ".ui-frame{max-width:var(--frame)}.ui-frame-wide{max-width:var(--frame-wide)}",
  ".ui-band{position:relative;border-top:1px dashed var(--border);padding:24px 0 28px}",
  ".ui-band-h{margin:0 0 14px;padding:8px var(--pad);background:var(--band);border-block:1px dashed var(--border);font:600 20px/1.4 var(--font-sans);letter-spacing:-.01em;color:var(--foreground)}",
  ".ui-band-body{padding:0 var(--pad)}",
  ".ui-serif{font-family:var(--font-serif);font-weight:400;letter-spacing:-.01em}",
  ".ui-hand{font-family:var(--font-hand)}",
  ".ui-mono,.ui-label{font-family:var(--font-mono)}",
  ".ui-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}",
  ".ui-muted{color:var(--muted-foreground)}",
  ".ui-chip{display:inline-block;padding:2px 9px 1px;font:italic 400 18px/1.25 var(--font-serif);background:var(--band);box-shadow:inset 0 0 0 1px var(--border);border-radius:3px}",
  ".ui-row{display:flex;align-items:center;gap:12px;min-height:44px;padding:8px 12px;border-radius:4px;color:inherit;text-decoration:none;transition:background-color .15s}",
  ".ui-row:hover{background:var(--hover)}",
  ".ui-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px dashed var(--border)}",
  ".ui-grid2>*{border-bottom:1px dashed var(--border)}.ui-grid2>:nth-child(odd){border-right:1px dashed var(--border)}",
  "@media (max-width:640px){.ui-grid2{grid-template-columns:minmax(0,1fr)}.ui-grid2>:nth-child(odd){border-right:0}}",
  ".ui-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 14px;border:0;border-radius:10px;font:500 14px/1 var(--font-sans);text-decoration:none;white-space:nowrap;cursor:pointer;transition:background-color .15s,opacity .15s,transform .15s}",
  ".ui-btn:active{transform:scale(.97)}",
  ".ui-btn-solid{background:var(--foreground);color:var(--background)}.ui-btn-solid:hover{opacity:.86}",
  ".ui-btn-quiet{background:var(--fill);color:var(--foreground)}.ui-btn-quiet:hover{background:var(--fill-strong)}",
  ".ui-btn-primary{background:var(--primary-soft);color:var(--primary)}",
  ".ui-card{background:var(--card);color:var(--card-foreground);border:1px dashed var(--border);border-radius:6px}",
  ".ui-dots{background:radial-gradient(circle at 1px 1px,var(--border) 1px,transparent 0) 0 0/16px 16px}",
  "code{font-family:var(--font-mono);font-size:.86em;padding:.12em .36em;border-radius:5px;background:var(--band);box-shadow:inset 0 0 0 1px var(--border)}",
].join("");

/** Fonts, tokens and base rules: everything a page needs before its own CSS. */
export const SITE_STYLE_CSS = SITE_FONTS_CSS + SITE_TOKENS_CSS + SITE_BASE_CSS;
