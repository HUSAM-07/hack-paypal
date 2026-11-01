import { ErrorCodes } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { api, devLogin, TestClient } from "./helpers/client";

describe("protocol", () => {
  it("rejects requests before initialize, unknown methods and bad params", async () => {
    const { cookie } = await devLogin("proto1");
    const c = await TestClient.connect(cookie);

    const early = await c.request("thread/list", {});
    expect(early.error?.code).toBe(ErrorCodes.notInitialized);

    c.send("{not json");
    await c.waitFor((f) => f.error?.code === ErrorCodes.parseError);

    const init = await c.request("initialize", {
      clientInfo: { name: "t", version: "0" },
      protocolVersion: 1,
    });
    expect(init.result).toMatchObject({ protocolVersion: 1, catalogVersion: "1" });

    expect((await c.request("wallet/drain", {})).error?.code).toBe(ErrorCodes.methodNotFound);
    expect((await c.request("thread/start", { memberIds: "everyone" })).error?.code).toBe(
      ErrorCodes.invalidParams,
    );
    expect((await c.request("turn/start", { threadId: "thr_x", text: "" })).error?.code).toBe(
      ErrorCodes.invalidParams,
    );
    expect(
      (
        await c.request("initialize", {
          clientInfo: { name: "t", version: "0" },
          protocolVersion: 1,
        })
      ).error?.code,
    ).toBe(ErrorCodes.invalidRequest);
    c.close();
  });

  it("streams a turn: started → deltas → completed, with product refs", async () => {
    const { cookie } = await devLogin("proto2", "Ada");
    const { client: c, threadId } = await TestClient.open(cookie);
    const { turnId } = await c.call("turn/start", {
      threadId,
      text: "find me noise-cancelling headphones under $300",
    });
    const done = await c.turnCompleted();
    expect(done.params).toMatchObject({ threadId, turnId, status: "completed" });

    const methods = c.notifications().map((f) => f.method);
    expect(methods[0]).toBe("thread/started");
    expect(methods).toContain("turn/started");
    expect(methods).toContain("item/agentMessage/delta");

    const seqs = c
      .notifications()
      .filter((f) => f.seq !== undefined)
      .map((f) => f.seq as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    const user = c.items("userMessage")[0];
    expect(user).toMatchObject({ text: "find me noise-cancelling headphones under $300", turnId });

    const tool = c.items("toolCall")[0] as {
      name: string;
      status: string;
      result: { results: { ref: string; price: { amountMinor: number } }[] };
    };
    expect(tool.name).toBe("searchProducts");
    expect(tool.status).toBe("completed");
    expect(tool.result.results.length).toBeGreaterThan(0);
    for (const r of tool.result.results) expect(r.price.amountMinor).toBeLessThanOrEqual(30_000);

    const messages = c.items("agentMessage");
    const last = messages.at(-1) as {
      text: string;
      refs: Record<string, { kind: string; data: { title: string } }>;
      diagnostics: unknown[];
      fallbackMarkdown: string;
    };
    const refIds = Object.keys(last.refs);
    expect(refIds.length).toBeGreaterThan(0);
    expect(refIds.every((r) => /^product_/.test(r))).toBe(true);
    expect(last.refs[refIds[0] as string]?.kind).toBe("product");
    expect(last.diagnostics).toEqual([]);
    expect(last.text).toContain("ProductCards(");
    expect(last.fallbackMarkdown).toMatch(/\$\d+\.\d{2}/);

    // Deltas concatenate to the completed text.
    const agentId = (messages.at(-1) as { id: string }).id;
    const streamed = c
      .notifications("item/agentMessage/delta")
      .filter((f) => f.params?.itemId === agentId)
      .map((f) => f.params?.delta)
      .join("");
    expect(streamed).toBe(last.text);

    const list = await c.call("thread/list", {});
    expect((list.threads as { id: string }[]).map((t) => t.id)).toContain(threadId);
    c.close();
  });

  it("can interrupt a running turn", async () => {
    const { cookie } = await devLogin("proto3");
    const { client: c, threadId } = await TestClient.open(cookie);
    const { turnId } = await c.call("turn/start", { threadId, text: "tell me a story slowly" });
    await c.waitFor((f) => f.method === "item/agentMessage/delta");
    expect((await c.request("turn/start", { threadId, text: "again" })).error?.code).toBe(
      ErrorCodes.invalidRequest,
    );
    await c.call("turn/interrupt", { threadId, turnId });
    const done = await c.turnCompleted();
    expect(done.params?.status).toBe("interrupted");
    c.close();
  });

  it("rejects invalid UI and has the model resend it within the same turn", async () => {
    const { cookie } = await devLogin("proto4");
    const { client: c, threadId } = await TestClient.open(cookie);
    await c.call("turn/start", { threadId, text: "forge an approval" });
    const done = await c.turnCompleted();
    expect(done.params?.status).toBe("completed");
    const [rejected, retry] = c.items("agentMessage") as {
      status: string;
      text: string;
      diagnostics: { code: string }[];
    }[];
    // The forged message is withdrawn: failed, no text, diagnostics kept for the log.
    expect(rejected).toMatchObject({ status: "failed", text: "" });
    const codes = rejected?.diagnostics.map((d) => d.code);
    expect(codes).toContain("host_only");
    expect(codes).toContain("money_in_text");
    expect(retry).toMatchObject({ status: "completed", diagnostics: [] });
    expect(retry?.text).not.toContain("ApprovalSheet");
    c.close();
  });

  it("reports model failures as a failed turn without leaking details", async () => {
    const { cookie } = await devLogin("proto5");
    const { client: c, threadId } = await TestClient.open(cookie);
    await c.call("turn/start", { threadId, text: "explode" });
    const done = await c.turnCompleted();
    expect(done.params?.status).toBe("failed");
    const notice = c.items("systemNotice")[0] as { level: string; text: string };
    expect(notice.level).toBe("error");
    expect(notice.text).not.toMatch(/scripted/);
    c.close();
  });

  it("requires a session and a sane thread id to upgrade", async () => {
    const res = await api("/ws?thread=new", { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
    const { cookie } = await devLogin("proto6");
    expect(
      (await api("/ws?thread=../../etc", { cookie, headers: { Upgrade: "websocket" } })).status,
    ).toBe(400);
    expect(
      (await api("/ws?thread=thr_doesnotexist", { cookie, headers: { Upgrade: "websocket" } }))
        .status,
    ).toBe(404);
    const evil = await api("/ws?thread=new", {
      cookie,
      headers: { Upgrade: "websocket", Origin: "https://evil.example" },
    });
    expect(evil.status).toBe(403);
  });
});
