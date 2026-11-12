import { describe, expect, it } from "vitest";
import { initialState } from "./layout";

type Page = {
  id: string;
  widgets: Record<string, { type: string }>;
  widgetLayout: Record<string, { xTrack: number; xSpan: number }>;
};
const pages = (view: "brand" | "programmes") =>
  initialState(view, "HouseFresh") as unknown as { pages: Page[]; selectedPageId: string };

describe("Programmes page", () => {
  it("is a page of the report and opens when asked for", () => {
    expect(pages("programmes").selectedPageId).toBe("programmes");
    expect(pages("programmes").pages.map((p) => p.id)).toEqual([
      "brand",
      "creator",
      "trust",
      "programmes",
    ]);
  });

  it("lays out each widget it defines, side by side inside the 24-column grid", () => {
    const page = pages("brand").pages.find((p) => p.id === "programmes") as Page;
    expect(Object.values(page.widgets).map((w) => w.type)).toEqual([
      "cited-start-programme",
      "cited-programmes",
    ]);
    expect(Object.keys(page.widgetLayout).sort()).toEqual(Object.keys(page.widgets).sort());
    for (const l of Object.values(page.widgetLayout))
      expect(l.xTrack + l.xSpan).toBeLessThanOrEqual(24);
  });

  it("stacks the two widgets on a phone, start first, so neither is squeezed", () => {
    const narrow = initialState("programmes", "HouseFresh", 390) as unknown as { pages: Page[] };
    const page = narrow.pages.find((p) => p.id === "programmes") as Page;
    const l = page.widgetLayout as Record<
      string,
      { xTrack: number; xSpan: number; yTrack: number }
    >;
    expect(l["programme-start"]).toMatchObject({ xTrack: 0, xSpan: 24, yTrack: 0 });
    expect(l["programme-list"]).toMatchObject({ xTrack: 0, xSpan: 24 });
    expect((l["programme-list"]?.yTrack ?? 0) > 0).toBe(true);
  });

  it("leaves the brand page's widgets and layout exactly as they were", () => {
    const brand = pages("brand").pages.find((p) => p.id === "brand") as Page;
    expect(Object.keys(brand.widgets)).toEqual([
      "caused",
      "arms",
      "deposit",
      "whatif",
      "journeys",
      "flags",
    ]);
  });

  it("links to it and keeps the money toggle and creator in the link", async () => {
    const { urlFor } = await import("./App");
    expect(urlFor("programmes", "?view=first")).toBe("/studio?view=first&page=programmes");
    expect(urlFor("brand", "?page=programmes")).toBe("/studio");
    expect(urlFor("trust", "?page=programmes")).toBe("/studio?page=trust");
  });
});
