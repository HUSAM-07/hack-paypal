import { describe, expect, it } from "vitest";
import { initialState } from "./layout";

type Page = { id: string; widgets: Record<string, { type: string }>; widgetLayout: object };
const pages = (view: "brand" | "creator" | "trust") =>
  initialState(view, "HouseFresh", 1440) as unknown as { pages: Page[]; selectedPageId: string };

describe("Trust page", () => {
  it("is a third page, and opens when asked for", () => {
    const s = pages("trust");
    expect(s.pages.map((p) => p.id)).toEqual(["brand", "creator", "trust"]);
    expect(s.selectedPageId).toBe("trust");
    expect(pages("brand").selectedPageId).toBe("brand");
  });

  it("lays out every widget it defines", () => {
    const page = pages("trust").pages.find((p) => p.id === "trust") as Page;
    expect(Object.values(page.widgets).map((w) => w.type)).toEqual([
      "cited-trust-summary",
      "cited-trust-list",
    ]);
    expect(Object.keys(page.widgetLayout).sort()).toEqual(Object.keys(page.widgets).sort());
  });
});

describe("Trust link", () => {
  it("keeps the money toggle and the creator in the link, and leaves no stray page parameter", async () => {
    const { urlFor } = await import("./App");
    expect(urlFor("trust", "?view=first")).toBe("/studio?view=first&page=trust");
    expect(urlFor("brand", "?view=first&page=trust")).toBe("/studio?view=first");
    expect(urlFor("creator", "?creator=airlab&page=trust")).toBe("/studio/creator?creator=airlab");
    expect(urlFor("brand", "")).toBe("/studio");
  });
});
