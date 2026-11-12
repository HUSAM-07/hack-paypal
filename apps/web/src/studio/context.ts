import type { RawWhatIf, Scope } from "@cited/studio/tables";

/** What the page hands every widget through AG Studio's `context` property. */
export interface StudioContext {
  view: "brand" | "creator" | "trust" | "programmes";
  brandId: string;
  creatorId: string;
  /** "First payout" (the day-30 batch) or "Programme to date". */
  scope: Scope;
  /** The hosted demo: writes are locked, so a started programme stays in this browser. */
  demo?: boolean;
}

/**
 * AG Studio reads its `context` property once (@initial), so the scope toggle lives here and the
 * widgets subscribe to it. The context object is kept in step for the agents' tools.
 */
let currentScope: Scope = "todate";
const scopeListeners = new Set<() => void>();
export const scopeStore = {
  get: (): Scope => currentScope,
  set(s: Scope) {
    if (s === currentScope) return;
    currentScope = s;
    for (const l of scopeListeners) l();
  },
  subscribe(l: () => void) {
    scopeListeners.add(l);
    return () => scopeListeners.delete(l);
  },
};

/**
 * The recorded sales the commission what-if re-prices. They arrive with every poll but are not a
 * Studio table (a nested list of sales does not fit a row), so the widget reads them from here.
 */
let currentWhatIf: RawWhatIf | null = null;
const whatIfListeners = new Set<() => void>();
export const whatIfStore = {
  get: (): RawWhatIf | null => currentWhatIf,
  set(w: RawWhatIf | null) {
    // A poll that found nothing new hands back an equal copy; skip it so the panel does not redraw.
    if (JSON.stringify(w) === JSON.stringify(currentWhatIf)) return;
    currentWhatIf = w;
    for (const l of whatIfListeners) l();
  },
  subscribe(l: () => void) {
    whatIfListeners.add(l);
    return () => whatIfListeners.delete(l);
  },
};
