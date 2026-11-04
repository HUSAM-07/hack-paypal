import { verifyPassport } from "@pact/protocol";
import { expect, it } from "vitest";
import { app } from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON-RPC test responses
type Rpc = any;

const post = (body: unknown) =>
  app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });

it("serves search_product over streamable HTTP", async () => {
  const list = (await (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as Rpc;
  expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["search_product"]);

  const res = await post({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "search_product", arguments: { query: "air purifier" } },
  });
  const out = ((await res.json()) as Rpc).result.structuredContent;
  expect(out.listings.length).toBeGreaterThanOrEqual(6);
  const v = await verifyPassport(out.passport, "cited-dev-passport-key");
  expect(v.ok).toBe(true);
});
