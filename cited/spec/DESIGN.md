# CITED design system

Every CITED page uses one theme: the landing at `/` is the reference implementation. Anything you
build or import (shadcn, agentsUI, Magic UI, AG Studio widgets, hand-written pages) must use it.
`npm test` enforces the colour rule; the rest is review.

## 1. Colours: semantic tokens only

Colour values live in **one file**: [`packages/protocol/src/theme.ts`](../../packages/protocol/src/theme.ts)
(`SITE_TOKENS`, light and dark). Everything else reads them with `var(--token)`.

- No hex, `rgb()`, `hsl()`, `oklch()`, `lab()`, named `white`/`black`, Tailwind fixed-palette classes
  (`bg-white`, `text-zinc-500`, `ring-black/5`) or arbitrary colour values (`shadow-[0_0_rgba(…)]`).
  `apps/web/src/styles/no-raw-colours.test.ts` fails the build on any of them.
- No `var(--x, #fallback)` fallbacks: the tokens are always loaded.
- Need a tint? Use a derived token (`--primary-soft`, `--warning-soft`, `--destructive-soft`, `--fill`,
  `--fill-strong`, `--band`, `--hover`); small coloured text on a soft tint uses `--warning-text` /
  `--destructive-text`, and small grey text on a tint uses `--muted-text` (all AA-safe) or `color-mix(in oklab, var(--token) N%, transparent)`.
- Need a new role? Add it to `SITE_TOKENS` (light **and** dark), then run
  `npx tsx apps/web/scripts/gen-theme-css.ts`. Don't invent colours locally.

| Token | Use |
| --- | --- |
| `--background` / `--foreground` | page and body text; solid buttons are foreground-on-background |
| `--card`, `--popover` (+ `-foreground`) | raised surfaces |
| `--muted` / `--muted-foreground` | quiet surfaces / secondary text |
| `--accent` / `--accent-foreground` | neutral hover and selection surfaces (shadcn meaning, **not** a brand colour) |
| `--primary` / `--primary-foreground` | the one strong colour: links, the active nav pill, **the test arm, caused sales, money paid** |
| `--warning` | **the placebo arm, money still held, disputes** |
| `--destructive` | **voided credits, refunds, errors** |
| `--subtle` | **the nothing arm**, faint marks and glyphs |
| `--border`, `--input`, `--ring` | hairlines (dashed for dividers), form borders, focus |
| `--paypal` | PayPal's name only |
| `--chart-1…5` | charts (blue ramp, then warning, then neutral) |

Dark mode is a token swap: `.dark` on `<html>` (the top bar's toggle, saved by `public/theme.js`),
or the OS setting unless `.light` is set. Never write a separate dark palette in a page.

## 2. Type

Fonts are self-hosted (CSP is `font-src 'self'`) and declared once in the theme:

- `--font-sans`: **DM Sans** for body and UI text (14–15px body, 600 for headings and strips).
- `--font-serif`: **Instrument Serif** (400, plus italic) for display headlines, section titles and italic chips.
- `--font-mono`: **Geist Mono** for labels (11px, uppercase, `letter-spacing: .06em`), figures, code and paths.
- `--font-hand`: **Caveat** for the occasional margin note only.

Body has `font-synthesis-weight: none`: don't ask Instrument Serif for bold.

## 3. Layout

The page is a sheet of paper: one bordered column, sections stacked with dashed rules.

- `.ui-frame` (768px, content pages) or `.ui-frame-wide` (1200px, app pages such as console, /try, Studio).
  Both carry the 1px side borders; the top bar lines up with them (`site-col` on `<body>` for 768px pages).
- `.ui-band`: a section with a dashed top rule; `.ui-band-h`: its tinted heading strip (DM Sans 20/600,
  short, like "The proof"). Put a longer serif title under the strip if needed.
- `.ui-row` (list row with a ↗ arrow), `.ui-grid2` (two-column cell grid with dashed rules),
  `.ui-card` (dashed card), `.ui-dots` (dotted figure background), `.ui-chip` (serif italic chip),
  `.ui-label` (mono uppercase label), `.ui-btn` with `-solid`, `-quiet` or `-primary`.
- Radius: `--radius` (0.45rem) for controls, 10px for buttons and pills, 6px for cards. No big rounded cards.
- Spacing: `--pad` (24px, 16px under 640px) inside the column.

Server-rendered pages: put `SITE_THEME_CSS` **first** in `<style>`, then the page CSS, then
`SITE_HEADER_CSS`; put `SITE_HEAD_HTML` in `<head>` and `siteHeader()` at the top of `<body>`.
React entries: import `styles/site-theme.css` first and render `<SiteHeader />`; put
`<!--site-head-->` in the HTML entry (Vite fills it in).

## 4. Art

- Sticker illustrations: die-cut, engraved/halftone print style, cobalt accents, white border, alpha
  WebP in `apps/web/public/art/stickers/` (13 exist: cart, coins, dice, envelope, folder, hourglass,
  magnifier, microphone, passport, purifier, receipt, robot, stamp). Use them small, beside headings,
  with `filter: var(--shadow-sticker)` and `alt=""`. To add one, generate it with the Codex CLI
  (`image_generation`) in the same style and run `scripts/optimize-stickers.ts`.
- The mark (`SITE_MARK` in `packages/protocol/src/meta.ts`) is the only logo. Favicon, app icons and the
  manifest are generated from it by `scripts/gen-icons.ts`; don't hand-edit them.
- The dither field (`components/magicui/dither-field.tsx`) is for the footer and the bottom fade.

## 5. Imported components

Before using a component from shadcn, agentsUI (components.ihusam.tech), Magic UI or elsewhere:

1. Replace its colours with the tokens above (shadcn's own names already match: `bg-background`,
   `text-muted-foreground`, `border-border`, `bg-primary`…). Remove any `dark:` palette overrides:
   tokens already switch.
2. Swap its fonts for the theme fonts and its radii for the ones above; prefer dashed hairlines to shadows.
3. If it ships Tailwind classes but the page is plain CSS (landing, server pages), convert to inline
   styles or a scoped stylesheet (see the vendored dither field).
4. Run `npm test` (colour guard) and look at it in light, dark and at 375px.

## 6. Responsive and accessible

- Works from 320px up; no horizontal page scroll at 375px. Breakpoints in use: 640px (single column,
  `--pad` 16px), 760px (nav wraps under the mark), 1100px (left rail hides), 1180px (margin notes hide).
- Touch targets at least 40×40px on coarse pointers (the shared header already does this).
- Every page has the skip link (`siteHeader` / `<SiteHeader skip />`) and a `<main id="main">`.
- Visible focus: `:focus-visible` uses `--primary`. Text meets WCAG AA on both themes (the token
  pairs are chosen for it; check new combinations). `--muted-foreground` is for text on `--background`
  or `--card` only; on tints use `--foreground` or the `-text` tokens.
- Animations respect `prefers-reduced-motion`.
- Decorative art has `alt=""`/`aria-hidden`; meaning is always in text too.

## 7. Metadata

`SITE_HEAD_HTML` carries icons, the manifest, theme colours and theme.js. Give each new public page a
title and `siteMeta({ title, description, path })` (or an entry in `apps/worker/src/link-preview.ts`),
and add it to `SITE_PAGES` (sitemap) in `packages/protocol/src/meta.ts`. Pages not meant to be found
get `noindex: true`.
