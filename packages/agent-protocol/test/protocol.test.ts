import { describe, expect, it } from "vitest";
import { ClientRequests, classifyFrame, Item, ServerNotifications } from "../src";

const at = "2026-11-13T10:00:00.000Z";

describe("agent protocol", () => {
  it("parses a Codex-style initialize request", () => {
    const params = ClientRequests.initialize.params.parse({
      clientInfo: { name: "shop_web", title: "Shop", version: "0.1.0" },
      protocolVersion: 1,
    });
    expect(params.capabilities).toEqual([]);
  });

  it("keeps the item lifecycle typed by item type", () => {
    const item = Item.parse({
      id: "i1",
      threadId: "t1",
      turnId: "u1",
      status: "inProgress",
      createdAt: at,
      type: "toolCall",
      name: "search_products",
      summary: "Searching for noise-cancelling headphones",
    });
    expect(item.type).toBe("toolCall");
    expect(ServerNotifications["item/started"].parse({ item }).item.id).toBe("i1");
  });

  it("classifies requests, responses and notifications without the jsonrpc header", () => {
    expect(classifyFrame({ id: 1, method: "thread/list", params: {} }).kind).toBe("request");
    expect(classifyFrame({ id: 1, result: {} }).kind).toBe("response");
    expect(classifyFrame({ id: null, error: { code: -32700, message: "bad" } }).kind).toBe(
      "response",
    );
    expect(classifyFrame({ method: "turn/started", seq: 3, params: {} }).kind).toBe("notification");
    expect(classifyFrame("nope").kind).toBe("invalid");
    expect(classifyFrame({}).kind).toBe("invalid");
  });

  it("rejects float money", () => {
    const r = Item.safeParse({
      id: "a1",
      threadId: "t1",
      turnId: "u1",
      status: "inProgress",
      createdAt: at,
      type: "approvalRequest",
      approvalId: "ap1",
      kind: "purchase",
      title: "Buy",
      summary: "Buy it",
      amount: { amountMinor: 12.5, currency: "USD" },
      expiresAt: at,
    });
    expect(r.success).toBe(false);
  });
});
