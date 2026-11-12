import type { Scope } from "@cited/studio/tables";

/** What the page hands every widget through AG Studio's `context` property. */
export interface StudioContext {
  view: "brand" | "creator" | "trust";
  brandId: string;
  creatorId: string;
  /** "First payout" (the day-30 batch) or "Programme to date". */
  scope: Scope;
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
