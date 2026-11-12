import { describe, expect, it } from "vitest";
import { applyPatch, PatchError } from "../src/protocol/patch";

describe("applyPatch", () => {
  const doc = { a: { b: [1, 2, 3] }, keep: { x: 1 } };

  it("adds, replaces and removes without touching the input", () => {
    const out = applyPatch(doc, [
      { op: "add", path: "/a/b/1", value: 9 },
      { op: "add", path: "/a/b/-", value: 4 },
      { op: "replace", path: "/a/b/0", value: 0 },
      { op: "remove", path: "/a/b/2" },
      { op: "add", path: "/c", value: "new" },
    ]);
    expect(out).toEqual({ a: { b: [0, 9, 3, 4] }, keep: { x: 1 }, c: "new" });
    expect(doc).toEqual({ a: { b: [1, 2, 3] }, keep: { x: 1 } });
    // Untouched branches keep their identity (React re-renders only what changed).
    expect(out.keep).toBe(doc.keep);
    expect(out.a).not.toBe(doc.a);
  });

  it("moves, copies and tests", () => {
    const out = applyPatch(doc, [
      { op: "copy", from: "/keep", path: "/copy" },
      { op: "move", from: "/a/b/0", path: "/first" },
      { op: "test", path: "/first", value: 1 },
    ]);
    expect(out).toMatchObject({ first: 1, copy: { x: 1 }, a: { b: [2, 3] } });
  });

  it("handles escaped pointer tokens", () => {
    expect(
      applyPatch({ "a/b": 1, "m~n": 2 }, [
        { op: "replace", path: "/a~1b", value: 3 },
        { op: "remove", path: "/m~0n" },
      ]),
    ).toEqual({ "a/b": 3 });
  });

  it("throws on bad paths and failed tests so the caller resyncs", () => {
    expect(() => applyPatch(doc, [{ op: "replace", path: "/nope", value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: "remove", path: "/a/b/7" }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: "test", path: "/keep/x", value: 2 }])).toThrow(PatchError);
    expect(() => applyPatch(doc, [{ op: "add", path: "a", value: 1 }])).toThrow(PatchError);
  });
});
