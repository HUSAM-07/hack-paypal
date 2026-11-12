# CITED motion video

A HyperFrames (HTML to video) composition, about 67 seconds. It shows CITED's two verticals:
- **Shop:** a generative-UI chat with product cards, a comparison, an approval, the undo timer and a price watch that auto-buys.
- **Creators:** the three arms, 147 sessions and the PayPal API trail ending in the payout.

Every widget on screen is our own markup and CSS, captured from the running apps. Colours come from `@pact/protocol`'s theme.

## Rebuild

1. Capture the Shop widget states:
   ```bash
   npm run dev -w @shop/web -- --port 5192
   node video/scripts/capture-shop.mjs http://localhost:5192/
   ```
   The shop runs in mock mode, with no backend.
2. Capture the CITED figures from a locally running pact-worker (here on :8796):
   ```bash
   node video/scripts/capture-cited.mjs http://localhost:8796
   ```
3. Build the composition:
   ```bash
   npx tsx video/scripts/build.mjs
   ```
   This writes `video/index.html`.
4. Render:
   ```bash
   cd video && npx hyperframes render . -f 30 --crf 20 -o out/cited-motion-1080p30.mp4
   ```
   - For a master, use `-f 60 -q delivery`, or `--format mov --prores-profile hq`.
   - To check frames before rendering: `npx hyperframes snapshot --at 5,20,40`.

## Editing

- Scene markup is in `src/scenes.html`. Each `<section>` has a `data-start` and `data-duration`.
- The motion is in `src/timeline.js`: one GSAP timeline in absolute seconds, kept in step with the scenes.
- Layout is in `src/video.css`, which uses tokens only.
- Placeholders:
  - `{{item:N}}` is a captured Shop thread item (indices are printed by `capture-shop.mjs`).
  - `{{cited:name}}` is a captured CITED figure.
  - `{{title:…}}` is a word-by-word title. Wrap a word in `*…*` for the serif accent.
- Renders go to `video/out/`, which is gitignored.
