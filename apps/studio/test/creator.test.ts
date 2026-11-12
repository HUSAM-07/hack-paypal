import { describe, expect, it } from "vitest";
import { CREATOR_TOPICS, creatorAnswer } from "../src/creator";
import { createStudioApp } from "../src/index";
import { raw } from "./fixture";

const app = createStudioApp({ read: async () => raw });

describe("creatorAnswer", () => {
  it("explains a void from the credits and trust tables, with sources", () => {
    const a = creatorAnswer(raw, "housefresh", "voided");
    expect(a?.headline).toBe("$7.68 was voided");
    expect(a?.summary).toContain("never paid");
    expect(a?.credits[0]).toMatchObject({ amount: "$7.68", note: "Void reason: refund" });
    for (const c of a?.citations ?? []) expect(c.source).toMatch(/table/);
  });

  it("explains what was paid, naming the batch and counting only paid credits", () => {
    const a = creatorAnswer(raw, "housefresh", "earned");
    expect(a?.headline).toBe("$5.00 was your first payout");
    expect(a?.citations.map((c) => c.value)).toContain("$5.00 across 1 credit");
  });

  it("explains a shared sale from the shares table", () => {
    const j = raw.journeys[0];
    if (!j) throw new Error("fixture has no journey");
    const shared = {
      ...raw,
      journeys: [
        {
          ...j,
          shapley: [
            {
              captureId: "C2",
              shares: [
                { creatorId: "housefresh", amountMinor: 384, state: "paid" },
                { creatorId: "other", amountMinor: 384, state: "paid" },
              ],
            },
          ],
        },
      ],
    };
    const a = creatorAnswer(shared, "housefresh", "shared");
    expect(a?.headline).toBe("1 sale was split with another creator");
    expect(a?.summary).toContain("Shapley");
    expect(a?.summary).toContain("split evenly");
    expect(a?.citations.map((c) => c.value)).toContain("$3.84");
    expect(creatorAnswer(raw, "housefresh", "shared")?.headline).toBe(
      "None of your sales is shared",
    );
  });

  it("keeps advice honest: no gaming, no buying your own products", () => {
    const a = creatorAnswer(raw, "housefresh", "earn_more");
    expect(a?.summary).toMatch(/clear verdict/);
    expect(a?.summary).toMatch(/Do not buy your own products/);
    expect(a?.summary).toMatch(/do not game the holdout/);
    expect(a?.guard).toMatch(/gaming the holdout/);
  });

  it("answers every topic, and knows no creator it was not given", () => {
    for (const t of CREATOR_TOPICS) expect(creatorAnswer(raw, "housefresh", t)?.topic).toBe(t);
    expect(creatorAnswer(raw, "nobody")).toBeNull();
  });
});

describe("GET /api/creator-analyst", () => {
  it("is read-only: GET answers, every write verb is refused", async () => {
    const ok = await app.request("/api/creator-analyst?creator=housefresh&topic=voided");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { topic: string }).topic).toBe("voided");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app.request("/api/creator-analyst?creator=housefresh", {
        method,
        headers: { "x-studio": "approve", "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);
    }
  });

  it("rejects an unknown topic and an unknown creator", async () => {
    expect((await app.request("/api/creator-analyst?topic=pay")).status).toBe(400);
    expect((await app.request("/api/creator-analyst?creator=nobody")).status).toBe(404);
  });
});
