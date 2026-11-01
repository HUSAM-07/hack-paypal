// Must load before @openuidev/react-lang: claims its dev-only auto-mount flag so the
// Inspect widget stays out of the demo. Add `?devtools` to the URL to bring it back.
if (!new URLSearchParams(window.location.search).has("devtools")) {
  (globalThis as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;
}

export {};
