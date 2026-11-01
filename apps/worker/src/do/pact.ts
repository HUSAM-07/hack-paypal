/**
 * One per pact: group settlement. Every member's share is held (AUTHORIZE) and then
 * captured together; any failed hold, a failed capture, or the deadline voids the rest.
 * Holds are captured inside PayPal's 3-day honor period, so no reauthorization is needed.
 *
 * Policy: each member's share passes `authorize()` (unattended, so only `allow`) and is
 * reserved in their UserDO before any hold is placed.
 */
import { DurableObject } from "cloudflare:workers";
import {
  captureAll,
  type GroupMember,
  groupAuthorizeAll,
  type Hold,
  idempotencyKey,
  voidAll,
} from "@pact/paypal";
import type { Money, PactMember, SpendIntent } from "@pact/protocol";
import type { Env } from "../env";
import { nowIso } from "../ids";
import { payout } from "../payments/charge";
import { failureReason, paypalFor } from "../payments/paypal";
import type { PactView, PaymentEventInput } from "./thread";

const HONOR_PERIOD_MS = 3 * 86_400_000;
/** Capture well before the honor period ends; clocks and queues are not exact. */
const DEADLINE_MARGIN_MS = 60 * 60 * 1000;

export interface SettleInput {
  threadId: string;
  pactId: string;
  /** Distinguishes runs of a recurring pact; also the idempotency scope. */
  runId: string;
  /** Default true. False places the holds and waits for `captureHeld()` or the deadline. */
  capture?: boolean;
}

export type SettleStatus = "held" | "captured" | "voided" | "failed";

export interface SettleResult {
  status: SettleStatus;
  failures: { userId: string; reason: string }[];
}

interface MemberCharge {
  userId: string;
  intentId: string;
  amount: Money;
}

interface Run {
  threadId: string;
  pactId: string;
  runId: string;
  members: MemberCharge[];
  holds: Hold[];
  deadline: number;
  payout?: { receiver: string | null; amount: Money; note: string };
  status: SettleStatus;
  failures: SettleResult["failures"];
}

export class PactDO extends DurableObject<Env> {
  async settle(input: SettleInput): Promise<SettleResult> {
    const prior = await this.run();
    if (prior?.runId === input.runId) {
      if (prior.status === "held" && input.capture !== false) return this.captureHeld();
      return result(prior);
    }
    if (prior?.status === "held") {
      return { status: "failed", failures: [{ userId: "", reason: "previous_run_held" }] };
    }

    // Resolve PayPal first: a misconfigured worker must fail before reserving anything.
    const pp = paypalFor(this.env);
    const thread = this.thread(input.threadId);
    const view = (await thread.pactForSettlement(input.pactId)) as PactView | null;
    if (!view?.shares) {
      return { status: "failed", failures: [{ userId: "", reason: "unfunded_pact" }] };
    }
    const members: MemberCharge[] = view.shares
      .filter((s) => s.share.amountMinor > 0)
      .map((s) => ({
        userId: s.userId,
        intentId: `set_${input.pactId}_${input.runId}_${s.userId}`.slice(0, 128),
        amount: s.share,
      }));
    const intents = members.map(
      (m): SpendIntent => ({
        id: m.intentId,
        userId: m.userId,
        pactId: input.pactId,
        amount: m.amount,
        merchant: view.merchant,
        ...(view.category ? { category: view.category } : {}),
        description: `Your share of "${view.pact.title}"`.slice(0, 500),
        initiatedBy: "schedule",
        at: nowIso(),
      }),
    );
    await thread.setPactState(input.pactId, "settling", "Collecting everyone's share");

    const prepared = await Promise.all(
      intents.map((intent) =>
        this.user(intent.userId).prepareSettlement({ intent, threadId: input.threadId }),
      ),
    );
    const action = view.pact.action;
    const run: Run = {
      ...input,
      members,
      holds: [],
      deadline: deadlineFor(view),
      ...(action.kind === "payout"
        ? {
            payout: {
              receiver:
                action.payeeEmail ??
                (action.payeeUserId ? await this.user(action.payeeUserId).payoutReceiver() : null),
              amount: action.amount,
              note: view.pact.title,
            },
          }
        : {}),
      status: "failed",
      failures: [],
    };
    prepared.forEach((p, i) => {
      const userId = members[i]?.userId ?? "";
      if (!p.ok) run.failures.push({ userId, reason: p.reason });
      else if (pp && !p.vaultId) run.failures.push({ userId, reason: "no_funding" });
    });
    if (run.failures.length > 0) return this.fail(run, "A member couldn't be charged");

    if (!pp) {
      // Simulated mode: no holds to place, every share is "captured" at once.
      return this.complete(
        run,
        members.map((m) => ({ userId: m.userId, ref: `SIMULATED-${m.intentId}` })),
      );
    }

    const group = await groupAuthorizeAll(pp, {
      customId: input.pactId,
      requestIdPrefix: await prefix(run),
      description: `Pact: ${view.pact.title}`.slice(0, 127),
      members: members.map(
        (m, i): GroupMember => ({
          memberId: m.userId,
          amount: m.amount,
          source: { kind: "vault", vaultId: (prepared[i] as { vaultId: string }).vaultId },
        }),
      ),
    });
    if (!group.ok) {
      run.failures = group.failures.map((f) => ({ userId: f.memberId, reason: f.reason }));
      return this.fail(run, "A hold was declined, so every hold was released");
    }
    run.holds = group.holds;
    run.status = "held";
    await this.save(run);
    await this.ctx.storage.setAlarm(run.deadline);
    if (input.capture === false) return result(run);
    return this.captureHeld();
  }

