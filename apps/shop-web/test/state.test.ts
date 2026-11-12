import type { Item, Turn } from "@shop/agent-protocol";
import { makeShopState } from "@shop/genui/fixtures";
import { describe, expect, it } from "vitest";
import { type ClientState, emptyView, initialState, reduce } from "../src/protocol/state";

const T = "thr_1";
const at = "2026-11-12T09:00:00.000Z";
const msg = (text = ""): Item => ({
  id: "itm_1",
  threadId: T,
  turnId: "trn_1",
  type: "agentMessage",
  status: "inProgress",
  text,
  createdAt: at,
});
const turn = (status: Turn["status"]): Turn => ({
  id: "trn_1",
  threadId: T,
  status,
  startedAt: at,
  origin: "user",
});

function subscribed(): ClientState {
  return reduce(initialState, { type: "subscribed", threadId: T });
}
const note = (method: string, params: unknown, seq?: number) => ({
  type: "notification" as const,
  method,
  params,
  seq,
});

describe("reduce", () => {
  it("streams deltas into the item and skips replayed seqs", () => {
    let s = subscribed();
    s = reduce(s, note("item/started", { item: msg() }, 1));
    s = reduce(
      s,
      note("item/agentMessage/delta", { threadId: T, itemId: "itm_1", delta: "Hel" }, 2),
    );
    s = reduce(
      s,
      note("item/agentMessage/delta", { threadId: T, itemId: "itm_1", delta: "lo" }, 3),
    );
    // A resume replays from an older seq: duplicates are ignored.
    s = reduce(
      s,
      note("item/agentMessage/delta", { threadId: T, itemId: "itm_1", delta: "lo" }, 3),
    );
    s = reduce(
      s,
      note("item/agentMessage/delta", { threadId: T, itemId: "itm_1", delta: "Hel" }, 2),
    );
    const view = s.views[T] ?? emptyView();
    expect(view.items.itm_1).toMatchObject({ text: "Hello" });
    expect(view.itemIds).toEqual(["itm_1"]);
    expect(view.lastSeq).toBe(3);
  });

  it("tracks the running turn through approval and completion", () => {
    let s = subscribed();
    s = reduce(s, note("turn/started", { turn: turn("inProgress") }, 1));
    expect(s.views[T]?.activeTurnId).toBe("trn_1");
    s = reduce(s, note("turn/started", { turn: turn("awaitingApproval") }, 2));
    expect(s.views[T]?.activeTurnId).toBe("trn_1");
    s = reduce(s, note("turn/completed", { turn: turn("completed") }, 3));
    expect(s.views[T]?.activeTurnId).toBeUndefined();
  });

  it("applies a state patch only on its base version, else flags a resync", () => {
    let s = reduce(initialState, note("state/snapshot", { version: 4, state: makeShopState() }));
    s = reduce(
      s,
      note("state/patch", {
        version: 5,
        baseVersion: 4,
        ops: [{ op: "replace", path: "/coolingOffMinutes", value: 30 }],
      }),
    );
    expect(s.shop).toMatchObject({ version: 5, state: { coolingOffMinutes: 30 } });
    expect(s.shopStale).toBe(false);
    // Skipped version 6: never guess.
    const gap = reduce(s, note("state/patch", { version: 7, baseVersion: 6, ops: [] }));
    expect(gap.shopStale).toBe(true);
    expect(gap.shop?.version).toBe(5);
    // An old patch that already applied is dropped quietly.
    expect(reduce(s, note("state/patch", { version: 5, baseVersion: 4, ops: [] })).shopStale).toBe(
      false,
    );
    // A patch that doesn't apply also asks for a snapshot.
    expect(
      reduce(
        s,
        note("state/patch", { version: 6, baseVersion: 5, ops: [{ op: "remove", path: "/nope" }] }),
      ).shopStale,
    ).toBe(true);
  });

  it("remembers which server request an approval answers and forgets it on disconnect", () => {
    const item = {
      ...msg(),
      type: "approvalRequest",
      approvalId: "apr_1",
      kind: "purchase",
      title: "Buy",
      summary: "",
      stepUp: false,
      expiresAt: at,
    } as unknown as Item;
    let s = reduce(subscribed(), {
      type: "approvalRequested",
      approvalId: "apr_1",
      rpcId: "srv_1",
      item,
    });
    expect(s.pendingApprovals).toEqual({ apr_1: "srv_1" });
    expect(s.views[T]?.itemIds).toEqual(["itm_1"]);
    s = reduce(s, { type: "status", status: "offline" });
    expect(s.pendingApprovals).toEqual({});
  });

  it("dedupes inbox entries", () => {
    const e = { id: "inb_1", level: "info", title: "Hi", at };
    let s = reduce(initialState, note("inbox/added", e));
    s = reduce(s, note("inbox/added", e));
    expect(s.inbox).toHaveLength(1);
  });
});
