import { describe, expect, it } from "vitest";

describe("agent label", () => {
  it("names seeded stand-in agents plainly and keeps real model ids", async () => {
    const { agentLabel } = await import("../src/tables");
    expect(agentLabel("fake-gpt")).toBe("Seeded demo agent");
    expect(agentLabel("scripted-gpt")).toBe("Seeded demo agent");
    expect(agentLabel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
  });
});

describe("the commission what-if inputs", () => {
  it("ride along with the tables, unchanged, and are null for an engine without them", async () => {
    const { buildTables } = await import("../src/tables");
    const { raw } = await import("./fixture");
    const whatIf = { truncated: false, brands: [] };
    expect(buildTables({ ...raw, whatIf }).whatIf).toEqual(whatIf);
    expect(buildTables(raw).whatIf).toBeNull();
  });

  it("are read tolerantly: an engine without /what-if must not break the dashboards", async () => {
    const { createEngineReader } = await import("../src/dashboard");
    const f = (async (url: string) => {
      const path = new URL(url).pathname.replace("/api", "");
      if (path === "/what-if") return new Response("not found", { status: 404 });
      const body: Record<string, unknown> = {
        "/clock": { now: "2026-11-01T00:00:00Z" },
        "/lift": { brands: [] },
        "/deposits": { brands: [] },
        "/credits": { creators: [] },
        "/journeys": { journeys: [] },
        "/payouts": { batches: [] },
        "/review-flags": { flags: [] },
      };
      return new Response(JSON.stringify(body[path]), { status: 200 });
    }) as unknown as typeof fetch;
    const raw = await createEngineReader({ baseUrl: "http://engine", fetch: f })();
    expect(raw.whatIf).toBeNull();
    expect(raw.now).toBe("2026-11-01T00:00:00Z");
  });
});
