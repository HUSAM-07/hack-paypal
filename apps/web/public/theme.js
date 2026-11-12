// Theme for every CITED page. Runs in <head>: applies the saved light/dark choice before first
// paint, then wires every [data-theme-toggle] button (delegated, so it works for server-rendered
// and React pages alike). External, not inline, so a CSP with script-src 'self' allows it.
// With nothing saved, pages follow the OS.
(() => {
  const root = document.documentElement;
  const apply = (t) => {
    root.classList.toggle("dark", t === "dark");
    root.classList.toggle("light", t === "light");
  };
  try {
    const saved = localStorage.getItem("pact-theme");
    if (saved === "dark" || saved === "light") apply(saved);
  } catch (_) {}
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-theme-toggle]") : null;
    if (!target) return;
    const dark = root.classList.contains("dark")
      ? true
      : root.classList.contains("light")
        ? false
        : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    apply(next);
    try {
      localStorage.setItem("pact-theme", next);
    } catch (_) {}
  });
})();
