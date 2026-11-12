// Applies the saved theme before first paint. External (not inline) so a strict CSP
// with script-src 'self' still allows it. With nothing saved, pages follow the OS
// where they support dark, else stay light.
try {
  const t = localStorage.getItem("pact-theme");
  if (t === "dark") {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  } else if (t === "light") {
    document.documentElement.classList.add("light");
  }
} catch (_) {}
