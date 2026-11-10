import { describe, expect, it } from "vitest";
import { diffTables } from "./data";

describe("diffTables", () => {
  it("turns a poll into add, update and remove transactions per table", () => {
    const prev = {
      credits: [
        { id: "a", state: "pending" },
        { id: "b", state: "pending" },
      ],
    };
    const next = {
      credits: [
        { id: "a", state: "voided" },
        { id: "c", state: "pending" },
      ],
    };
    // biome-ignore lint/suspicious/noExplicitAny: partial tables for the test
    expect(diffTables(prev as any, next as any)).toEqual([
      {
        tableId: "credits",
        add: [{ id: "c", state: "pending" }],
        update: [{ id: "a", state: "voided" }],
        remove: ["b"],
      },
    ]);
  });

  it("sends nothing when nothing changed", () => {
    const t = { credits: [{ id: "a", state: "paid" }] };
    // biome-ignore lint/suspicious/noExplicitAny: partial tables for the test
    expect(diffTables(t as any, structuredClone(t) as any)).toEqual([]);
  });
});
