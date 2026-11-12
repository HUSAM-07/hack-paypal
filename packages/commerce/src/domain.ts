/**
 * The shop domain, shaped for the harness's `ShopDomain` seam:
 *
 *   createShopDomain(deps) → { tools, actions, onSchedule, initialState }
 *
 *  - `tools[name]`: `{ name, description, args, result, needsApproval?, summarize, run }`. Tool
 *    name = widget key. `args`/`result` are the contract's zod schemas; the harness parses the
 *    model's args with `args` before calling `needsApproval`/`run`. When `needsApproval` returns
 *    a spec, the harness raises an `approval/request` and, once answered, calls `run` again with
 *    `ctx.approval` set. `run` re-checks the approval itself: the gate isn't only in the harness.
 *  - `actions[name]`: widget buttons (`action/invoke`), `{ name, args, run }`.
 *  - `onSchedule(task)`: what `ctx.schedule(at, task)` fires (watch checks, cooling-off ends).
 *    A bare string is taken as a watch id.
 *  - `initialState()`: the user's empty `ShopState`.
 */
import { completeMandateSetup, idempotencyKey, startMandateSetup } from "@pact/paypal";
import { formatCurrency, type Money } from "@pact/protocol";
import type { z } from "zod";
import {
  advanceCheckout,
  type Checkout,
  type CheckoutOptions,
  isTerminal,
  newCheckout,
  toOrder,
  transition,
} from "./checkout";
import {
  type ApprovalSpec,
  initialPrivateState,
  type PrivateState,
  rememberOffers,
  type ScheduledTask,
  type ShopContext,
  updatePrivate,
  updateState,
  upsertOrder,
  upsertWatch,
} from "./context";
import {
  type AutoBuyApprovalDetails,
  type Offer,
  type Order,
  PurchaseApprovalDetails,
  type ShopActionName,
  ShopActions,
  type ShopState,
  ToolArgs,
  type ToolName,
  type ToolResultOf,
  ToolResults,
  type Wallet,
  type Watch,
} from "./contract";
import { type CommerceDeps, ShopError } from "./deps";
import {
  contentsResult,
  offersFromSearch,
  pageContentsRequest,
  productSearchRequest,
  researchDigest,
  researchRequest,
} from "./exa";
import {
  checkPurchase,
  ledgerEntry,
  mandateForApprovedPurchase,
  mandateForRule,
  type RuleTerms,
} from "./mandate";
import { checkOfferPrice, checkPrice } from "./price";
import type { Quote } from "./sellers";
import { assertPublicHttpUrl } from "./url";
import { appendHistory, evaluateWatch, nextCheckAt, type WatchDecision } from "./watch";

export type ToolArgsParsed<N extends ToolName> = z.output<(typeof ToolArgs)[N]>;

export interface ShopTool<N extends ToolName = ToolName> {
  name: N;
  description: string;
  args: (typeof ToolArgs)[N];
  result: (typeof ToolResults)[N];
  needsApproval?: (args: ToolArgsParsed<N>, ctx: ShopContext) => Promise<ApprovalSpec | false>;
  summarize: (args: ToolArgsParsed<N>) => string;
  run: (args: ToolArgsParsed<N>, ctx: ShopContext) => Promise<ToolResultOf<N>>;
}

export type ShopActionArgs<N extends ShopActionName> = z.output<(typeof ShopActions)[N]>;

export interface ShopActionResults {
  "watch.pause": { watch: Watch };
  "watch.resume": { watch: Watch };
  "watch.cancel": { watch: Watch };
  "watch.approveReview": { watch: Watch; order?: Order };
  "order.cancel": { order: Order };
  "order.captureNow": { order: Order };
  "wallet.startConnect": { setupTokenId: string; approveUrl?: string };
  "wallet.completeConnect": { wallet: Wallet };
  "wallet.disconnect": { wallet: Wallet };
  "settings.update": { coolingOffMinutes: number };
}

export interface ShopAction<N extends ShopActionName = ShopActionName> {
  name: N;
  args: (typeof ShopActions)[N];
  run: (args: ShopActionArgs<N>, ctx: ShopContext) => Promise<ShopActionResults[N]>;
}

export type ScheduleOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "checkFailed"; watchId: string; nextCheckAt: string }
  | { kind: "watchChecked"; watch: Watch; decision: WatchDecision; order?: Order }
  | { kind: "checkoutAdvanced"; order: Order | undefined };

export interface ShopDomainOptions {
  /** Default cooling-off window (minutes). Default 10. */
  coolingOffMinutes?: number;
  /** Totals at or above this need a passkey step-up. Default $500. */
  stepUpAbove?: Money;
  checkout?: CheckoutOptions;
}

