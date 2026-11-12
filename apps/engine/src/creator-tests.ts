/**
 * Tests published by onboarded creators (/creators). Stored with `source = 'onboarding'` and
 * kept out of the recorded demo: the catalogue's arms, the lift maths and the ledger read only
 * the demo's fixtures, so a new creator can never move the study's numbers.
 */
import { VerifiedTest } from "@pact/protocol";
import { z } from "zod";
import { nowOf } from "./clock";
import type { Env } from "./env";

const Short = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/);

export const PublishTestInput = z
  .object({
    creator: z.object({
      creatorId: Short,
      name: z.string().min(1).max(80),
      /** The payer id from Log in with PayPal; payouts go to it as `recipient_type: PAYPAL_ID`. */
      paypalId: z.string().regex(/^[A-Z0-9]{8,20}$/),
    }),
    test: VerifiedTest,
    placebo: VerifiedTest,
  })
  .superRefine((v, ctx) => {
    const issue = (path: string[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (v.test.kind !== "test") issue(["test", "kind"], "must be test");
    if (v.placebo.kind !== "placebo") issue(["placebo", "kind"], "must be placebo");
    if (v.test.creatorId !== v.creator.creatorId) issue(["test", "creatorId"], "not this creator");
    if (v.placebo.creatorId !== v.creator.creatorId)
      issue(["placebo", "creatorId"], "not this creator");
    if (v.test.skus.length < 2) issue(["test", "skus"], "a test compares at least two SKUs");
    const upcs = v.test.skus.map((s) => s.upc);
    if (new Set(upcs).size !== upcs.length) issue(["test", "skus"], "duplicate UPC");
    if (v.test.verdictUpc && !upcs.includes(v.test.verdictUpc))
      issue(["test", "verdictUpc"], "the verdict must be one of the tested SKUs");
    if (v.placebo.verdictUpc) issue(["placebo", "verdictUpc"], "a placebo carries no verdict");
    if (v.test.id === v.placebo.id) issue(["placebo", "id"], "must differ from the test's id");
  });
export type PublishTestInput = z.infer<typeof PublishTestInput>;

/** A creator can have this many tests published; it keeps one account from filling the store. */
export const MAX_TESTS_PER_CREATOR = 10;

export type PublishResult =
  | { ok: true; testId: string; placeboId: string; publishedAt: string }
  | { ok: false; status: 409 | 429; error: string };

export async function publishTest(env: Env, input: PublishTestInput): Promise<PublishResult> {
  const { creator, test, placebo } = input;
  const existing = await env.DB.prepare("SELECT source FROM creators WHERE creator_id = ?")
    .bind(creator.creatorId)
    .first<{ source: string }>();
  // The demo's creators are seeded by the runner; onboarding may never overwrite them.
  if (existing && existing.source !== "onboarding")
    return { ok: false, status: 409, error: "creator_reserved" };
  const have = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM creator_tests WHERE creator_id = ? AND kind = 'test'",
  )
    .bind(creator.creatorId)
    .first<{ n: number }>();
  if ((have?.n ?? 0) >= MAX_TESTS_PER_CREATOR)
    return { ok: false, status: 429, error: "too_many_tests" };
  const at = await nowOf(env);
  const put = (t: VerifiedTest, pairsWith: string | null) =>
    env.DB.prepare(
      `INSERT INTO creator_tests (test_id, creator_id, kind, pairs_with, category, body, source, published_at)
       VALUES (?, ?, ?, ?, ?, ?, 'onboarding', ?)
       ON CONFLICT (test_id) DO NOTHING`,
    ).bind(t.id, t.creatorId, t.kind, pairsWith, t.category, JSON.stringify(t), at);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO creators (creator_id, name, paypal_id, source, created_at)
       VALUES (?, ?, ?, 'onboarding', ?)
       ON CONFLICT (creator_id) DO UPDATE SET name = excluded.name, paypal_id = excluded.paypal_id`,
    ).bind(creator.creatorId, creator.name, creator.paypalId, at),
    put(test, null),
    put(placebo, test.id),
  ]);
  return { ok: true, testId: test.id, placeboId: placebo.id, publishedAt: at };
}

export interface StoredCreatorTest {
  test: VerifiedTest;
  /** The byline the creator publishes under (public: it is the name on the test). */
  creatorName: string | null;
  pairsWith: string | null;
  source: string;
  publishedAt: string;
}

export async function listCreatorTests(env: Env, creatorId?: string): Promise<StoredCreatorTest[]> {
  const base =
    "SELECT t.*, c.name AS creator_name FROM creator_tests t LEFT JOIN creators c ON c.creator_id = t.creator_id";
  const q = creatorId
    ? env.DB.prepare(`${base} WHERE t.creator_id = ? ORDER BY t.published_at DESC, t.test_id`).bind(
        creatorId,
      )
    : env.DB.prepare(`${base} ORDER BY t.published_at DESC, t.test_id LIMIT 200`);
  const { results } = await q.all<Record<string, unknown>>();
  return results.map((r) => ({
    test: VerifiedTest.parse(JSON.parse(r.body as string)),
    creatorName: (r.creator_name as string | null) ?? null,
    pairsWith: (r.pairs_with as string | null) ?? null,
    source: r.source as string,
    publishedAt: r.published_at as string,
  }));
}
