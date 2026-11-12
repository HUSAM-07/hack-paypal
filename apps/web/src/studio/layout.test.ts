import { describe, expect, it } from "vitest";
import { currenciesIn, initialState, sourcesFor } from "./layout";

const ai = (w: number) =>
  (initialState("brand", "HouseFresh", w) as unknown as { panels: { ai: { collapsed: boolean } } })
    .panels.ai.collapsed;

describe("Studio panels", () => {
  it("folds the AI panel inside the 1080px frame and opens it only on very wide screens", () => {
    expect(ai(1920)).toBe(false);
    expect(ai(1440)).toBe(true);
    expect(ai(800)).toBe(true);
  });

  it("opens it on the creator's view too, for the Creator Analyst, but not on Trust", () => {
    const at = (v: "creator" | "trust") =>
      (initialState(v, "HouseFresh", 1920) as unknown as { panels: { ai: { collapsed: boolean } } })
        .panels.ai.collapsed;
    expect(at("creator")).toBe(false);
    expect(at("trust")).toBe(true);
  });
});

describe("Studio money formats", () => {
  const table = (rows: Record<string, unknown>[]) => ({
    credits: rows,
    brands: [],
  });
  const config = {
    tables: [
      {
        id: "credits",
        name: "Credits",
        description: "",
        fields: [{ id: "amount", name: "Amount", format: "currencyFormat" }],
      },
    ],
  } as unknown as Parameters<typeof sourcesFor>[0];
  const formatOf = (rows: Record<string, unknown>[], creator?: string) => {
    const f = sourcesFor(config, table(rows), creator).sources[0]?.fields[0] as unknown as {
      formatOptions: { format: Intl.NumberFormat };
    };
    return (n: number) => f.formatOptions.format.format(n);
  };

  it("keeps dollars as they were", () => {
    expect(formatOf([{ currency: "USD", creator: "A" }])(95.99)).toBe("$95.99");
    expect(formatOf([{ creator: "A" }])(1234.5)).toBe("$1,234.50");
  });
  it("shows pounds and euros with their own symbol", () => {
    expect(formatOf([{ currency: "GBP", creator: "A" }])(95.99)).toBe("£95.99");
    expect(formatOf([{ currency: "EUR", creator: "A" }])(95.99)).toBe("€95.99");
  });
  it("lets a dollar creator keep dollars while a pound programme runs beside them", () => {
    const rows = [
      { currency: "USD", creator: "A" },
      { currency: "GBP", creator: "B" },
    ];
    expect(formatOf(rows, "A")(5)).toBe("$5.00");
    expect(formatOf(rows, "B")(5)).toBe("£5.00");
  });
  it("prints plain figures, never a wrong symbol, when one creator has two currencies", () => {
    const rows = [
      { currency: "USD", creator: "A" },
      { currency: "GBP", creator: "A" },
    ];
    expect(formatOf(rows, "A")(5)).toBe("5.00");
    expect(currenciesIn(rows)).toEqual(["GBP", "USD"]);
  });
  it("adds the Currency column to a mixed creator's review-flags grid only (credits decide it themselves)", () => {
    const cols = (mixed: boolean) =>
      (
        initialState("creator", "A", 1440, mixed) as unknown as {
          pages: { id: string; widgets: Record<string, any> }[];
        }
      ).pages
        .find((p) => p.id === "creator")
        ?.widgets.flags.dataMapping.cols.map((c: { id: string }) => c.id);
    expect(cols(false)).not.toContain("flags.currency");
    expect(cols(true)).toContain("flags.currency");
  });
  it("shows the creator's credits in CITED's own grid widget, which has the CSV export", () => {
    const state = initialState("creator", "A", 1440, false) as unknown as {
      pages: { id: string; widgets: Record<string, { type: string }> }[];
    };
    expect(state.pages.find((p) => p.id === "creator")?.widgets.credits?.type).toBe(
      "cited-credits",
    );
  });
});
