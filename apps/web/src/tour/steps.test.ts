import { describe, expect, it } from "vitest";
import {
  neighbour,
  parseStop,
  resolveStop,
  stopHref,
  TOUR_STOPS,
  type TourStop,
  withoutTour,
} from "./steps";

describe("tour stops", () => {
  it("has eight stops, each with a label and a short plain caption", () => {
    expect(TOUR_STOPS).toHaveLength(8);
    for (const s of TOUR_STOPS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.caption.length).toBeLessThanOrEqual(240);
      expect(s.path.startsWith("/")).toBe(true);
      expect(s.caption).not.toMatch(/\barm\b/i);
    }
  });

  it("walks the judge path in order", () => {
    expect(TOUR_STOPS.map((_, i) => stopHref(i + 1))).toEqual([
      "/?tour=1#problem",
      "/console?clean=1&tour=2",
      "/console/payout?clean=1&tour=3",
      "/proof?tour=4#result",
      "/studio?view=first&tour=5",
      "/studio?page=trust&tour=6",
      "/proof?tour=7#vacuums",
      "/mcp?tour=8",
    ]);
  });

  it("never links a write", () => {
    for (const s of TOUR_STOPS) {
      expect(`${s.path}${s.query ?? ""}`).not.toMatch(/approve|release|void|payout\/run/i);
    }
  });

  it("rejects a stop outside the tour", () => {
    expect(() => stopHref(0)).toThrow(RangeError);
    expect(() => stopHref(9)).toThrow(RangeError);
  });
});

describe("parseStop", () => {
  it("accepts whole numbers inside the tour only", () => {
    expect(parseStop("1")).toBe(1);
    expect(parseStop("8")).toBe(8);
    for (const bad of [null, undefined, "", "0", "9", "-1", "1.5", "1e1", "abc", " 2", "02x"]) {
      expect(parseStop(bad)).toBeNull();
    }
  });
});

describe("resolveStop", () => {
  it("shows nothing unless the tour was started", () => {
    expect(resolveStop({ pathname: "/console", search: "?clean=1" }, null)).toBeNull();
    expect(resolveStop({ pathname: "/", search: "" }, null)).toBeNull();
  });

  it("takes the stop from the URL", () => {
    expect(resolveStop({ pathname: "/proof", search: "?tour=4" }, null)).toBe(4);
    expect(resolveStop({ pathname: "/proof", search: "?tour=4" }, "2")).toBe(4);
  });

  it("ignores a bad value in the URL", () => {
    expect(resolveStop({ pathname: "/", search: "?tour=99" }, null)).toBeNull();
    expect(resolveStop({ pathname: "/", search: "?tour=x" }, null)).toBeNull();
  });

  it("falls back to the stored stop only on that stop's own page", () => {
    expect(resolveStop({ pathname: "/studio", search: "" }, "5")).toBe(5);
    expect(resolveStop({ pathname: "/studio/", search: "?page=trust" }, "6")).toBe(6);
    expect(resolveStop({ pathname: "/mcp", search: "" }, "5")).toBeNull();
    expect(resolveStop({ pathname: "/studio", search: "" }, "nope")).toBeNull();
  });

  it("works with a custom list", () => {
    const stops: TourStop[] = [{ path: "/a", label: "A", caption: "a" }];
    expect(resolveStop({ pathname: "/a", search: "?tour=1" }, null, stops)).toBe(1);
    expect(resolveStop({ pathname: "/a", search: "?tour=2" }, null, stops)).toBeNull();
  });
});

describe("withoutTour", () => {
  it("keeps the page's own query and hash", () => {
    expect(withoutTour({ pathname: "/console", search: "?clean=1&tour=2", hash: "" })).toBe(
      "/console?clean=1",
    );
    expect(withoutTour({ pathname: "/proof", search: "?tour=4", hash: "#result" })).toBe(
      "/proof#result",
    );
    expect(withoutTour({ pathname: "/", search: "", hash: "" })).toBe("/");
  });
});

describe("neighbour", () => {
  it("steps back and forward, and ends at both edges", () => {
    expect(neighbour(3, 1)).toBe(4);
    expect(neighbour(3, -1)).toBe(2);
    expect(neighbour(1, -1)).toBeNull();
    expect(neighbour(8, 1)).toBeNull();
  });
});
