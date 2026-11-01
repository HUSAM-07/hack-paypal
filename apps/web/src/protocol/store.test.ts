import type { Item } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { ThreadStore } from "./store";

const T = {
  id: "thr_1",
  title: "T",
  kind: "solo" as const,
  memberIds: ["u"],
  createdAt: "2026-11-01T00:00:00.000Z",
  archived: false,
};

const agent = (status: "inProgress" | "failed" | "completed", text: string): Item => ({
  id: "item_1",
  threadId: T.id,
  turnId: "turn_1",
  status,
  createdAt: T.createdAt,
  type: "agentMessage",
  text,
  refs: {},
  diagnostics: [],
});

describe("ThreadStore", () => {
  it("drops an agent message the worker withdrew for invalid UI", () => {
    const store = new ThreadStore();
    store.upsertThread(T);
    store.apply({ method: "item/started", seq: 1, params: { item: agent("inProgress", "") } });
    store.apply({
      method: "item/agentMessage/delta",
      seq: 2,
      params: { threadId: T.id, itemId: "item_1", delta: "Here <Bad" },
    });
    store.apply({ method: "item/completed", seq: 3, params: { item: agent("failed", "") } });
    const t = store.getSnapshot().threads[T.id];
    expect(t?.order).toEqual([]);
    expect(t?.items).toEqual({});
  });
});
