/**
 * Which funded brand the brand view shows. It lives in the URL as `?brand=roborock`, so a link
 * opens a brand; Winix is the default and leaves the URL as it always was. The list of brands
 * comes from the engine data Studio already loads (the `brands` table), never a list of ours.
 */
export const DEFAULT_BRAND = "winix";

export interface BrandOption {
  brandId: string;
  /** The brand's name: "Winix", "Roborock". */
  brand: string;
  /** The programme's category as the engine names it: "purifier", "robot-vacuum". */
  category: string;
}

/** The distinct brands in the `brands` table rows (one row per brand per scope), the default brand first. */
export function brandOptions(rows: readonly Record<string, unknown>[] | undefined): BrandOption[] {
  const seen = new Map<string, BrandOption>();
  for (const r of rows ?? []) {
    const id = typeof r.brandId === "string" ? r.brandId : "";
    if (!id || seen.has(id)) continue;
    seen.set(id, {
      brandId: id,
      brand: typeof r.brand === "string" && r.brand ? r.brand : id,
      category: typeof r.category === "string" ? r.category : "",
    });
  }
  // The default brand first, the others in the engine's order.
  return [...seen.values()].sort(
    (a, b) => Number(b.brandId === DEFAULT_BRAND) - Number(a.brandId === DEFAULT_BRAND),
  );
}

/** The brand a link asks for; one the data does not have falls back to Winix. */
export function brandFromParams(params: URLSearchParams, known: readonly string[]): string {
  const id = params.get("brand") ?? "";
  return known.includes(id) ? id : DEFAULT_BRAND;
}

/** The page's query string with the brand in it; Winix is the default, so it adds nothing. */
export function searchWithBrand(search: string, brandId: string): string {
  const params = new URLSearchParams(search);
  if (brandId === DEFAULT_BRAND) params.delete("brand");
  else params.set("brand", brandId);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** "robot-vacuum" -> "Robot vacuum". */
export function categoryLabel(category: string): string {
  const s = category.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
