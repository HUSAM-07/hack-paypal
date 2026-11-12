import { useCallback, useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "theme";
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Same convention as the site's theme.js: `.light` / `.dark` on <html>, nothing for system. */
export function applyTheme(choice: ThemeChoice = read()) {
  const root = document.documentElement;
  root.classList.toggle("dark", choice === "dark");
  root.classList.toggle("light", choice === "light");
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const value = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => "system" as const,
  );
  const set = useCallback((c: ThemeChoice) => {
    try {
      if (c === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    applyTheme(c);
    for (const fn of listeners) fn();
  }, []);
  return [value, set];
}
