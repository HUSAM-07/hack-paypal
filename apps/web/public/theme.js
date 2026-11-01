// Applies the saved theme before first paint. External (not inline) so a strict CSP
// with script-src 'self' still allows it.
try {
  if (localStorage.getItem("pact-theme") === "light")
    document.documentElement.classList.remove("dark");
} catch (_) {}
