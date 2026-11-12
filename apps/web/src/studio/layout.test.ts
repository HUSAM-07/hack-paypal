import { describe, expect, it } from "vitest";
import { initialState } from "./layout";

const ai = (w: number) =>
  (initialState("brand", "HouseFresh", w) as unknown as { panels: { ai: { collapsed: boolean } } })
    .panels.ai.collapsed;

describe("Studio panels", () => {
  it("opens the AI panel on wide screens and keeps it out of the way on narrow ones", () => {
    expect(ai(1440)).toBe(false);
    expect(ai(800)).toBe(true);
  });

  it("opens it on the creator's view too, for the Creator Analyst, but not on Trust", () => {
    const at = (v: "creator" | "trust") =>
      (initialState(v, "HouseFresh", 1440) as unknown as { panels: { ai: { collapsed: boolean } } })
        .panels.ai.collapsed;
    expect(at("creator")).toBe(false);
    expect(at("trust")).toBe(true);
  });
});
