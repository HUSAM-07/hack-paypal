import { describe, expect, it } from "vitest";
import { cachedRead, clearReadCache } from "../src/read-cache";

describe("cachedRead", () => {
  it("serves N polls with one engine read per TTL, and never caches writes or errors", async () => {
    clearReadCache();
    let t = 0;
    let reads = 0;
    const load = async (req: Request) => {
      reads += 1;
      if (new URL(req.url).pathname === "/api/broken") return new Response("no", { status: 500 });
      return Response.json({ n: reads, method: req.method });
    };
    const opts = { ttlMs: 10_000, now: () => t };
    const get = (path: string, method = "GET") =>
      cachedRead(new Request(`https://engine.internal${path}`, { method }), load, opts);

    const first = await Promise.all([
      get("/api/credits"),
      get("/api/credits"),
      get("/api/credits"),
    ]);
    expect(await Promise.all(first.map((r) => r.json()))).toEqual([
      { n: 1, method: "GET" },
      { n: 1, method: "GET" },
      { n: 1, method: "GET" },
    ]);
    t = 9_999;
    expect(await (await get("/api/credits")).json()).toEqual({ n: 1, method: "GET" });
    expect(reads).toBe(1);

    expect(await (await get("/api/deposits")).json()).toEqual({ n: 2, method: "GET" });
    expect(await (await get("/api/credits", "POST")).json()).toEqual({ n: 3, method: "POST" });
    expect((await get("/api/broken")).status).toBe(500);
    expect((await get("/api/broken")).status).toBe(500);
    expect(reads).toBe(5);

    t = 10_000;
    clearReadCache(); // also stands in for the edge copy expiring
    expect(await (await get("/api/credits")).json()).toEqual({ n: 6, method: "GET" });
  });
});
