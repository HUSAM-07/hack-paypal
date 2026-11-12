import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  advanceCheckout,
  type Checkout,
  type CheckoutEvent,
  checkoutRequestId,
  checkoutWorkflowSteps,
  InvalidTransition,
  newCheckout,
  nextStep,
  toOrder,
  transition,
} from "../src/checkout";
import { Order } from "../src/contract";
import { mandateForRule } from "../src/mandate";
import type { Quote } from "../src/sellers";
import { makeDeps, T0 } from "./helpers";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const t = (min: number) => new Date(Date.parse(T0) + min * 60_000);

async function base(over: Partial<Parameters<typeof newCheckout>[0]> = {}) {
  const env = makeDeps();
  const offer = await env.sellers.get("pp_sony_xm6", t(0));
  const quote = (await env.sellers.quote("pp_sony_xm6", 1, t(0))) as Quote;
  const c = newCheckout({
    orderId: "ord_0001",
    userId: "user_1",
    offer: offer as NonNullable<typeof offer>,
    quantity: 1,
    quote,
    mandateId: "man_1",
    initiatedBy: "user",
    coolingOffMinutes: 10,
    now: t(0),
    ...over,
  });
  return { ...env, c, quote };
}

const authorized = (c: Checkout, at = t(0)) =>
  transition(
    transition(c, { type: "reverified", quote: c.quote }, at),
    { type: "authorized", paypalOrderId: "5O1", authorizationId: "AUTH1" },
    at,
  );

describe("checkout transitions", () => {
  it("quote → re-verify → authorize → cooling-off → capture", async () => {
    const { c } = await base();
    expect(nextStep(c, t(0))).toBe("reverify");
    const a = authorized(c);
    expect(a.phase).toBe("authorized");
    expect(a.coolingOffEndsAt).toBe(t(10).toISOString());
    expect(nextStep(a, t(5))).toBe("wait");
    expect(nextStep(a, t(10))).toBe("capture");
    expect(transition(a, { type: "captured", captureId: "3C1" }, t(10)).phase).toBe("captured");
  });

  it("never captures inside the cooling-off window", async () => {
    const a = authorized((await base()).c);
    expect(() => transition(a, { type: "captured", captureId: "3C1" }, t(9))).toThrow(
      InvalidTransition,
    );
    const now = transition(a, { type: "captureNowRequested" }, t(2));
    expect(nextStep(now, t(2))).toBe("capture");
    expect(transition(now, { type: "captured", captureId: "3C1" }, t(2)).phase).toBe("captured");
  });

  it("void before pay: a pending cancel blocks capture, even after the window", async () => {
    const a = transition(authorized((await base()).c), { type: "cancelRequested" }, t(3));
    expect(nextStep(a, t(30))).toBe("void");
    expect(() => transition(a, { type: "captured", captureId: "3C1" }, t(30))).toThrow(
      /void before pay/,
    );
    expect(transition(a, { type: "voided" }, t(3)).phase).toBe("voided");
  });

  it("won't authorize unverified, won't cancel a capture, cancels a quote without PayPal", async () => {
    const { c } = await base();
    expect(() =>
      transition(c, { type: "authorized", paypalOrderId: "5O", authorizationId: "A" }, t(0)),
    ).toThrow(/re-verify/);
    expect(transition(c, { type: "cancelRequested" }, t(0)).phase).toBe("voided");
    const captured = transition(authorized(c), { type: "captured", captureId: "3C" }, t(11));
    expect(() => transition(captured, { type: "cancelRequested" }, t(12))).toThrow(/refund/);
  });

  it("zero-minute cooling-off captures straight away", async () => {
    const a = authorized((await base({ coolingOffMinutes: 0 })).c);
    expect(nextStep(a, t(0))).toBe("capture");
  });

  it("no event sequence reaches captured with a cancel pending or inside the window (property)", async () => {
    const { c } = await base();
    const event = fc.constantFrom<CheckoutEvent>(
      { type: "reverified", quote: c.quote },
      { type: "reviewNeeded", reason: "x" },
      { type: "authorized", paypalOrderId: "5O", authorizationId: "A" },
      { type: "cancelRequested" },
      { type: "captureNowRequested" },
      { type: "captured", captureId: "3C" },
      { type: "voided" },
      { type: "failed", reason: "x" },
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(event, fc.integer({ min: 0, max: 30 })), { maxLength: 12 }),
        (steps) => {
          let s = c;
          let minute = 0;
          for (const [e, dt] of steps) {
            minute += dt;
            const before = s;
            try {
              s = transition(s, e, t(minute));
            } catch (err) {
              expect(err).toBeInstanceOf(InvalidTransition);
              continue;
            }
            if (s.phase === "captured" && before.phase !== "captured") {
              expect(before.cancelRequested).toBe(false);
              expect(before.verifiedAt).toBeDefined();
              const ends = Date.parse(before.coolingOffEndsAt as string);
              expect(before.captureNowRequested || t(minute).getTime() >= ends).toBe(true);
            }
            if (before.phase === "captured") expect(s.phase).toBe("captured");
          }
        },
      ),
    );
  });
});