export type ShopTools = { [N in ToolName]: ShopTool<N> };
export type ShopActionHandlers = { [N in ShopActionName]: ShopAction<N> };

export interface ShopDomain {
  tools: ShopTools;
  actions: ShopActionHandlers;
  onSchedule(task: ScheduledTask | string, ctx: ShopContext): Promise<ScheduleOutcome>;
  initialState(): ShopState;
  initialPrivateState(): PrivateState;
}

const money = (m: Money) => formatCurrency(m.amountMinor, m.currency);

function maskEmail(email: string | undefined): string {
  if (!email) return "PayPal wallet";
  const [user = "", domain = ""] = email.split("@");
  return `PayPal ${user.slice(0, 1)}•••@${domain}`.slice(0, 120);
}

export function createShopDomain(deps: CommerceDeps, opts: ShopDomainOptions = {}): ShopDomain {
  const now = () => deps.clock.now();
  const iso = () => now().toISOString();

  function initialState(): ShopState {
    return {
      watches: [],
      orders: [],
      wallet: { connected: false },
      coolingOffMinutes: opts.coolingOffMinutes ?? 10,
      stepUpAbove: opts.stepUpAbove ?? { amountMinor: 50_000, currency: "USD" },
    };
  }

  // ── lookups ──

  async function findOffer(ctx: ShopContext, offerId: string): Promise<Offer> {
    const p = await ctx.getPrivate();
    const cached = p.offers[offerId];
    if (cached) return cached;
    const s = await ctx.getState();
    const fromWatch = s.watches.find((w) => w.offer.id === offerId)?.offer;
    if (fromWatch) return fromWatch;
    const seller = await deps.sellers.get(offerId, now());
    if (seller) return seller;
    throw new ShopError("not_found", "I don't have that offer any more; search again.");
  }

  async function findWatch(ctx: ShopContext, watchId: string): Promise<Watch> {
    const w = (await ctx.getState()).watches.find((x) => x.id === watchId);
    if (!w) throw new ShopError("not_found", "No such watch.");
    return w;
  }

  async function quoteFor(offer: Offer, quantity: number): Promise<Quote> {
    const q = await deps.sellers.quote(offer.id, quantity, now());
    if (!q) throw new ShopError("not_found", "That seller no longer lists this product.");
    return q;
  }

  function requireBuyable(offer: Offer): void {
    if (!offer.buyable || offer.source !== "paypalSeller" || !offer.merchant.paypalSellerId) {
      throw new ShopError(
        "offer_not_buyable",
        `${offer.merchant.name} doesn't take PayPal through us. I can watch the price and send you the link to buy there.`,
      );
    }
  }

  async function requireWallet(ctx: ShopContext): Promise<NonNullable<PrivateState["wallet"]>> {
    const w = (await ctx.getPrivate()).wallet;
    if (!w)
      throw new ShopError("wallet_not_connected", "Connect your PayPal wallet first (one time).");
    return w;
  }

  function requireApproval(ctx: ShopContext, stepUp: boolean): void {
    if (ctx.approval?.decision !== "approved") {
      throw new ShopError("approval_required", "This needs your approval first.");
    }
    if (stepUp && !ctx.approval.stepUpVerified) {
      throw new ShopError("step_up_required", "Confirm with your passkey to approve this amount.");
    }
  }

  const needsStepUp = async (ctx: ShopContext, amount: Money) => {
    const limit = (await ctx.getState()).stepUpAbove;
    return limit.currency === amount.currency && amount.amountMinor >= limit.amountMinor;
  };

  /** The active auto-buy rule (and its mandate) that covers buying this offer, if any. */
  async function coveringRule(ctx: ShopContext, offer: Offer, quote: Quote) {
    const [s, p] = [await ctx.getState(), await ctx.getPrivate()];
    for (const w of s.watches) {
      const rule = w.autoBuy;
      if (w.offer.id !== offer.id || w.status !== "active" || !rule?.mandateId) continue;
      const mandate = p.mandates.find((m) => m.id === rule.mandateId);
      const verdict = checkPurchase({
        intentId: `${w.id}:cover`,
        userId: ctx.userId,
        offer,
        quote,
        mandate,
        rule,
        ledger: p.ledger,
        now: now(),
        initiatedBy: "user",
      });
      if (verdict.ok && mandate) return { watch: w, rule, mandate };
    }
    return undefined;
  }

  // ── checkout plumbing ──

  /** Persist a checkout's new state everywhere it shows: private record, ledger, order, watch. */
  async function persistCheckout(
    ctx: ShopContext,
    before: Checkout | undefined,
    c: Checkout,
    waitUntil?: string,
  ): Promise<Order | undefined> {
    await updatePrivate(ctx, (p) => {
      let ledger = p.ledger;
      const wasHeld = before?.phase === "authorized" || before?.phase === "captured";
      const isHeld = c.phase === "authorized" || c.phase === "captured";
      if (!wasHeld && isHeld) ledger = [...ledger, ledgerEntry(c.mandateId, c.quote.total, now())];
      // Voided: no money moved, so the hold no longer counts against the mandate.
      if (wasHeld && c.phase === "voided")
        ledger = ledger.filter((e) => e.mandateId !== c.mandateId);
      return { ...p, ledger, checkouts: { ...p.checkouts, [c.orderId]: c } };
    });
    const order = toOrder(c);
    await updateState(ctx, (s) => {
      let next = order ? upsertOrder(s, order) : s;
      if (c.watchId) {
        const w = next.watches.find((x) => x.id === c.watchId);
        if (w) {
          const status: Watch["status"] =
            c.phase === "captured"
              ? "completed"
              : c.phase === "voided"
                ? "paused"
                : c.phase === "authorized"
                  ? "triggered"
                  : c.phase === "failed" || c.phase === "needsReview"
                    ? "needsReview"
                    : w.status;
          const updated: Watch = { ...w, status };
          const reason = c.phase === "failed" ? c.failureReason : c.reviewReason;
          if ((c.phase === "failed" || c.phase === "needsReview") && reason)
            updated.reviewReason = reason.slice(0, 300);
          next = upsertWatch(next, updated);
        }
      }
      return next;
    });
    if (waitUntil) await ctx.schedule(waitUntil, { kind: "capture", orderId: c.orderId });
    return order;
  }

  async function runCheckout(
    ctx: ShopContext,
    c: Checkout,
    rule: RuleTerms | undefined,
  ): Promise<{ checkout: Checkout; order: Order | undefined }> {
    const p = await ctx.getPrivate();
    const result = await advanceCheckout(deps, c, {
      mandate: p.mandates.find((m) => m.id === c.mandateId),
      rule,
      ledger: p.ledger,
      wallet: p.wallet ? { vaultId: p.wallet.vaultId } : undefined,
      ...(opts.checkout ? { options: opts.checkout } : {}),
    });
    const order = await persistCheckout(ctx, c, result.checkout, result.waitUntil);
    return { checkout: result.checkout, order };
  }

  async function startRuleCheckout(
    ctx: ShopContext,
    watch: Watch,
    initiatedBy: "user" | "schedule",
  ): Promise<Order | undefined> {
    const rule = watch.autoBuy;
    if (!rule?.mandateId) return undefined;
    const p = await ctx.getPrivate();
    if (!p.wallet) {
      await updateState(ctx, (s) =>
        upsertWatch(s, {
          ...watch,
          status: "needsReview",
          reviewReason: "Connect your PayPal wallet so I can buy it.",
        }),
      );
      return undefined;
    }
    const quote = await quoteFor(watch.offer, rule.quantity);
    const c = newCheckout({
      orderId: deps.ids.next("ord"),
      userId: ctx.userId,
      offer: watch.offer,
      quantity: rule.quantity,
      quote,
      mandateId: rule.mandateId,
      watchId: watch.id,
      initiatedBy,
      coolingOffMinutes: (await ctx.getState()).coolingOffMinutes,
      now: now(),
    });
    return (await runCheckout(ctx, c, rule)).order;
  }

  async function checkoutAction(
    ctx: ShopContext,
    orderId: string,
    event: "cancelRequested" | "captureNowRequested",
  ): Promise<Order> {
    const p = await ctx.getPrivate();
    const c = p.checkouts[orderId];
    if (!c) throw new ShopError("not_found", "No such order.");
    if (event === "cancelRequested" && c.phase === "captured") {
      throw new ShopError(
        "invalid_state",
        "That order is already paid; the undo window has closed.",
      );
    }
    if (event === "captureNowRequested" && c.phase !== "authorized") {
      throw new ShopError("invalid_state", "That order isn't waiting to be captured.");
    }
    const asked = transition(c, { type: event }, now());
    // Persist the request first: a capture racing this cancel sees it and refuses.
    await updatePrivate(ctx, (q) => ({ ...q, checkouts: { ...q.checkouts, [orderId]: asked } }));
    const watch = c.watchId
      ? (await ctx.getState()).watches.find((w) => w.id === c.watchId)
      : undefined;
    const { order } = await runCheckout(ctx, asked, watch?.autoBuy);
    const out = order ?? toOrder((await ctx.getPrivate()).checkouts[orderId] as Checkout);
    if (!out) throw new ShopError("invalid_state", "That order isn't placed yet.");
    if (event === "cancelRequested" && ctx.unschedule)
      await ctx.unschedule({ kind: "capture", orderId });
    return out;
  }

  // ── watches ──

  async function checkWatch(ctx: ShopContext, watchId: string): Promise<ScheduleOutcome> {
    const watch = (await ctx.getState()).watches.find((w) => w.id === watchId);
    if (!watch) return { kind: "skipped", reason: "watch not found" };
    if (watch.status !== "active") return { kind: "skipped", reason: `watch is ${watch.status}` };

    let check: Awaited<ReturnType<typeof checkOfferPrice>>;
    try {
      check = await checkOfferPrice(deps, watch.offer, { fresh: true });
    } catch {
      const p = await updatePrivate(ctx, (q) => ({
        ...q,
        watchFailures: { ...q.watchFailures, [watchId]: (q.watchFailures[watchId] ?? 0) + 1 },
      }));
      const at = nextCheckAt(watch, now(), p.watchFailures[watchId] ?? 1);
      await updateState(ctx, (s) => upsertWatch(s, { ...watch, nextCheckAt: at }));
      await ctx.schedule(at, { kind: "watch", watchId });
      return { kind: "checkFailed", watchId, nextCheckAt: at };
    }
    await updatePrivate(ctx, (q) => {
      const { [watchId]: _, ...rest } = q.watchFailures;
      return { ...q, watchFailures: rest };
    });

    // Decide against the history *before* this point (the median excludes the new price).
    const decision = evaluateWatch(watch, check);
    const history =
      check.price.currency === watch.targetPrice.currency
        ? appendHistory(watch.history, {
            at: check.checkedAt,
            amountMinor: check.price.amountMinor,
          })
        : watch.history;
    let updated: Watch = { ...watch, lastCheck: check, history };
    switch (decision.kind) {
      case "none": {
        const at = nextCheckAt(watch, now());
        updated = { ...updated, nextCheckAt: at };
        await updateState(ctx, (s) => upsertWatch(s, updated));
        await ctx.schedule(at, { kind: "watch", watchId });
        return { kind: "watchChecked", watch: updated, decision };
      }
      case "notify":
        updated = { ...updated, status: "triggered" };
        await updateState(ctx, (s) => upsertWatch(s, updated));
        return { kind: "watchChecked", watch: updated, decision };
      case "needsReview":
        updated = { ...updated, status: "needsReview", reviewReason: decision.reason };
        await updateState(ctx, (s) => upsertWatch(s, updated));
        return { kind: "watchChecked", watch: updated, decision };
      case "autoBuy": {
        updated = { ...updated, status: "triggered" };
        await updateState(ctx, (s) => upsertWatch(s, updated));
        const order = await startRuleCheckout(ctx, updated, "schedule");
        const latest = await findWatch(ctx, watchId);
        return { kind: "watchChecked", watch: latest, decision, ...(order ? { order } : {}) };
      }
    }
  }

  async function setWatchStatus(
    ctx: ShopContext,
    watchId: string,
    status: "active" | "paused" | "cancelled",
  ): Promise<Watch> {
    const w = await findWatch(ctx, watchId);
    if (w.status === "cancelled" || w.status === "completed") {
      throw new ShopError("invalid_state", `That watch is ${w.status}.`);
    }
    const next: Watch = { ...w, status };
    if (status === "active") next.nextCheckAt = iso();
    else delete next.nextCheckAt;
    delete next.reviewReason;
    await updateState(ctx, (s) => upsertWatch(s, next));
    if (status === "active") await ctx.schedule(iso(), { kind: "watch", watchId });
    else await ctx.unschedule?.({ kind: "watch", watchId });
    if (status === "cancelled" && w.autoBuy?.mandateId) {
      const mandateId = w.autoBuy.mandateId;
      await updatePrivate(ctx, (p) => ({
        ...p,
        mandates: p.mandates.map((m) => (m.id === mandateId ? { ...m, status: "revoked" } : m)),
      }));
    }
    return next;
  }

  // ── tools ──

  const tools: ShopTools = {
    search_products: {
      name: "search_products",
      description:
        "Search PayPal sellers (buyable with the user's wallet) and the web (watch-only) for products. Returns offers with server-read prices.",
      args: ToolArgs.search_products,
      result: ToolResults.search_products,
      summarize: (a) => `Searching for “${a.query}”`,
      async run(args, ctx) {
        const at = now();
        const [sellers, web] = await Promise.allSettled([
          deps.sellers.search({ query: args.query, maxPrice: args.maxPrice }, at),
          deps.exa.search(productSearchRequest(args)),
        ]);
        if (sellers.status === "rejected" && web.status === "rejected") {
          throw new ShopError("upstream", "Search is unavailable right now.");
        }
        const fromWeb =
          web.status === "fulfilled"
            ? offersFromSearch(web.value, at.toISOString())
            : { offers: [], sources: [] };
        const cap = args.maxPrice;
        const webOffers = fromWeb.offers.filter(
          (o) =>
            !cap || (o.price.currency === cap.currency && o.price.amountMinor <= cap.amountMinor),
        );
        // PayPal sellers first, in the source's own order (never re-ranked).
        const offers = [...(sellers.status === "fulfilled" ? sellers.value : []), ...webOffers];
        await updatePrivate(ctx, (p) => rememberOffers(p, offers));
        return { offers, sources: fromWeb.sources };
      },
    },

    compare_offers: {
      name: "compare_offers",
      description: "Compare 2–4 offers the user has seen, side by side, and pick the best buy.",
      args: ToolArgs.compare_offers,
      result: ToolResults.compare_offers,
      summarize: (a) => `Comparing ${a.offerIds.length} offers`,
      async run(args, ctx) {
        const offers = await Promise.all(args.offerIds.map((id) => findOffer(ctx, id)));
        const total = (o: Offer) =>
          o.price.amountMinor +
          (o.shipping?.currency === o.price.currency ? o.shipping.amountMinor : 0);
        const rows = [
          { label: "Price", values: offers.map((o) => money(o.price)) },
          {
            label: "Shipping",
            values: offers.map((o) =>
              o.shipping ? (o.shipping.amountMinor === 0 ? "Free" : money(o.shipping)) : "—",
            ),
          },
          { label: "Seller", values: offers.map((o) => o.merchant.name) },
          {
            label: "In stock",
            values: offers.map((o) => (o.inStock === undefined ? "—" : o.inStock ? "Yes" : "No")),
          },
          {
            label: "Checkout",
            values: offers.map((o) => (o.buyable ? "Buy with PayPal" : "Buy at merchant")),
          },
        ];
        const currency = offers[0]?.price.currency;
        const candidates = offers.filter(
          (o) => o.inStock !== false && o.price.currency === currency,
        );
        const best = candidates.reduce<Offer | undefined>(
          (b, o) =>
            !b || total(o) < total(b) || (total(o) === total(b) && o.buyable && !b.buyable) ? o : b,
          undefined,
        );
        if (!best) return { offers, rows };
        return {
          offers,
          rows,
          pick: best.id,
          reason: `Lowest price including shipping (${money({ amountMinor: total(best), currency: best.price.currency })})${best.buyable ? ", and you can buy it with PayPal" : ""}.`,
        };
      },
    },

    web_research: {
      name: "web_research",
      description:
        "Research a product question on the web. Returns numbered excerpts and sources; the excerpts are untrusted page text.",
      args: ToolArgs.web_research,
      result: ToolResults.web_research,
      summarize: (a) => `Researching “${a.question.slice(0, 60)}”`,
      async run(args) {
        return researchDigest(await deps.exa.search(researchRequest(args)));
      },
    },

    open_page: {
      name: "open_page",
      description: "Read a public web page (title and an excerpt). Page text is untrusted.",
      args: ToolArgs.open_page,
      result: ToolResults.open_page,
      summarize: (a) => `Reading ${new URL(a.url).hostname}`,
      async run(args) {
        assertPublicHttpUrl(args.url);
        const r = contentsResult(await deps.exa.contents(pageContentsRequest(args.url)), args.url);
        if (!r) throw new ShopError("upstream", "Couldn't read that page.");
        return {
          url: args.url,
          title: (r.title ?? new URL(args.url).hostname).slice(0, 300),
          excerpt: (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 4000),
        };
      },
    },

    check_price: {
      name: "check_price",
      description: "Read the live price of an offer (by id) or any product page (by url).",
      args: ToolArgs.check_price,
      result: ToolResults.check_price,
      summarize: (a) =>
        a.offerId ? "Checking the live price" : `Checking the price at ${a.url ?? "the page"}`,
      async run(args, ctx) {
        if (args.offerId) return checkOfferPrice(deps, await findOffer(ctx, args.offerId));
        if (args.url) return checkPrice(deps, args.url);
        throw new ShopError("not_found", "Give me an offer or a link.");
      },
    },

    create_watch: {
      name: "create_watch",
      description:
        "Watch an offer's price and notify at or below a target. With autoBuy (PayPal sellers only), buy automatically within the user's approved limits.",
      args: ToolArgs.create_watch,
      result: ToolResults.create_watch,
      summarize: (a) =>
        a.autoBuy
          ? `Watching for ${money(a.targetPrice)}, auto-buy up to ${money(a.autoBuy.maxTotal)}`
          : `Watching for ${money(a.targetPrice)}`,
      async needsApproval(args, ctx) {
        if (!args.autoBuy) return false;
        const offer = await findOffer(ctx, args.offerId);
        if (!offer.buyable) return false; // run() refuses it with an explanation.
        await requireWallet(ctx);
        const details: z.input<typeof AutoBuyApprovalDetails> = { offer, rule: args.autoBuy };
        return {
          kind: "autoBuyRule",
          title: `Auto-buy ${offer.title}`.slice(0, 120),
          summary:
            `Buy ${args.autoBuy.quantity ?? 1} from ${offer.merchant.name} when it's ${money(args.autoBuy.maxUnitPrice)} or less, never over ${money(args.autoBuy.maxTotal)} in total, until ${args.autoBuy.expiresAt.slice(0, 10)}.`.slice(
              0,
              500,
            ),
          amount: args.autoBuy.maxTotal,
          details,
          stepUp: await needsStepUp(ctx, args.autoBuy.maxTotal),
        };
      },
      async run(args, ctx) {
        const offer = await findOffer(ctx, args.offerId);
        if (args.targetPrice.currency !== offer.price.currency) {
          throw new ShopError(
            "currency_mismatch",
            `This offer is priced in ${offer.price.currency}.`,
          );
        }
        const at = now();
        const watch: Watch = {
          id: deps.ids.next("wat"),
          offer,
          targetPrice: args.targetPrice,
          status: "active",
          everyMinutes: args.everyMinutes,
          history: [],
          createdAt: at.toISOString(),
          ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
        };
        if (args.autoBuy) {
          requireBuyable(offer);
          await requireWallet(ctx);
          const rule = args.autoBuy;
          if (
            rule.maxUnitPrice.currency !== offer.price.currency ||
            rule.maxTotal.currency !== offer.price.currency
          ) {
            throw new ShopError("currency_mismatch", `Limits must be in ${offer.price.currency}.`);
          }
          requireApproval(ctx, await needsStepUp(ctx, rule.maxTotal));
          const mandate = mandateForRule({
            id: deps.ids.next("man"),
            userId: ctx.userId,
            offer,
            rule,
            now: at,
          });
          await updatePrivate(ctx, (p) => ({ ...p, mandates: [...p.mandates, mandate] }));
          watch.autoBuy = { ...rule, mandateId: mandate.id };
        }
        // First check right away: a price already under target triggers now, not in an hour.
        watch.nextCheckAt = at.toISOString();
        await updateState(ctx, (s) => upsertWatch(s, watch));
        await ctx.schedule(watch.nextCheckAt, { kind: "watch", watchId: watch.id });
        return { watch };
      },
    },

    update_watch: {
      name: "update_watch",
      description: "Change a watch's target price, interval, or pause/resume it.",
      args: ToolArgs.update_watch,
      result: ToolResults.update_watch,
      summarize: () => "Updating the watch",
      async run(args, ctx) {
        let w = await findWatch(ctx, args.watchId);
        if (args.targetPrice) {
          if (args.targetPrice.currency !== w.targetPrice.currency) {
            throw new ShopError("currency_mismatch", `This watch is in ${w.targetPrice.currency}.`);
          }
          w = { ...w, targetPrice: args.targetPrice };
        }
        if (args.everyMinutes) w = { ...w, everyMinutes: args.everyMinutes };
        await updateState(ctx, (s) => upsertWatch(s, w));
        if (args.status) w = await setWatchStatus(ctx, w.id, args.status);
        return { watch: w };
      },
    },

    cancel_watch: {
      name: "cancel_watch",
      description: "Stop watching (and revoke its auto-buy rule).",
      args: ToolArgs.cancel_watch,
      result: ToolResults.cancel_watch,
      summarize: () => "Cancelling the watch",
      async run(args, ctx) {
        return { watch: await setWatchStatus(ctx, args.watchId, "cancelled") };
      },
    },

    list_watches: {
      name: "list_watches",
      description: "The user's price watches.",
      args: ToolArgs.list_watches,
      result: ToolResults.list_watches,
      summarize: () => "Listing your watches",
      async run(_args, ctx) {
        return { watches: (await ctx.getState()).watches };
      },
    },

    buy_offer: {
      name: "buy_offer",
      description:
        "Buy a PayPal-seller offer with the user's connected PayPal wallet. Asks for approval unless an approved auto-buy rule covers it. The payment is held during a cooling-off window the user can undo.",
      args: ToolArgs.buy_offer,
      result: ToolResults.buy_offer,
      summarize: (a) => `Buying ${a.quantity} item${a.quantity > 1 ? "s" : ""}`,
      async needsApproval(args, ctx) {
        const offer = await findOffer(ctx, args.offerId);
        if (!offer.buyable) return false; // run() refuses: never buyable.
        await requireWallet(ctx);
        const quote = await quoteFor(offer, args.quantity);
        if (await coveringRule(ctx, offer, quote)) return false;
        const state = await ctx.getState();
        const details: z.input<typeof PurchaseApprovalDetails> = {
          offer,
          quantity: args.quantity,
          total: quote.total,
          coolingOffMinutes: state.coolingOffMinutes,
        };
        return {
          kind: "purchase",
          title: `Buy ${offer.title}`.slice(0, 120),
          summary:
            `${args.quantity} × ${money(quote.unit)} from ${offer.merchant.name}, ${money(quote.total)} with shipping and tax. ${state.coolingOffMinutes > 0 ? `You can undo for ${state.coolingOffMinutes} minutes.` : ""}`
              .trim()
              .slice(0, 500),
          amount: quote.total,
          details,
          stepUp: await needsStepUp(ctx, quote.total),
        };
      },
      async run(args, ctx) {
        const offer = await findOffer(ctx, args.offerId);
        requireBuyable(offer);
        await requireWallet(ctx);
        const quote = await quoteFor(offer, args.quantity);
        const covered = await coveringRule(ctx, offer, quote);
        let mandateId: string;
        let rule: RuleTerms | undefined;
        if (covered) {
          mandateId = covered.mandate.id;
          rule = covered.rule;
        } else {
          requireApproval(ctx, await needsStepUp(ctx, quote.total));
          // Cap the one-shot mandate at the total the user saw on the approval card.
          const approved = PurchaseApprovalDetails.safeParse(ctx.approval?.details);
          const cap = approved.success ? approved.data.total : quote.total;
          const mandate = mandateForApprovedPurchase({
            id: deps.ids.next("man"),
            userId: ctx.userId,
            offer,
            total: cap,
            now: now(),
          });
          await updatePrivate(ctx, (p) => ({ ...p, mandates: [...p.mandates, mandate] }));
          mandateId = mandate.id;
        }
        const c = newCheckout({
          orderId: deps.ids.next("ord"),
          userId: ctx.userId,
          offer,
          quantity: args.quantity,
          quote,
          mandateId,
          watchId: covered?.watch.id,
          initiatedBy: "user",
          coolingOffMinutes: (await ctx.getState()).coolingOffMinutes,
          now: now(),
        });
        const { checkout, order } = await runCheckout(ctx, c, rule);
        if (!order) {
          throw new ShopError(
            "invalid_state",
            checkout.reviewReason ?? "The purchase couldn't start.",
          );
        }
        return { order };
      },
    },

    list_orders: {
      name: "list_orders",
      description: "The user's orders.",
      args: ToolArgs.list_orders,
      result: ToolResults.list_orders,
      summarize: () => "Listing your orders",
      async run(_args, ctx) {
        return { orders: (await ctx.getState()).orders };
      },
    },

    cancel_order: {
      name: "cancel_order",
      description: "Undo an order during its cooling-off window (voids the PayPal authorization).",
      args: ToolArgs.cancel_order,
      result: ToolResults.cancel_order,
      summarize: () => "Cancelling the order",
      async run(args, ctx) {
        return { order: await checkoutAction(ctx, args.orderId, "cancelRequested") };
      },
    },
  };

  // ── actions ──

  const actions: ShopActionHandlers = {
    "watch.pause": {
      name: "watch.pause",
      args: ShopActions["watch.pause"],
      run: async (a, ctx) => ({ watch: await setWatchStatus(ctx, a.watchId, "paused") }),
    },
    "watch.resume": {
      name: "watch.resume",
      args: ShopActions["watch.resume"],
      run: async (a, ctx) => ({ watch: await setWatchStatus(ctx, a.watchId, "active") }),
    },
    "watch.cancel": {
      name: "watch.cancel",
      args: ShopActions["watch.cancel"],
      run: async (a, ctx) => ({ watch: await setWatchStatus(ctx, a.watchId, "cancelled") }),
    },
    "watch.approveReview": {
      name: "watch.approveReview",
      args: ShopActions["watch.approveReview"],
      async run(a, ctx) {
        const w = await findWatch(ctx, a.watchId);
        if (w.status !== "needsReview") throw new ShopError("invalid_state", "Nothing to review.");
        const rule = w.autoBuy;
        const price = w.lastCheck?.price;
        const buyNow =
          rule?.mandateId !== undefined &&
          price !== undefined &&
          price.currency === rule.maxUnitPrice.currency &&
          price.amountMinor <= rule.maxUnitPrice.amountMinor &&
          now().getTime() < Date.parse(rule.expiresAt);
        if (buyNow) {
          // The user looked at the anomaly and said go: a present-human purchase, same limits.
          const reviewed: Watch = { ...w, status: "triggered" };
          delete reviewed.reviewReason;
          await updateState(ctx, (s) => upsertWatch(s, reviewed));
          const order = await startRuleCheckout(ctx, reviewed, "user");
          return { watch: await findWatch(ctx, w.id), ...(order ? { order } : {}) };
        }
        return { watch: await setWatchStatus(ctx, w.id, "active") };
      },
    },
    "order.cancel": {
      name: "order.cancel",
      args: ShopActions["order.cancel"],
      run: async (a, ctx) => ({ order: await checkoutAction(ctx, a.orderId, "cancelRequested") }),
    },
    "order.captureNow": {
      name: "order.captureNow",
      args: ShopActions["order.captureNow"],
      run: async (a, ctx) => ({
        order: await checkoutAction(ctx, a.orderId, "captureNowRequested"),
      }),
    },
    "wallet.startConnect": {
      name: "wallet.startConnect",
      args: ShopActions["wallet.startConnect"],
      async run(_a, ctx) {
        const attemptId = deps.ids.next("wsetup");
        const started = await startMandateSetup(deps.paypal, {
          returnUrl: deps.config.walletReturnUrl,
          cancelUrl: deps.config.walletCancelUrl,
          description: "Shop purchases you approve",
          usagePattern: "UNSCHEDULED_POSTPAID",
          ...(deps.config.brandName ? { brandName: deps.config.brandName } : {}),
          requestId: await idempotencyKey("shop", ctx.userId, "wallet-setup", attemptId),
        });
        await updatePrivate(ctx, (p) => ({
          ...p,
          pendingWalletSetup: { setupTokenId: started.setupTokenId, attemptId, startedAt: iso() },
        }));
        return {
          setupTokenId: started.setupTokenId,
          ...(started.approveUrl ? { approveUrl: started.approveUrl } : {}),
        };
      },
    },
    "wallet.completeConnect": {
      name: "wallet.completeConnect",
      args: ShopActions["wallet.completeConnect"],
      async run(a, ctx) {
        const pending = (await ctx.getPrivate()).pendingWalletSetup;
        if (!pending || pending.setupTokenId !== a.setupTokenId) {
          throw new ShopError("invalid_state", "That wallet link isn't the one we started.");
        }
        const funding = await completeMandateSetup(deps.paypal, {
          setupTokenId: a.setupTokenId,
          requestId: await idempotencyKey("shop", ctx.userId, "wallet", a.setupTokenId),
        });
        const connectedAt = iso();
        await updatePrivate(ctx, (p) => {
          const { pendingWalletSetup: _, ...rest } = p;
          return {
            ...rest,
            wallet: {
              vaultId: funding.vaultId,
              customerId: funding.customerId,
              connectedAt,
              ...(funding.payerEmail ? { payerEmail: funding.payerEmail } : {}),
            },
          };
        });
        const wallet: Wallet = {
          connected: true,
          label: maskEmail(funding.payerEmail),
          connectedAt,
        };
        await updateState(ctx, (s) => ({ ...s, wallet }));
        return { wallet };
      },
    },
    "wallet.disconnect": {
      name: "wallet.disconnect",
      args: ShopActions["wallet.disconnect"],
      async run(_a, ctx) {
        const w = (await ctx.getPrivate()).wallet;
        if (w) {
          // Revoke at the source too; a failure here still disconnects locally.
          await deps.paypal.vault.paymentTokens
            .delete(w.vaultId, {
              requestId: await idempotencyKey("shop", ctx.userId, "wallet-delete", w.vaultId),
            })
            .catch(() => undefined);
        }
        await updatePrivate(ctx, (p) => {
          const { wallet: _, ...rest } = p;
          return rest;
        });
        const wallet: Wallet = { connected: false };
        await updateState(ctx, (s) => ({ ...s, wallet }));
        return { wallet };
      },
    },
    "settings.update": {
      name: "settings.update",
      args: ShopActions["settings.update"],
      async run(a, ctx) {
        const s = await updateState(ctx, (st) => ({
          ...st,
          ...(a.coolingOffMinutes !== undefined ? { coolingOffMinutes: a.coolingOffMinutes } : {}),
        }));
        return { coolingOffMinutes: s.coolingOffMinutes };
      },
    },
  };

  async function onSchedule(
    task: ScheduledTask | string,
    ctx: ShopContext,
  ): Promise<ScheduleOutcome> {
    const t: ScheduledTask = typeof task === "string" ? { kind: "watch", watchId: task } : task;
    if (t.kind === "watch") return checkWatch(ctx, t.watchId);
    const c = (await ctx.getPrivate()).checkouts[t.orderId];
    if (!c) return { kind: "skipped", reason: "order not found" };
    if (isTerminal(c)) return { kind: "checkoutAdvanced", order: toOrder(c) };
    const watch = c.watchId
      ? (await ctx.getState()).watches.find((w) => w.id === c.watchId)
      : undefined;
    const { order } = await runCheckout(ctx, c, watch?.autoBuy);
    return { kind: "checkoutAdvanced", order };
  }

  return { tools, actions, onSchedule, initialState, initialPrivateState };
}
