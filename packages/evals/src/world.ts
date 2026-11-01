/**
 * The deterministic world a scenario runs in: who is in the thread, what the
 * catalog sells, which mandates exist, what has already been charged, and the clock.
 *
 * Scenario files hold a `WorldFixture`; `createWorld` adds the mutable runtime
 * parts (drafts, spends, id counter) that fake tools write to during a run.
 */
import type { LedgerEntry } from "@pact/policy";
import { Mandate, Money, Pact, type SpendIntent } from "@pact/protocol";
import { z } from "zod";

export const WorldMember = z.object({
  userId: z.string(),
  displayName: z.string(),
  email: z.string().optional(),
});
export type WorldMember = z.infer<typeof WorldMember>;

export const WorldProduct = z.object({
  ref: z.string(),
  title: z.string(),
  price: Money,
  merchant: z.string(),
  category: z.string().optional(),
  /** Untrusted retailer copy. Red-team scenarios hide instructions here. */
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
});
export type WorldProduct = z.infer<typeof WorldProduct>;

export const WorldFixture = z.object({
  now: z.iso.datetime(),
  timezone: z.string().default("America/Los_Angeles"),
  threadKind: z.enum(["solo", "group"]).default("group"),
  members: z.array(WorldMember).min(1),
  /** People outside the thread the user may pay or request from. */
  contacts: z.array(WorldMember).default([]),
  products: z.array(WorldProduct).default([]),
  pacts: z.array(Pact).default([]),
  mandates: z.array(Mandate).default([]),
  ledger: z
    .array(
      z.object({
        mandateId: z.string(),
        amountMinor: z.number().int(),
        currency: z.string(),
        at: z.string(),
      }),
    )
    .default([]),
  /** Strings (vault ids, tokens) that must never appear in agent output. */
  secrets: z.array(z.string()).default([]),
});
export type WorldFixture = z.input<typeof WorldFixture>;

export interface TransferDraft {
  ref: string;
  direction: "send" | "request";
  fromUserId: string;
  counterparty: { userId?: string | undefined; email?: string | undefined; displayName: string };
  amount: Money;
  note?: string;
}

export interface SpendRecord {
  intent: SpendIntent;
  status: "executed" | "awaiting_approval" | "denied";
  approvalId?: string;
}

export interface World extends z.infer<typeof WorldFixture> {
  ledger: LedgerEntry[];
  draftPacts: Record<string, Pact>;
  transfers: Record<string, TransferDraft>;
  spends: SpendRecord[];
  seq: number;
}

export function createWorld(fixture: WorldFixture): World {
  const parsed = WorldFixture.parse(fixture);
  return { ...structuredClone(parsed), draftPacts: {}, transfers: {}, spends: [], seq: 0 };
}

/** Deterministic, ref-shaped ids (`^[a-z]+_[A-Za-z0-9]{4,40}$`). */
export function nextId(world: World, kind: string): string {
  world.seq += 1;
  return `${kind}_ev${String(world.seq).padStart(4, "0")}`;
}

export function findPerson(world: World, userId: string): WorldMember | undefined {
  return [...world.members, ...world.contacts].find((m) => m.userId === userId);
}

export function findPact(world: World, ref: string): Pact | undefined {
  return world.draftPacts[ref] ?? world.pacts.find((p) => p.id === ref);
}

export function formatMoney(m: Money): string {
  const symbol = m.currency === "USD" ? "$" : `${m.currency} `;
  const whole = Math.floor(m.amountMinor / 100).toLocaleString("en-US");
  return `${symbol}${whole}.${String(m.amountMinor % 100).padStart(2, "0")}`;
}
