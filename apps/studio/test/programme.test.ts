import { describe, expect, it, vi } from "vitest";
import {
  applyOverlay,
  type buildTables,
  createEngineProgrammeStarter,
  createStudioApp,
  decodeOverlay,
  encodeOverlay,
  OVERLAY_COOKIE,
  ProgrammeRejected,
} from "../src/index";
import { raw } from "./fixture";

const NOW = () => Date.parse("2026-11-11T12:00:00Z");
const ROBOROCK = "100000000006";
const TERMS = {
  category: "robot-vacuum",
  upc: ROBOROCK,
  depositMinor: 50_000,
  commissionBps: 1_200,
};

type Tables = ReturnType<typeof buildTables>;

function hosted() {
  const before = JSON.stringify(raw);
  const startProgramme = vi.fn(async () => {
    throw new Error("the shared engine must not be written on the hosted demo");
  });
  const app = createStudioApp({
    read: async () => raw,
    startProgramme,
    privateWrites: { cookiePath: "/studio", now: NOW },
  });
  const post = (body: unknown, cookie?: string, header = "programme") =>
    app.request("/api/programmes", {
      method: "POST",
      headers: { "x-studio": header, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const data = async (cookie?: string) =>
    (await (
      await app.request("/api/data", { headers: cookie ? { cookie } : {} })
    ).json()) as Tables;
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { app, post, data, cookieOf, startProgramme, before };
}

const brandRows = (t: Tables) => t.tables.brands as Record<string, unknown>[];

describe("starting a programme on the hosted demo (locked writes)", () => {
  it("shows the visitor an empty, funded programme and never writes the shared engine", async () => {
    const h = hosted();
    const res = await h.post(TERMS);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      started: true,
      private: true,
      brandId: "roborock",
      depositMinor: 50_000,
    });
    const cookie = h.cookieOf(res);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Strict/);

    const mine = await h.data(cookie);
    expect(brandRows(mine).find((r) => r.id === "roborock:todate")).toMatchObject({
      brand: "Roborock",
      category: "robot-vacuum",
      commissionRate: 0.12,
      deposited: 500,
      available: 500,
      paid: 0,
      causedUnits: 0,
      exposedSales: 0,
    });
    expect(h.startProgramme).not.toHaveBeenCalled();
    expect(JSON.stringify(raw)).toBe(h.before);
  });

  it("starts a programme in pounds or euros in the visitor's view only, in that currency", async () => {
    const h = hosted();
    const res = await h.post({ ...TERMS, currency: "GBP" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      started: true,
      private: true,
      currency: "GBP",
      depositMinor: 50_000,
      deposit: { status: "captured", currency: "GBP" },
    });
    const mine = await h.data(h.cookieOf(res));
    expect(brandRows(mine).find((r) => r.id === "roborock:todate")).toMatchObject({
      currency: "GBP",
      deposited: 500,
      available: 500,
    });
    // The dollar programme next to it is untouched, and the shared engine was never written.
    expect(brandRows(mine).find((r) => r.id === "winix:todate")?.currency).toBe("USD");
    expect(h.startProgramme).not.toHaveBeenCalled();
    expect(JSON.stringify(raw)).toBe(h.before);
  });

  it("refuses a currency a programme cannot run in", async () => {
    const h = hosted();
    for (const currency of ["JPY", "gbp", ""]) {
      const res = await h.post({ ...TERMS, currency });
      expect(res.status, currency).toBe(400);
      expect(await res.json()).toMatchObject({ error: "unsupported_currency" });
    }
  });

  it("still reads a cookie from before currencies as a dollar programme", () => {
    const o = {
      expiresAt: Math.floor(NOW() / 1000) + 600,
      changes: [
        {
          kind: "programme" as const,
          terms: {
            brandId: "roborock",
            name: "Roborock",
            product: "Q7 Max",
            category: "robot-vacuum" as const,
            upc: ROBOROCK,
            depositMinor: 50_000,
            commissionBps: 800,
          },
        },
      ],
    };
    const t = JSON.parse(
      JSON.stringify(applyOverlay(raw, decodeOverlay(encodeOverlay(o), Math.floor(NOW() / 1000)))),
    );
    expect(t.deposits.find((d: { brandId: string }) => d.brandId === "roborock").currency).toBe(
      "USD",
    );
  });

  it("is invisible to every other visitor", async () => {
    const h = hosted();
    await h.post(TERMS);
    const other = await h.data();
    expect(brandRows(other).some((r) => r.brandId === "roborock")).toBe(false);
  });

  it("leaves the programme that already runs exactly as it was", async () => {
    const h = hosted();
    const cookie = h.cookieOf(await h.post(TERMS));
    const base = await h.data();
    const mine = await h.data(cookie);
    const winixOnly = (t: Tables) =>
      Object.fromEntries(
        Object.entries(t.tables).map(([k, rows]) => [
          k,
          (rows as Record<string, unknown>[]).filter((r) => r.brandId !== "roborock"),
        ]),
      );
    // Every table, minus the new brand's own rows, is identical for the visitor and everyone else
    // (the version fingerprint differs, as it covers the new rows).
    expect(winixOnly(mine)).toEqual(winixOnly(base));
  });

  it("refuses bad terms and a product that already has a programme, like the engine", async () => {
    const h = hosted();
    for (const bad of [
      { ...TERMS, category: "humidifier" },
      { ...TERMS, upc: "100000000001" },
      { ...TERMS, depositMinor: 99 },
      { ...TERMS, depositMinor: 1000.5 },
      { ...TERMS, commissionBps: 9_999 },
    ])
      expect((await h.post(bad)).status, JSON.stringify(bad)).toBe(400);
    // The fixture's Winix has no catalogue UPC, so fund the one that does and try it twice.
    const first = await h.post(TERMS);
    const again = await h.post(TERMS, h.cookieOf(first));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "programme_exists" });
  });

  it("answers 403 without the studio header (a cross-site form cannot reach it)", async () => {
    const h = hosted();
    expect((await h.post(TERMS, undefined, "")).status).toBe(403);
    expect((await h.post(TERMS, undefined, "approve")).status).toBe(403);
  });

  it("does not believe a forged cookie that names something outside the catalogue", () => {
    const forged = encodeOverlay({
      expiresAt: Math.floor(NOW() / 1000) + 600,
      changes: [
        {
          kind: "programme",
          terms: {
            brandId: "evil",
            name: "Evil",
            product: "X",
            category: "robot-vacuum",
            upc: "999999999999",
            depositMinor: 1,
            commissionBps: 800,
          },
        },
      ],
    });
    expect(decodeOverlay(forged, Math.floor(NOW() / 1000))?.changes).toEqual([]);
    expect(OVERLAY_COOKIE).toBeTruthy();
  });

  it("is dropped with the rest of the visitor's changes when the cookie expires", () => {
    const o = {
      expiresAt: 1_000,
      changes: [
        {
          kind: "programme" as const,
          terms: {
            brandId: "roborock",
            name: "Roborock",
            product: "Q7 Max",
            category: "robot-vacuum" as const,
            upc: ROBOROCK,
            depositMinor: 50_000,
            commissionBps: 800,
          },
        },
      ],
    };
    expect(decodeOverlay(encodeOverlay(o), 999)?.changes).toHaveLength(1);
    expect(decodeOverlay(encodeOverlay(o), 1_001)).toBeNull();
    expect(applyOverlay(raw, null)).toBe(raw);
  });
});

