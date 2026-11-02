// Applies the saved theme before first paint. External (not inline) so a strict CSP
// with script-src 'self' still allows it. Light is the default.
try {
  if (localStorage.getItem("pact-theme") === "dark") {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }
} catch (_) {}
