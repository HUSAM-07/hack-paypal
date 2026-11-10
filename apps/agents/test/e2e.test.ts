/**
 * End to end against a real local stack: engine (wrangler dev) and the catalogue, all
 * PAYPAL_MODE=simulated. 147 agent sessions across arms and models become PayPal orders paid to
 * the sellers from the buyer's vaulted wallet, their
 * captures reach the engine through the PayPal mock's signed webhooks, credits accrue, the clock
 * jumps 30 days, one batch payout lands, one refund voids (or flags) one credit, unspent deposits
 * return, and the engine's ledger agrees with what the PayPal mocks hold.
 */
import { afterAll, describe, expect, it } from "vitest";
import { CARD, type DemoEvent, runDemo } from "../src/demo";
import { type Stack, startStack } from "../src/stack";

const stacks: Stack[] = [];
afterAll(async () => {
  await Promise.all(stacks.map((s) => s.stop()));
});

async function play(refund: "before-payout" | "after-payout", base: number) {
  const stack = await startStack({ ports: { engine: base, catalogue: base + 1 } });
  stacks.push(stack);
  const events: DemoEvent[] = [];
  const result = await runDemo({
    ...stack,
    seed: "cited-demo",
    provider: "fake",
    refund,
    emit: (e) => {
      events.push(e);
    },
  });
  await stack.stop();
  return { result, events };
}

describe("CITED end to end (simulated PayPal)", () => {
  it("before-payout: reproduces the card, voids one credit, and the ledger matches PayPal", async () => {
    const a = await play("before-payout", 18800);
    const failed = a.result.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(a.result.matchesCard).toBe(true);
    expect(a.result.numbers).toMatchObject({
      sessions: CARD.sessions,
      purchased: CARD.sessions,
      exposedSales: 57,
      causedUnits: 51,
      creditedMinor: 39_164,
      levoitCausedUnits: 0,
      liftPoints: 94,
    });
    // One credit voided before the payout: paid is the credited total minus that credit.
    expect(a.result.numbers.paidMinor).toBeLessThan(CARD.creditedMinor);
    expect(a.result.numbers.paidMinor + a.result.numbers.returnedMinor).toBe(CARD.deposit);

    // Every beat plays, in order, and a seed replays byte for byte on a fresh stack.
    const beats = a.events.filter((e) => e.type === "beat.start").map((e) => e.beat);
    expect(beats).toEqual([
      "fund",
      "exposed",
      "heldout",
      "study",
      "credits",
      "refund",
      "jump",
      "payout",
      "return",
      "analyst",
      "checks",
    ]);
    expect(a.events.map((e) => e.seq)).toEqual(a.events.map((_, i) => i + 1));
    const b = await play("before-payout", 18810);
    expect(b.events.map((e) => JSON.stringify(e))).toEqual(a.events.map((e) => JSON.stringify(e)));
  }, 240_000);

  it("after-payout: the card's $391.64 is paid and $608.36 returned; the late refund is flagged", async () => {
    const r = await play("after-payout", 18820);
    expect(r.result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.result.matchesCard).toBe(true);
    expect(r.result.numbers).toMatchObject({
      creditedMinor: 39_164,
      paidMinor: 39_164,
      returnedMinor: CARD.returnedMinor,
    });
  }, 240_000);
});