describe("idempotency keys", () => {
  it("are stable per order and step, and within PayPal's limit", async () => {
    expect(await checkoutRequestId("ord_0001", "authorize")).toBe("shop:ord_0001:authorize");
    expect(await checkoutRequestId("ord_0001", "capture")).toBe(
      await checkoutRequestId("ord_0001", "capture"),
    );
    expect(await checkoutRequestId("ord_0001", "void")).not.toBe(
      await checkoutRequestId("ord_0002", "void"),
    );
    const long = await checkoutRequestId("x".repeat(200), "capture");
    expect(long.length).toBeLessThanOrEqual(108);
    expect(long).toBe(await checkoutRequestId("x".repeat(200), "capture"));
  });
});

describe("checkout effects against simulated PayPal", () => {
  async function ready() {
    const env = await base();
    const wallet = env.sim.vaultWallet();
    const mandate = mandateForRule({
      id: "man_1",
      userId: "user_1",
      offer: env.c.offer,
      rule: {
        maxUnitPrice: usd(40_000),
        maxTotal: usd(45_000),
        quantity: 1,
        expiresAt: "2026-12-01T00:00:00.000Z",
      },
      now: t(0),
    });
    return { ...env, wallet, mandate };
  }

  it("authorizes with intent AUTHORIZE, payee = seller, vault id, custom_id, deterministic request id", async () => {
    const { deps, c, wallet, sim, mandate } = await ready();
    const sent: { url: string; requestId: string | null; body: string }[] = [];
    const spy: typeof fetch = async (input, init) => {
      const req = new Request(input as RequestInfo, init);
      if (req.method === "POST" && !req.url.includes("oauth2")) {
        sent.push({
          url: req.url,
          requestId: req.headers.get("PayPal-Request-Id"),
          body: await req.clone().text(),
        });
      }
      return sim.fetch(input as RequestInfo, init);
    };
    const { createPayPal } = await import("@pact/paypal");
    deps.paypal = createPayPal({
      clientId: "a",
      clientSecret: "b",
      env: "sandbox",
      fetch: spy,
      maxRetries: 0,
    });

    const { checkout, waitUntil } = await advanceCheckout(deps, c, {
      mandate,
      ledger: [],
      wallet: { vaultId: wallet.id },
    });
    expect(checkout.phase).toBe("authorized");
    expect(waitUntil).toBe(t(10).toISOString());
    expect(sent).toHaveLength(1);
    expect(sent[0]?.requestId).toBe("shop:ord_0001:authorize");
    const body = JSON.parse(sent[0]?.body ?? "{}");
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.payment_source.paypal.vault_id).toBe(wallet.id);
    expect(body.purchase_units[0]).toMatchObject({
      custom_id: "ord_0001",
      payee: { merchant_id: "SELLERAUDIO01" },
      amount: { currency_code: "USD", value: "432.99" },
    });
    expect(sim.authorization(checkout.paypal.authorizationId as string)?.status).toBe("CREATED");
    expect(Order.safeParse(toOrder(checkout)).success).toBe(true);
  });

  it("a retried authorize replays instead of placing a second hold", async () => {
    const { deps, c, wallet, sim } = await ready();
    const v = transition(c, { type: "reverified", quote: c.quote }, t(0));
    const a1 = await checkoutWorkflowSteps.authorize(deps, v, { vaultId: wallet.id });
    const a2 = await checkoutWorkflowSteps.authorize(deps, v, { vaultId: wallet.id });
    expect(a1).toEqual(a2);
    expect(sim.calls()["orders.create"]).toBe(1);
  });

  it("re-verify refuses a price above the mandate and pauses on a variant change", async () => {
    const { deps, c, sellers, mandate } = await ready();
    sellers.setPrice("pp_sony_xm6", usd(44_000));
    expect(await checkoutWorkflowSteps.reverify(deps, c, { mandate, ledger: [] })).toMatchObject({
      type: "failed",
    });
    sellers.setPrice("pp_sony_xm6", usd(39_999));
    sellers.setVariant("pp_sony_xm6", "Midnight Blue");
    expect(await checkoutWorkflowSteps.reverify(deps, c, { mandate, ledger: [] })).toMatchObject({
      type: "reviewNeeded",
    });
  });

  it("captures only after the window, with its own request id", async () => {
    const { deps, c, wallet, sim, mandate, clock } = await ready();
    let r = await advanceCheckout(deps, c, { mandate, ledger: [], wallet: { vaultId: wallet.id } });
    clock.advance(5 * 60_000);
    r = await advanceCheckout(deps, r.checkout, {
      mandate,
      ledger: [],
      wallet: { vaultId: wallet.id },
    });
    expect(r.checkout.phase).toBe("authorized");
    expect(sim.calls()["authorizations.capture"]).toBeUndefined();
    expect(checkoutWorkflowSteps.waitCoolingOff(r.checkout, clock.now())).toEqual({
      ready: false,
      until: t(10).toISOString(),
    });
    clock.advance(5 * 60_000);
    r = await advanceCheckout(deps, r.checkout, {
      mandate,
      ledger: [],
      wallet: { vaultId: wallet.id },
    });
    expect(r.checkout.phase).toBe("captured");
    expect(sim.authorization(r.checkout.paypal.authorizationId as string)?.status).toBe("CAPTURED");
  });

  it("undo voids the hold; nothing is captured", async () => {
    const { deps, c, wallet, sim, mandate, clock } = await ready();
    let r = await advanceCheckout(deps, c, { mandate, ledger: [], wallet: { vaultId: wallet.id } });
    const cancelled = transition(r.checkout, { type: "cancelRequested" }, clock.now());
    clock.advance(30 * 60_000);
    r = await advanceCheckout(deps, cancelled, {
      mandate,
      ledger: [],
      wallet: { vaultId: wallet.id },
    });
    expect(r.checkout.phase).toBe("voided");
    expect(sim.authorization(r.checkout.paypal.authorizationId as string)?.status).toBe("VOIDED");
    expect(sim.calls()["authorizations.capture"]).toBeUndefined();
  });

  it("a declined authorization fails cleanly; a failed capture releases the hold", async () => {
    const { deps, c, wallet, sim, mandate, clock } = await ready();
    sim.failNext("authorize", "INSTRUMENT_DECLINED");
    const declined = await advanceCheckout(deps, c, {
      mandate,
      ledger: [],
      wallet: { vaultId: wallet.id },
    });
    expect(declined.checkout).toMatchObject({
      phase: "failed",
      failureReason: expect.stringContaining("INSTRUMENT_DECLINED"),
    });

    const again = await base({ orderId: "ord_0002" });
    const r = await advanceCheckout(deps, again.c, {
      mandate,
      ledger: [],
      wallet: { vaultId: wallet.id },
    });
    sim.failNext("capture", "PAYER_ACCOUNT_RESTRICTED");
    clock.advance(11 * 60_000);
    const done = await advanceCheckout(deps, r.checkout, {
      mandate,
      ledger: [],
      wallet: { vaultId: wallet.id },
    });
    expect(done.checkout.phase).toBe("failed");
    expect(sim.authorization(r.checkout.paypal.authorizationId as string)?.status).toBe("VOIDED");
  });

  it("no wallet → fails before any PayPal call", async () => {
    const { deps, c, sim, mandate } = await ready();
    const r = await advanceCheckout(deps, c, { mandate, ledger: [], wallet: undefined });
    expect(r.checkout.phase).toBe("failed");
    expect(sim.calls()["orders.create"]).toBeUndefined();
  });
});
