import { SELF } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UPC_BOSE_QC,
  UPC_LEVOIT_CORE300,
  UPC_ROBOROCK_Q7MAX,
  UPC_ROOMBA_J5,
  UPC_SONY_XM5,
  UPC_WINIX_A230,
} from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { creatorIdFor } from "../src/creators/session";
import { FEED_PATH } from "../src/mcp-page";

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON
type Json = any;
const ORIGIN = "https://example.com";
const selfFetch = ((input: string | URL | Request, init?: RequestInit) =>
  SELF.fetch(new Request(input, init))) as typeof fetch;

function jar() {
  const cookies = new Map<string, string>();
  return {
    async fetch(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
      const res = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const [k, ...v] = (pair ?? "").split("=");
        if (!k) continue;
        if (/max-age=0/i.test(c) || v.join("=") === "") cookies.delete(k);
        else cookies.set(k, v.join("="));
      }
      return res;
    },
  };
}

async function signIn() {
  const j = jar();
  const connect = await j.fetch("/creators/connect");
  const consentUrl = new URL(connect.headers.get("location") ?? "");
  const html = await (await j.fetch(consentUrl.pathname + consentUrl.search)).text();
  const agree = /href="([^"]+)">Agree and connect/.exec(html)?.[1]?.replaceAll("&#38;", "&");
  const cb = new URL(agree ?? "");
  await j.fetch(cb.pathname + cb.search);
  return j;
}

const POST = { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" };

/** Signs in as a new creator and publishes a test in a category. */
async function publish(
  name: string,
  category: string,
  skus: string[],
  verdict: string,
  placeboTopic = "desk lamps",
) {
  const j = await signIn();
  const home = await (await j.fetch("/creators")).text();
  const payerId = /PayPal account ID <code>([A-Z0-9]+)<\/code>/.exec(home)?.[1] ?? "";
  const csrf = /name="csrf" value="([^"]+)"/.exec(home)?.[1] ?? "";
  const body = new URLSearchParams({
    csrf,
    name,
    category,
    verdict,
    summary: `${name} used both products for a week at home and wrote down what each did well and badly.`,
    disclosure: "I may earn a commission from CITED when an agent buys after reading this.",
    placeboTopic,
    placeboSummary: "Three desk lamps compared on glare, colour and how warm the base gets.",
  });
  for (const s of skus) body.append("skus", s);
  const res = await j.fetch("/creators/tests", {
    method: "POST",
    headers: POST,
    body: body.toString(),
  });
  const done =
    res.status === 303 ? await (await j.fetch(res.headers.get("location") ?? "")).text() : "";
  return {
    status: res.status,
    done,
    text: res.status === 303 ? "" : await res.text(),
    j,
    payerId,
    creatorId: await creatorIdFor(payerId),
  };
}

