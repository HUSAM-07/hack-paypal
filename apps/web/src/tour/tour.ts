import {
  neighbour,
  resolveStop,
  stopHref,
  TOUR_PARAM,
  TOUR_STOPS,
  TOUR_STORAGE_KEY,
  withoutTour,
} from "./steps";

/**
 * The judge tour's bar: a small dock at the bottom of the page, drawn only when the tour was
 * started (`?tour=N`). Plain DOM so the server-rendered pages and the React ones share it, and
 * styled by its own sheet (CSP allows inline style, not inline script) so it needs nothing
 * from the page. Every control is a real link or button; nothing here ever clicks for the user.
 */
const FOCUS_KEY = "cited-tour-focus";
const BAR_ID = "cited-tour";

const CSS = `
html.cited-tour-on body{padding-bottom:var(--ct-h,0px)}
#${BAR_ID}{position:fixed;left:0;right:0;bottom:0;z-index:1000;box-sizing:border-box;background:var(--foreground);color:var(--background);border-top:1px dashed var(--border);font:400 14px/1.45 var(--font-sans);padding:10px max(16px,env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
#${BAR_ID} *{box-sizing:border-box}
#${BAR_ID} .ct-in{max-width:var(--frame-wide);margin:0 auto;display:flex;align-items:center;gap:8px 20px;flex-wrap:wrap}
#${BAR_ID} .ct-text{flex:1 1 320px;min-width:0}
#${BAR_ID} .ct-meta{display:flex;gap:10px;align-items:baseline;font:500 11px/1.2 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:color-mix(in oklab,var(--background) 65%,transparent);margin:0 0 3px}
#${BAR_ID} .ct-cap{margin:0;color:var(--background)}
#${BAR_ID} .ct-btns{display:flex;gap:8px;flex:0 0 auto}
#${BAR_ID} .ct-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:40px;min-width:40px;padding:0 16px;border-radius:10px;border:1px solid color-mix(in oklab,var(--background) 35%,transparent);background:transparent;color:var(--background);font-size:13px;font-weight:500;line-height:1;font-family:inherit;text-decoration:none;cursor:pointer}
#${BAR_ID} .ct-btn:hover{border-color:var(--background)}
#${BAR_ID} .ct-next{background:var(--background);border-color:var(--background);color:var(--foreground)}
#${BAR_ID} .ct-next:hover{opacity:.9}
#${BAR_ID} .ct-btn[disabled]{opacity:.45;cursor:default}
#${BAR_ID} .ct-btn:focus-visible{outline:3px solid var(--background);outline-offset:2px;box-shadow:0 0 0 5px var(--foreground)}
@media (pointer:coarse){#${BAR_ID} .ct-btn{min-height:44px;min-width:44px}}
@media (max-width:640px){
#${BAR_ID}{padding-top:8px;padding-bottom:calc(8px + env(safe-area-inset-bottom))}
#${BAR_ID} .ct-in{gap:6px 12px}
#${BAR_ID} .ct-meta{margin-bottom:2px}
#${BAR_ID} .ct-cap{font-size:12.5px;line-height:1.4}
#${BAR_ID} .ct-btns{flex:1 1 100%;justify-content:space-between}
#${BAR_ID} .ct-btn{flex:1 1 0;padding:0 8px}
}
`;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // storage blocked: the URL still carries the tour
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function removeTour() {
  document.getElementById(BAR_ID)?.remove();
  document.getElementById(`${BAR_ID}-css`)?.remove();
  document.documentElement.classList.remove("cited-tour-on");
  document.documentElement.style.removeProperty("--ct-h");
}

function exit() {
  write(TOUR_STORAGE_KEY, null);
  write(FOCUS_KEY, null);
  const { pathname, search, hash } = window.location;
  window.history.replaceState(window.history.state, "", withoutTour({ pathname, search, hash }));
  removeTour();
}

/** Draws the bar if (and only if) the tour is on for this page. Returns the stop shown, if any. */
export function mountTour(): number | null {
  const n = resolveStop(window.location, read(TOUR_STORAGE_KEY));
  if (!n) return null;
  if (document.getElementById(BAR_ID)) return n;
  write(TOUR_STORAGE_KEY, String(n));

  // The stop is in the URL, so a page that dropped it (an app rewriting its own query) gets it back.
  const here = new URLSearchParams(window.location.search);
  if (here.get(TOUR_PARAM) !== String(n)) {
    here.set(TOUR_PARAM, String(n));
    const { pathname, hash } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}?${here}${hash}`);
  }

  const stop = TOUR_STOPS[n - 1];
  if (!stop) return null;
  const count = TOUR_STOPS.length;
  const style = document.createElement("style");
  style.id = `${BAR_ID}-css`;
  style.textContent = CSS;
  document.head.append(style);

  const bar = el("div", "");
  bar.id = BAR_ID;
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Guided tour");
  const inner = el("div", "ct-in");
  const text = el("div", "ct-text");
  const meta = el("p", "ct-meta");
  meta.append(el("span", "", `Tour ${n} of ${count}`), el("span", "", stop.label));
  const cap = el("p", "ct-cap");
  cap.setAttribute("aria-live", "polite");
  text.append(meta, cap);

  const btns = el("div", "ct-btns");
  const prev = neighbour(n, -1);
  const next = neighbour(n, 1);
  const markFocus = () => write(FOCUS_KEY, "1");

  let back: HTMLElement;
  if (prev) {
    const a = el("a", "ct-btn", "Back");
    a.href = stopHref(prev);
    a.addEventListener("click", markFocus);
    back = a;
  } else {
    const b = el("button", "ct-btn", "Back");
    b.type = "button";
    b.disabled = true;
    back = b;
  }
  let forward: HTMLElement;
  if (next) {
    const a = el("a", "ct-btn ct-next", "Next");
    a.href = stopHref(next);
    a.addEventListener("click", markFocus);
    forward = a;
  } else {
    const b = el("button", "ct-btn ct-next", "Finish");
    b.type = "button";
    b.addEventListener("click", exit);
    forward = b;
  }
  const quit = el("button", "ct-btn", "Exit tour");
  quit.type = "button";
  quit.addEventListener("click", exit);
  btns.append(back, forward);
  if (next) btns.append(quit);
  inner.append(text, btns);
  bar.append(inner);

  // First in the page, so Tab reaches it at once; it is fixed to the bottom either way.
  document.body.prepend(bar);
  document.documentElement.classList.add("cited-tour-on");
  const size = () =>
    document.documentElement.style.setProperty("--ct-h", `${bar.getBoundingClientRect().height}px`);
  size();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(size).observe(bar);
  // Set after insertion so a screen reader announces the new stop's caption.
  requestAnimationFrame(() => {
    cap.textContent = stop.caption;
    size();
  });

  // After Back or Next the page is new, so keyboard users land on the bar again. A page that
  // jumps to a #section or hydrates after this runs can drop focus, so try once more on load.
  if (read(FOCUS_KEY)) {
    write(FOCUS_KEY, null);
    const focus = () => {
      const a = document.activeElement;
      if (!a || a === document.body) forward.focus({ preventScroll: true });
    };
    focus();
    if (document.readyState !== "complete") window.addEventListener("load", focus, { once: true });
    else setTimeout(focus, 100);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (document.querySelector('[role="dialog"][open], [aria-modal="true"]')) return;
    exit();
  });
  return n;
}
