import { describe, expect, it } from "vitest";
import { scopeFromParams, searchWithScope } from "./scope";

const at = (q: string) => scopeFromParams(new URLSearchParams(q));

describe("scopeFromParams", () => {
  it("reads ?view", () => {
    expect(at("view=first")).toBe("first");
    expect(at("view=total")).toBe("todate");
  });
  it("opens on Programme to date by default", () => {
    expect(at("")).toBe("todate");
    expect(at("view=nonsense")).toBe("todate");
  });
  it("makes ?clean=1 mean First payout unless view is given", () => {
    expect(at("clean=1")).toBe("first");
    expect(at("clean=1&view=total")).toBe("todate");
    expect(at("view=first&clean=1")).toBe("first");
  });
  it("still reads the older ?scope=first", () => {
    expect(at("scope=first")).toBe("first");
    expect(at("scope=first&view=total")).toBe("todate");
  });
});

describe("searchWithScope", () => {
  it("writes the toggle into ?view and keeps the other params", () => {
    expect(searchWithScope("?clean=1&creator=airlab", "todate")).toBe(
      "?clean=1&creator=airlab&view=total",
    );
    expect(searchWithScope("", "first")).toBe("?view=first");
  });
  it("replaces an existing view and drops the older scope", () => {
    expect(searchWithScope("?view=first&scope=first", "todate")).toBe("?view=total");
  });
  it("round-trips", () => {
    for (const s of ["first", "todate"] as const)
      expect(scopeFromParams(new URLSearchParams(searchWithScope("?clean=1", s)))).toBe(s);
  });
});
