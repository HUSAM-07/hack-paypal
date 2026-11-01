import { describe, expect, it } from "vitest";
import { api, devLogin, TestClient } from "./helpers/client";

describe("reconnect and replay", () => {
  it("replays missed notifications after afterSeq, in order, without stale deltas", async () => {
    const { cookie } = await devLogin("replay1");
    const { client: a, threadId } = await TestClient.open(cookie);
    const startedSeq = a.notifications("thread/started")[0]?.seq as number;
    a.close();

    // A second socket drives a turn while the first is gone.
    const b = await TestClient.connect(cookie, threadId);
    await b.call("initialize", { clientInfo: { name: "b", version: "0" }, protocolVersion: 1 });
    await b.call("thread/resume", { threadId, afterSeq: 0 });
    await b.call("turn/start", {
      threadId,
      text: "find me noise-cancelling headphones under $300",
    });
    await b.turnCompleted();
    const live = b.notifications().filter((f) => f.seq !== undefined && f.seq > startedSeq);
    b.close();

    const c = await TestClient.connect(cookie, threadId);
    await c.call("initialize", { clientInfo: { name: "c", version: "0" }, protocolVersion: 1 });
    const res = await c.call("thread/resume", { threadId, afterSeq: startedSeq });
    const lastSeq = res.lastSeq as number;
    await c.waitFor((f) => f.seq === lastSeq);

    const replayed = c.notifications().filter((f) => f.seq !== undefined);
    const seqs = replayed.map((f) => f.seq as number);
    expect(seqs[0]).toBeGreaterThan(startedSeq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(seqs.at(-1)).toBe(lastSeq);
    // Deltas of completed messages are compacted; the completed item carries the text.
    expect(replayed.some((f) => f.method === "item/agentMessage/delta")).toBe(false);
    const nonDelta = live.filter((f) => f.method !== "item/agentMessage/delta");
    expect(replayed.map((f) => f.seq)).toEqual(nonDelta.map((f) => f.seq));
    expect(replayed.map((f) => f.method)).toEqual(nonDelta.map((f) => f.method));
    c.close();
  });

  it("fans out to every member socket and reports presence; outsiders are refused", async () => {
    const ada = await devLogin("fan_ada", "Ada");
    const bo = await devLogin("fan_bo", "Bo");
    const eve = await devLogin("fan_eve", "Eve");
    const { client: a, threadId } = await TestClient.open(ada.cookie, { memberIds: [bo.userId] });

    const b = await TestClient.connect(bo.cookie, threadId);
    await b.call("initialize", { clientInfo: { name: "b", version: "0" }, protocolVersion: 1 });
    const resumed = await b.call("thread/resume", { threadId });
    expect((resumed.thread as { kind: string }).kind).toBe("group");

    await a.waitFor(
      (f) =>
        f.method === "thread/presence" &&
        (f.params?.onlineUserIds as string[] | undefined)?.length === 2,
    );

    await b.call("turn/start", { threadId, text: "find me headphones" });
    await a.turnCompleted();
    await b.turnCompleted();
    expect(a.items("userMessage")[0]).toMatchObject({ authorId: bo.userId });

    b.close();
    await a.waitFor(
      (f) =>
        f.method === "thread/presence" &&
        JSON.stringify(f.params?.onlineUserIds) === JSON.stringify([ada.userId]),
    );

    const denied = await api(`/ws?thread=${threadId}`, {
      cookie: eve.cookie,
      headers: { Upgrade: "websocket" },
    });
    expect(denied.status).toBe(403);
    a.close();
  });
});