  /** Captures every hold. A failed capture refunds the captured ones: all or nothing. */
  async captureHeld(): Promise<SettleResult> {
    const run = await this.run();
    if (run?.status !== "held") return run ? result(run) : { status: "failed", failures: [] };
    const pp = paypalFor(this.env);
    if (!pp) return result(run);
    const requestIdPrefix = await prefix(run);
    const res = await captureAll(pp, { holds: run.holds, requestIdPrefix });
    if (res.ok) {
      return this.complete(
        run,
        res.captured.map((c) => ({ userId: c.memberId, ref: c.captureId })),
      );
    }
    const capturedIds = new Set(res.captured.map((c) => c.memberId));
    await voidAll(pp, {
      holds: run.holds.filter((h) => !capturedIds.has(h.memberId)),
      requestIdPrefix,
    });
    for (const c of res.captured) {
      await pp.captures
        .refund(
          c.captureId,
          {},
          { requestId: await idempotencyKey(requestIdPrefix, c.memberId, "refund") },
        )
        .catch((e) => console.error("settlement refund failed", failureReason(e)));
    }
    run.failures = res.failed.map((f) => ({ userId: f.memberId, reason: f.reason }));
    return this.fail(run, "A capture failed, so the pact was unwound");
  }

  /** Releases every hold, e.g. the pact was cancelled. */
  async voidHeld(reason = "cancelled"): Promise<SettleResult> {
    const run = await this.run();
    if (run?.status !== "held") return run ? result(run) : { status: "failed", failures: [] };
    const pp = paypalFor(this.env);
    if (pp) await voidAll(pp, { holds: run.holds, requestIdPrefix: await prefix(run) });
    run.failures = [{ userId: "", reason }];
    return this.fail(run, "Holds released", "voided");
  }

  override async alarm(): Promise<void> {
    const run = await this.run();
    if (run?.status === "held" && Date.now() >= run.deadline - 1000) {
      await this.voidHeld("deadline");
    }
  }

  async status(): Promise<SettleResult | null> {
    const run = await this.run();
    return run ? result(run) : null;
  }

  // ── Internals ──

  private async complete(
    run: Run,
    captured: { userId: string; ref: string }[],
  ): Promise<SettleResult> {
    const events: PaymentEventInput[] = [];
    const statuses: Record<string, PactMember["status"]> = {};
    for (const c of captured) {
      const m = run.members.find((x) => x.userId === c.userId);
      if (!m) continue;
      await this.user(m.userId).finishSettlement(m.intentId, m.userId, {
        status: "charged",
        paypalRef: c.ref,
      });
      events.push({
        kind: "charged",
        userId: m.userId,
        pactId: run.pactId,
        amount: m.amount,
        paypalRef: c.ref,
      });
      statuses[m.userId] = "charged";
    }
    if (run.payout) {
      const out = run.payout.receiver
        ? await payout(this.env, {
            receiver: run.payout.receiver,
            amount: run.payout.amount,
            note: run.payout.note,
            batchId: `${await prefix(run)}:payout`,
          })
        : { status: "failed" as const, reason: "recipient_not_linked" };
      events.push({
        kind: out.status === "sent" ? "payoutSent" : "payoutFailed",
        pactId: run.pactId,
        amount: run.payout.amount,
        ...("paypalRef" in out && out.paypalRef ? { paypalRef: out.paypalRef } : {}),
      });
    }
    run.status = "captured";
    await this.save(run);
    await this.ctx.storage.deleteAlarm();
    const thread = this.thread(run.threadId);
    await thread.recordPayments(events);
    await thread.setPactState(run.pactId, "done", "Everyone's share was collected", statuses);
    return result(run);
  }

  private async fail(
    run: Run,
    note: string,
    status: "failed" | "voided" = "failed",
  ): Promise<SettleResult> {
    const failed = new Map(run.failures.map((f) => [f.userId, f.reason]));
    const statuses: Record<string, PactMember["status"]> = {};
    for (const m of run.members) {
      await this.user(m.userId).finishSettlement(m.intentId, m.userId, {
        status: "failed",
        reason: failed.get(m.userId) ?? "group_released",
      });
      if (failed.has(m.userId)) statuses[m.userId] = "failed";
    }
    run.status = status;
    run.holds = [];
    await this.save(run);
    await this.ctx.storage.deleteAlarm();
    await this.thread(run.threadId).setPactState(run.pactId, "failed", note, statuses);
    return result(run);
  }

  private run(): Promise<Run | undefined> {
    return this.ctx.storage.get<Run>("run");
  }

  private save(run: Run): Promise<void> {
    return this.ctx.storage.put("run", run);
  }

  private thread(threadId: string) {
    return this.env.THREAD.get(this.env.THREAD.idFromName(threadId));
  }

  private user(userId: string) {
    return this.env.USER.get(this.env.USER.idFromName(userId));
  }
}

function result(run: Run): SettleResult {
  return { status: run.status, failures: run.failures };
}

function prefix(run: Run): Promise<string> {
  return idempotencyKey("pact", run.pactId, run.runId);
}

/**
 * The earlier of the pact's own deadline and the end of the honor period (with margin).
 * A deadline already behind us (the trigger fired at it) leaves just the honor period.
 */
function deadlineFor(view: PactView): number {
  const honor = Date.now() + HONOR_PERIOD_MS - DEADLINE_MARGIN_MS;
  const t = view.pact.trigger;
  const own =
    t.kind === "price"
      ? Date.parse(t.deadline)
      : t.kind === "quorum"
        ? Date.parse(t.expiresAt)
        : Number.POSITIVE_INFINITY;
  return own > Date.now() ? Math.min(honor, own) : honor;
}