async function agent() {
  const client = new Client({ name: "judge-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: selfFetch }),
  );
  return client;
}

const search = async (client: Client, query: string) =>
  ((await client.callTool({ name: "search_product", arguments: { query } })) as Json)
    .structuredContent;

/** On a session already shown the creator's test, the other categories' searches never carry it. */
async function expectAbsentElsewhere(client: Client, creatorId: string, queries: string[]) {
  for (const q of queries) {
    const ids = (await search(client, q)).creatorContent.map((t: Json) => t.creatorId);
    expect(ids).not.toContain(creatorId);
  }
}

/** Opens public sessions until one is shown the creator's test in this category's search. */
async function sessionShown(creatorId: string, query: string, tries = 12) {
  // The catalogue re-reads the engine every few seconds.
  await new Promise((r) => setTimeout(r, 3300));
  for (let i = 0; i < tries; i++) {
    const client = await agent();
    const found = await search(client, query);
    if (found.creatorContent.some((t: Json) => t.creatorId === creatorId && t.kind === "test"))
      return { client, found };
    await client.close();
  }
  throw new Error("no session was shown the test");
}

describe("the /creators form: category picker", () => {
  it("offers all three categories, with the purifiers selected to start, and each one's products", async () => {
    const j = await signIn();
    const html = await (await j.fetch("/creators")).text();
    for (const c of ["air-purifier", "robot-vacuum", "headphones"])
      expect(html).toContain(`name="category" value="${c}"`);
    expect(html).toMatch(/name="category" value="air-purifier" checked/);
    for (const upc of [UPC_WINIX_A230, UPC_ROBOROCK_Q7MAX, UPC_SONY_XM5])
      expect(html).toContain(`name="skus" value="${upc}"`);
    // Only the selected category's products are shown and sent.
    expect(html).toMatch(/data-cat="robot-vacuum" hidden/);
    expect(html).toMatch(/name="skus" value="100000000006" disabled/);
  });

  it("a headphones test goes live for the headphones search only, with a success text that names it", async () => {
    const out = await publish("Quiet Ears", "headphones", [UPC_SONY_XM5, UPC_BOSE_QC], UPC_BOSE_QC);
    expect(out.status).toBe(303);
    expect(out.done).toContain("search for <b>noise-cancelling headphones</b>");
    expect(out.done).not.toContain("search for <b>air purifiers</b>");
    // The page after publishing opens on that category.
    expect(out.done).toMatch(/name="category" value="headphones" checked/);

    const { client, found } = await sessionShown(out.creatorId, "noise-cancelling headphones");
    const mine = found.creatorContent.find((t: Json) => t.creatorId === out.creatorId);
    expect(mine).toMatchObject({
      kind: "test",
      creatorName: "Quiet Ears",
      category: "headphones",
      verdictUpc: UPC_BOSE_QC,
    });
    expect(mine.disclosure).toMatch(/commission/i);
    expect(found.creatorContent[0].creatorId).toBe("quietbench");
    expect(found.offers).toHaveLength(6);

    const offer = found.offers.find((o: Json) => o.seller.id === "lumen");
    const bought = (
      (await client.callTool({ name: "checkout", arguments: { offerId: offer.offerId } })) as Json
    ).structuredContent;
    await expectAbsentElsewhere(client, out.creatorId, ["air purifier", "robot vacuum"]);
    await client.close();
    const feed = (await (await SELF.fetch(`${ORIGIN}${FEED_PATH}`)).json()) as Json;
    const sale = feed.journeys.find((j: Json) => j.orderId === bought.orderId);
    expect(sale.arm).toBe("test");
    expect(sale.creatorsSeen).toContain(out.creatorId);
    expect(sale.creatorsSeen).toContain("quietbench");
  });

  it("a robot vacuum test goes live for the vacuum search only", async () => {
    const out = await publish(
      "Floor Notes",
      "robot-vacuum",
      [UPC_ROBOROCK_Q7MAX, UPC_ROOMBA_J5],
      "close",
    );
    expect(out.status).toBe(303);
    expect(out.done).toContain("search for <b>robot vacuums</b>");
    const { client, found } = await sessionShown(out.creatorId, "robot vacuum");
    const mine = found.creatorContent.find((t: Json) => t.creatorId === out.creatorId);
    expect(mine).toMatchObject({ kind: "test", category: "robot-vacuum" });
    expect(mine.verdictUpc).toBeUndefined();
    expect(found.creatorContent[0].creatorId).toBe("crumblab");
    await expectAbsentElsewhere(client, out.creatorId, [
      "air purifier",
      "noise-cancelling headphones",
    ]);
    await client.close();
  });

  it("refuses products from another category, and keeps the category picked when it re-shows the form", async () => {
    const out = await publish(
      "Mixed Bag",
      "headphones",
      [UPC_SONY_XM5, UPC_WINIX_A230],
      UPC_SONY_XM5,
    );
    expect(out.status).toBe(422);
    expect(out.text).toContain("Pick noise-cancelling headphones only: Winix A230 isn&#39;t one.");
    expect(out.text).toMatch(/name="category" value="headphones" checked/);
    const none = await publish("No Cat", "toasters", [UPC_SONY_XM5, UPC_BOSE_QC], UPC_SONY_XM5);
    expect(none.status).toBe(422);
    expect(none.text).toContain("Pick a category");
  });

  it("the purifier form still works with no category sent, and a placebo may not be about the category", async () => {
    const j = await signIn();
    const home = await (await j.fetch("/creators")).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(home)?.[1] ?? "";
    const body = new URLSearchParams({
      csrf,
      name: "Old Form",
      verdict: UPC_LEVOIT_CORE300,
      summary: "Both purifiers ran for a week in one bedroom; the Core 300 was quieter at night.",
      disclosure: "I may earn a commission from CITED when an agent buys after reading this.",
      placeboTopic: "robot vacuum reviews",
      placeboSummary: "Three desk lamps compared on glare, colour and how warm the base gets.",
    });
    body.append("skus", UPC_WINIX_A230);
    body.append("skus", UPC_LEVOIT_CORE300);
    const ok = await j.fetch("/creators/tests", {
      method: "POST",
      headers: POST,
      body: body.toString(),
    });
    // A robot-vacuum placebo is fine for a purifier test.
    expect(ok.status).toBe(303);
    const again = new URLSearchParams(body);
    again.set("category", "robot-vacuum");
    again.delete("skus");
    again.append("skus", UPC_ROBOROCK_Q7MAX);
    again.append("skus", UPC_ROOMBA_J5);
    again.set("verdict", "close");
    const bad = await j.fetch("/creators/tests", {
      method: "POST",
      headers: POST,
      body: again.toString(),
    });
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain("other than robot vacuums");
  });
});
