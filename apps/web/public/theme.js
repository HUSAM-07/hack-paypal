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
  // The top bar's account link says "Sign in" in the HTML; a signed-in visitor sees "Home".
  // /api/session only checks the cookie's signature, so asking on every page is cheap.
  const account = () => {
    const links = document.querySelectorAll("[data-account]");
    if (!links.length) return;
    fetch("/api/session", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!s || !s.signedIn) return;
        for (const a of links) {
          a.textContent = "Home";
          a.setAttribute("data-signed-in", "");
        }
      })
      .catch(() => {});
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", account);
  else account();
})();
