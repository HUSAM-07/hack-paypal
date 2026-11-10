import type { Scope } from "@cited/studio/tables";

/**
 * The money toggle lives in the URL as `?view=first` (First payout) or `?view=total`
 * (Programme to date), so a link opens on the figures it means. `?clean=1` is the link the video
 * and Devpost use, which lead with the first payout. `?scope=first` is the older form.
 */
export function scopeFromParams(params: URLSearchParams): Scope {
  const view = params.get("view");
  if (view === "first") return "first";
  if (view === "total") return "todate";
  if (params.get("clean") === "1" || params.get("scope") === "first") return "first";
  return "todate";
}

/** The page's query string with the toggle's state in it (and the older `scope` dropped). */
export function searchWithScope(search: string, scope: Scope): string {
  const params = new URLSearchParams(search);
  params.delete("scope");
  params.set("view", scope === "first" ? "first" : "total");
  return `?${params}`;
}
