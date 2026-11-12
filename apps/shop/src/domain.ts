/**
 * The plug-in seam between the App Server (this package) and the product (`@shop/commerce`).
 * The agent builds one domain per Durable Object instance from a factory, handing it a context
 * for state, the inbox, schedules and agent-started turns.
 */
import type { NotificationOf, Turn } from "@shop/agent-protocol";
import type { AnyTool, ApprovalItem, FakeRule, FakeScript } from "@shop/harness";
import type { z } from "zod";

export type InboxEntry = Omit<NotificationOf<"inbox/added">, "id" | "at">;

export interface ShopDomainContext<S> {
  /** Authenticated user id (the Durable Object's name). */
  userId: string;
  env: Readonly<Record<string, unknown>>;
  now(): Date;
  getState(): S;
  /** Persists, bumps the version and broadcasts `state/patch`. */
  updateState(fn: (state: S) => S): S;
  /** Broadcast `inbox/added` (something happened while no turn was running). */
  notify(entry: InboxEntry): void;
  /** Run `onSchedule(payload)` later: a Date, a delay in seconds, or a cron string. */
  schedule(when: Date | number | string, payload: unknown): Promise<string>;
  cancelSchedule(id: string): Promise<boolean>;
  /** Start an agent-originated turn, e.g. a price watch firing. Creates a thread if needed. */
  startTurn(opts: {
    threadId?: string;
    text: string;
    origin: Turn["origin"];
    title?: string;
  }): Promise<Turn>;
}

export interface ShopAction<A extends z.ZodType = z.ZodType> {
  args: A;
  run(args: z.output<A>): unknown | Promise<unknown>;
}

export const defineAction = <A extends z.ZodType>(action: ShopAction<A>) => action;

export interface ShopDomain<S> {
  initialState: S;
  /** Validates state read back from storage; a mismatch falls back to `initialState`. */
  stateSchema?: z.ZodType<S>;
  tools: readonly AnyTool[];
  /** Widget buttons that run without a chat turn (`action/invoke`). */
  actions: Readonly<Record<string, ShopAction>>;
  onSchedule?(payload: unknown): Promise<void>;
  /** The product's section of the system prompt. */
  systemPrompt?: string;
  /** Rules for the offline fake model, so `MODEL_PROVIDER=fake` demos the product's tools. */
  fakeRules?: readonly FakeRule[];
  fakeScript?: FakeScript;
  /** Server features advertised in `initialize` (e.g. "autoBuy", "webSearch"). */
  capabilities?: readonly string[];
  /** Check a WebAuthn assertion for step-up approvals. */
  verifyStepUp?(approval: ApprovalItem, assertion: unknown): boolean | Promise<boolean>;
}

export type ShopDomainFactory<S = unknown> = (ctx: ShopDomainContext<S>) => ShopDomain<S>;

/** Identity helper that keeps the state type inferred. */
export const defineShopDomain = <S>(factory: ShopDomainFactory<S>) => factory;
