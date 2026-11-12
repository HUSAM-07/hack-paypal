import { afterEach, describe, expect, it, vi } from "vitest";
import { MockHarness } from "../src/mock/harness";
import { ShopClient } from "../src/protocol/client";

let harness: MockHarness;
let client: ShopClient;

function setup() {
  harness = new MockHarness({ speed: 0, seed: false, tickMs: 0, demoDropAfter: 9999 });
  client = new ShopClient({ connect: harness.connect, minBackoff: 1, maxBackoff: 5 }).start();
  return { harness, client };
}

afterEach(() => {
  client?.stop();
  harness?.dispose();
});

const items = () => {
  const s = client.getState();
  const v = s.activeThreadId ? s.views[s.activeThreadId] : undefined;
  return v ? v.itemIds.map((id) => v.items[id]) : [];
};

describe("ShopClient against the MockHarness", () => {
  it("initializes, then receives the product state snapshot", async () => {
    setup();
    await vi.waitFor(() => expect(client.getState().status).toBe("open"));
    expect(client.getState().userId).toBe("usr_demo");
    await vi.waitFor(() => expect(client.getState().shop?.state.coolingOffMinutes).toBe(10));
  });

  it("runs a turn and renders its items in order", async () => {
    setup();
    await client.send("find headphones");
    await vi.waitFor(
      () =>
        expect(
          client.getState().views[client.getState().activeThreadId ?? ""]?.activeTurnId,
        ).toBeUndefined(),
      { timeout: 3000 },
    );
    const types = items().map((i) => (i?.type === "toolCall" ? `tool:${i.name}` : i?.type));
    expect(types).toEqual(["userMessage", "reasoning", "tool:search_products", "agentMessage"]);
    expect(items().at(-1)).toMatchObject({
      status: "completed",
      text: expect.stringContaining("5 offers"),
    });
  });

  it("resumes after a drop from the last seq without duplicates or gaps", async () => {
    setup();
    await client.send("find headphones");
    // Drop mid-turn: the harness keeps working and logging while we're away.
    await vi.waitFor(() => expect(items().length).toBeGreaterThan(1));
    harness.dropAll();
    await vi.waitFor(() => expect(client.getState().status).toBe("open"), { timeout: 3000 });
    await vi.waitFor(
      () =>
        expect(
          client.getState().views[client.getState().activeThreadId ?? ""]?.activeTurnId,
        ).toBeUndefined(),
      { timeout: 3000 },
    );
    const ids = items().map((i) => i?.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(items().at(-1)).toMatchObject({ type: "agentMessage", status: "completed" });
    expect((items().at(-1) as { text: string }).text).toContain("5 offers");
  });

  it("answers an approval server request and the purchase lands in state", async () => {
    setup();
    await vi.waitFor(() => expect(client.getState().status).toBe("open"));
    await client.invoke("wallet.startConnect");
    await client.invoke("wallet.completeConnect", { setupTokenId: "VST-1" });
    await client.send("buy the sony");
    await vi.waitFor(
      () => expect(Object.keys(client.getState().pendingApprovals)).toHaveLength(1),
      { timeout: 3000 },
    );
    const approvalId = Object.keys(client.getState().pendingApprovals)[0] as string;
    await client.respondApproval(approvalId, "approve");
    await vi.waitFor(
      () => expect(client.getState().shop?.state.orders[0]?.status).toBe("coolingOff"),
      { timeout: 3000 },
    );
    const order = client.getState().shop?.state.orders[0];
    await client.invoke("order.cancel", { orderId: order?.id });
    await vi.waitFor(() => expect(client.getState().shop?.state.orders[0]?.status).toBe("voided"));
    expect(client.getState().shop?.state.wallet.connected).toBe(true);
  });

  it("re-snapshots when a patch arrives on the wrong base version", async () => {
    setup();
    await vi.waitFor(() => expect(client.getState().shop).toBeDefined());
    // Simulate a lost patch: our copy falls one version behind the server.
    await client.invoke("settings.update", { coolingOffMinutes: 5 });
    await vi.waitFor(() => expect(client.getState().shop?.state.coolingOffMinutes).toBe(5));
    const internal = client as unknown as { state: { shop: { version: number } } };
    internal.state = {
      ...internal.state,
      shop: { ...internal.state.shop, version: internal.state.shop.version - 1 },
    };
    await client.invoke("settings.update", { coolingOffMinutes: 30 });
    await vi.waitFor(() => expect(client.getState().shop?.state.coolingOffMinutes).toBe(30));
    expect(client.getState().shopStale).toBe(false);
  });

  it("steers a running turn instead of starting another", async () => {
    setup();
    await client.send("compare the top three");
    await vi.waitFor(() =>
      expect(
        client.getState().views[client.getState().activeThreadId ?? ""]?.activeTurnId,
      ).toBeDefined(),
    );
    await client.send("battery matters most");
    await vi.waitFor(
      () =>
        expect(
          client.getState().views[client.getState().activeThreadId ?? ""]?.activeTurnId,
        ).toBeUndefined(),
      { timeout: 3000 },
    );
    const texts = items()
      .filter((i) => i?.type === "userMessage")
      .map((i) => (i as { text: string }).text);
    expect(texts).toEqual(["compare the top three", "battery matters most"]);
    expect((items().at(-1) as { text: string }).text).toContain("battery matters most");
  });
});
