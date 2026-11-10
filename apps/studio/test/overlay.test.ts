import { describe, expect, it } from "vitest";
import {
  type buildTables,
  createStudioApp,
  decodeOverlay,
  encodeOverlay,
  OVERLAY_COOKIE,
  type RawEngine,
} from "../src/index";
import { raw } from "./fixture";

const FLAG = "self_purchase:C9:housefresh";

/** The fixture with Winix short of deposit (so the Analyst asks for a top-up) and one guard hold. */
function shared(): RawEngine {
  const c2 = raw.creators[0]?.credits[1];
  if (!c2) throw new Error("fixture changed");
  const held = {
    ...c2,
    id: "C9:housefresh",
    captureId: "C9",
    state: "pending",
    payoutBatchId: null,
    payoutStatus: null,
    held: true,
    holdReasons: ["self_purchase"],
  };
  return {
    ...raw,
    deposits: raw.deposits.map((d) => ({ ...d, available: 0, deposits: d.deposits.slice(0, 1) })),
    creators: raw.creators.map((c, i) =>
      i === 0
        ? {
            ...c,
            totals: {
              ...c.totals,
              pending: c.totals.pending + held.amountMinor,
              held: held.amountMinor,
            },
            credits: [...c.credits, held],
          }
        : c,
    ),
    reviewFlags: [
      {
        id: FLAG,
        creditId: held.id,
        captureId: "C9",
        reason: "self_purchase",
        detail: "the buyer's PayPal account is the creator's",
        status: "open",
        hold: true,
        createdAt: "2026-12-01T00:00:00.000Z",
        resolvedAt: null,
        credit: {
          creatorId: "housefresh",
          brandId: held.brandId,
          amountMinor: held.amountMinor,
          currency: "USD",
          state: "pending",
        },
      },
    ],
  };
}

function hosted(now = () => Date.parse("2026-11-11T12:00:00Z")) {
  const ledger = shared();
  const before = JSON.stringify(ledger);
  const writes: unknown[] = [];
  const app = createStudioApp({
    read: async () => ledger,
    approve: async (a) => {
      writes.push(a);
      return { status: "captured" };
    },
    review: async (id, action) => {
      writes.push({ id, action });
      throw new Error("the shared ledger must not be written");
    },
    privateWrites: { cookiePath: "/studio", now },
  });
  const cookieOf = (res: Response) => {
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    return set.split(";")[0] ?? "";
  };
  const data = async (cookie?: string) =>
    (await (
      await app.request("/api/data", { headers: cookie ? { cookie } : {} })
    ).json()) as ReturnType<typeof buildTables>;
  const post = (path: string, kind: string, body?: unknown, cookie?: string) =>
    app.request(path, {
      method: "POST",
      headers: { "x-studio": kind, ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { app, ledger, before, writes, cookieOf, data, post };
}

const row = (t: ReturnType<typeof buildTables>, table: string, id: string) =>
  (t.tables as Record<string, { id: unknown }[]>)[table]?.find((r) => r.id === id) as
    | Record<string, unknown>
    | undefined;

describe("private Studio writes on the hosted demo", () => {
  it("a visitor's Approve shows them the top-up and leaves the shared ledger unchanged", async () => {
    const h = hosted();
    const sharedBefore = await h.data();
    const res = await h.post("/api/analyst/approve", "approve", {
      approvalId: "analyst-1",
      brandId: "winix",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      approved: true,
      amountMinor: 50_000,
      private: true,
      resetsAt: "2026-11-11T12:30:00.000Z",
    });
    const cookie = h.cookieOf(res);

    expect(h.writes).toEqual([]);
    expect(JSON.stringify(h.ledger)).toBe(h.before);
    expect(await h.data()).toEqual(sharedBefore);

    const mine = await h.data(cookie);
    const winix = row(sharedBefore, "brands", "winix:todate");
    expect(row(mine, "brands", "winix:todate")).toMatchObject({
      available: Number(winix?.available) + 500,
    });
    // The Analyst now sees the deposit this visitor added, so the same card can't be approved twice.
    const again = await h.post(
      "/api/analyst/approve",
      "approve",
      { approvalId: "analyst-1", brandId: "winix" },
      cookie,
    );
    expect(again.status).toBe(409);
  });

  it("a visitor's Release and Void stay private, and are refused once decided", async () => {
    for (const action of ["release", "void"] as const) {
      const h = hosted();
      const sharedBefore = await h.data();
      const res = await h.post(`/api/review-flags/${FLAG}/${action}`, "review");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        flag: { id: FLAG, status: action === "release" ? "released" : "voided" },
        private: true,
      });
      const cookie = h.cookieOf(res);

      expect(h.writes).toEqual([]);
      expect(JSON.stringify(h.ledger)).toBe(h.before);
      expect(await h.data()).toEqual(sharedBefore);
      expect(row(sharedBefore, "credits", "C9:housefresh")).toMatchObject({ state: "held" });

      const mine = await h.data(cookie);
      expect(row(mine, "credits", "C9:housefresh")).toMatchObject({
        state: action === "release" ? "pending" : "voided",
      });
      expect(row(mine, "creators", "housefresh")).toMatchObject({ held: 0, heldCount: 0 });
      if (action === "void")
        expect(Number(row(mine, "creators", "housefresh")?.voided)).toBeGreaterThan(
          Number(row(sharedBefore, "creators", "housefresh")?.voided),
        );

      const twice = await h.post(`/api/review-flags/${FLAG}/void`, "review", undefined, cookie);
      expect(twice.status).toBe(409);
      expect((await h.post("/api/review-flags/nope:x/void", "review")).status).toBe(404);
    }
  });

  it("drops a visitor's changes when they expire, and ignores a malformed cookie", async () => {
    let t = Date.parse("2026-11-11T12:00:00Z");
    const h = hosted(() => t);
    const res = await h.post(`/api/review-flags/${FLAG}/void`, "review");
    const cookie = h.cookieOf(res);
    expect(row(await h.data(cookie), "credits", "C9:housefresh")).toMatchObject({
      state: "voided",
    });
    t += 31 * 60 * 1000;
    expect(row(await h.data(cookie), "credits", "C9:housefresh")).toMatchObject({ state: "held" });
    expect((await h.data(`${OVERLAY_COOKIE}=%%%not-json`)).tables).toEqual((await h.data()).tables);
  });

  it("round-trips the cookie and keeps its first expiry", () => {
    const o = {
      expiresAt: 100,
      changes: [{ kind: "review" as const, flagId: FLAG, action: "void" as const }],
    };
    expect(decodeOverlay(encodeOverlay(o), 50)).toEqual(o);
    expect(decodeOverlay(encodeOverlay(o), 100)).toBeNull();
  });

  it("writes through to the engine where writes are open (local stacks)", async () => {
    const writes: unknown[] = [];
    const app = createStudioApp({
      read: async () => shared(),
      approve: async (a) => {
        writes.push(a);
        return { status: "captured" };
      },
    });
    const res = await app.request("/api/analyst/approve", {
      method: "POST",
      headers: { "x-studio": "approve" },
      body: JSON.stringify({ approvalId: "analyst-1", brandId: "winix" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(writes).toHaveLength(1);
  });
});
