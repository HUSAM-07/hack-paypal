import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyPatch,
  createRpcPeer,
  diffJson,
  ErrorCodes,
  protocolJsonSchemas,
  RpcRequestError,
} from "../src";

function wire() {
  const sent: Record<string, unknown>[] = [];
  return { sent, send: (f: string) => sent.push(JSON.parse(f)) };
}

describe("createRpcPeer", () => {
  it("correlates responses with requests and surfaces errors", async () => {
    const w = wire();
    const peer = createRpcPeer({ send: w.send });
    const a = peer.request("thread/start", {});
    const b = peer.request("thread/list", {});
    const [first, second] = w.sent as { id: number }[];
    peer.receive(
      JSON.stringify({
        id: second?.id,
        error: { code: ErrorCodes.notInitialized, message: "init first" },
      }),
    );
    peer.receive({ id: first?.id, result: { thread: { id: "t1" } } });
    await expect(a).resolves.toEqual({ thread: { id: "t1" } });
    await expect(b).rejects.toMatchObject({ code: ErrorCodes.notInitialized });
    await expect(b).rejects.toBeInstanceOf(RpcRequestError);
  });

  it("answers server requests with the handler's result", async () => {
    const w = wire();
    const peer = createRpcPeer({
      send: w.send,
      serverRequests: { "approval/request": () => ({ decision: "approve" }) },
    });
    peer.receive({ id: "ap_1", method: "approval/request", params: { item: {} } });
    await new Promise((r) => setTimeout(r, 0));
    expect(w.sent).toEqual([{ id: "ap_1", result: { decision: "approve" } }]);
  });

  it("tracks seq per thread and drops replayed duplicates", () => {
    const peer = createRpcPeer({ send: () => {} });
    const seen: number[] = [];
    peer.on("item/agentMessage/delta", (_p, meta) => seen.push(meta.seq ?? -1));
    const delta = (seq: number) => ({
      method: "item/agentMessage/delta",
      seq,
      params: { threadId: "t1", itemId: "i1", delta: "x" },
    });
    for (const s of [1, 2, 2, 3, 1]) peer.receive(delta(s));
    expect(seen).toEqual([1, 2, 3]);
    expect(peer.lastSeq("t1")).toBe(3);
    expect(peer.lastSeq("t2")).toBe(0);
  });

  it("rejects in-flight requests on dispose and on timeout", async () => {
    const peer = createRpcPeer({ send: () => {} });
    const p = peer.request("thread/list", {});
    peer.dispose("socket closed");
    await expect(p).rejects.toThrow("socket closed");
    await expect(peer.request("thread/list", {}, { timeoutMs: 5 })).rejects.toThrow("timed out");
  });
});

const json = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.integer(),
    fc.string({ maxLength: 4 }),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie("value"), { maxLength: 4 }),
    fc.dictionary(fc.string({ maxLength: 3 }), tie("value"), { maxKeys: 4 }),
  ),
})).value;

describe("JSON Patch", () => {
  it("applyPatch(a, diffJson(a, b)) equals b", () => {
    fc.assert(
      fc.property(json, json, (a, b) => {
        expect(applyPatch(a, diffJson(a, b))).toEqual(b);
      }),
      { numRuns: 400 },
    );
  });

  it("appending to an array is a single add", () => {
    expect(diffJson({ w: [1, 2] }, { w: [1, 2, 3] })).toEqual([
      { op: "add", path: "/w/2", value: 3 },
    ]);
  });
});

describe("generated JSON Schema", () => {
  it("matches the committed schema/ files (run npm run gen -w @shop/agent-protocol)", () => {
    const root = path.join(import.meta.dirname, "..", "schema");
    const committed: Record<string, unknown> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else committed[path.relative(root, full)] = JSON.parse(readFileSync(full, "utf8"));
      }
    };
    walk(root);
    expect(committed).toEqual(JSON.parse(JSON.stringify(protocolJsonSchemas())));
  });
});