describe("starting a programme on a keyless local stack (writes go to the engine)", () => {
  it("passes the checked-by-the-engine terms through and reports the capture", async () => {
    const seen: unknown[] = [];
    const app = createStudioApp({
      read: async () => raw,
      startProgramme: async (t) => {
        seen.push(t);
        return {
          brand: {
            brandId: "roborock",
            name: "Roborock",
            category: "robot-vacuum",
            commissionBps: 1_200,
          },
          deposit: { status: "captured", amountMinor: t.depositMinor, captureId: "CAP-1" },
        };
      },
    });
    const res = await app.request("/api/programmes", {
      method: "POST",
      headers: { "x-studio": "programme" },
      body: JSON.stringify(TERMS),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      started: true,
      brandId: "roborock",
      deposit: { status: "captured", captureId: "CAP-1" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(seen).toEqual([TERMS]);
  });

  it("relays the engine's refusal in plain words", async () => {
    const app = createStudioApp({
      read: async () => raw,
      startProgramme: async () => {
        throw new ProgrammeRejected(
          409,
          "programme_exists",
          "Roborock Q7 Max already has a programme.",
        );
      },
    });
    const res = await app.request("/api/programmes", {
      method: "POST",
      headers: { "x-studio": "programme" },
      body: JSON.stringify(TERMS),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "programme_exists",
      message: "Roborock Q7 Max already has a programme.",
    });
  });

  it("is not available when nothing is configured to write", async () => {
    const app = createStudioApp({ read: async () => raw });
    const res = await app.request("/api/programmes", {
      method: "POST",
      headers: { "x-studio": "programme" },
      body: JSON.stringify(TERMS),
    });
    expect(res.status).toBe(501);
  });
});

describe("createEngineProgrammeStarter", () => {
  it("sends the bearer token and the terms to /api/programmes, and nothing else", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const start = createEngineProgrammeStarter({
      baseUrl: "https://engine.test/",
      token: "secret",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({ brand: { brandId: "roborock" }, deposit: { status: "captured" } }),
          { status: 201 },
        );
      }) as unknown as typeof fetch,
    });
    await start(TERMS);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://engine.test/api/programmes");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(TERMS);
  });
});
