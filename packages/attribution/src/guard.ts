import type { Credit } from "@pact/protocol";
import { MS_PER_DAY, toDate } from "./clock";

/**
 * The self-dealing and abuse guard. Pure: given the ledger and what PayPal told us about each
 * credited sale, say which pending credits must wait for a person. A held credit stays pending
 * (it still reserves the brand's deposit) but is never paid automatically: the engine leaves
 * it out of every payout until a reviewer releases or voids it.
 */
export const HOLD_REASONS = ["self_purchase", "repeat_buyer", "velocity", "refund_ring"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export interface GuardConfig {
  /**
   * Caused purchases of one UPC by one buyer, inside `repeatWindowDays`, that are credited
   * normally. An air purifier is a durable good: a household buys one, perhaps a second for
   * another room or as a gift. A third within a month is reselling or farming commission.
   */
  repeatMax: number;
  repeatWindowDays: number;
  /**
   * A creator's caused sales in any trailing `velocityWindowMs` may not exceed
   * max(`velocityFloor`, `velocityMultiple` × their average over the previous
   * `velocityBaselineDays`, scaled to the window). The floor keeps a new creator's honest launch
   * day clear: the whole demo study credits 62 sales to HouseFresh, within minutes, well under it.
   */
  velocityWindowMs: number;
  velocityBaselineDays: number;
  velocityMultiple: number;
  velocityFloor: number;
  /**
   * A buyer who refunds at least `refundRingRate` of their credited sales, over at least
   * `refundRingMinSales` of them, is churning purchases to mint commission: hold the rest.
   */
  refundRingMinSales: number;
  refundRingRate: number;
}

export const DEFAULT_GUARD: GuardConfig = {
  repeatMax: 2,
  repeatWindowDays: 30,
  velocityWindowMs: 60 * 60 * 1000,
  velocityBaselineDays: 7,
  velocityMultiple: 10,
  velocityFloor: 100,
  refundRingMinSales: 3,
  refundRingRate: 0.5,
};

/** What the engine knows about one credited sale (one capture). */
export interface GuardSale {
  captureId: string;
  upc: string;
  capturedAt: string;
  /** PayPal payer id of the wallet that paid (the vault owner). Unknown: no buyer rules apply. */
  buyerId?: string | undefined;
  /** Who runs the agent session that bought, when the agent platform says so. */
  sessionOwnerId?: string | undefined;
  /** Refunded (in full or part), or a dispute the buyer won. */
  refunded: boolean;
}

export interface GuardCreator {
  creatorId: string;
  /** The creator's linked PayPal account (their PAYPAL_ID payout receiver). */
  paypalId?: string | undefined;
}

export interface GuardInput {
  credits: readonly Credit[];
  sales: readonly GuardSale[];
  creators: readonly GuardCreator[];
  config?: Partial<GuardConfig>;
}

export interface Hold {
  creditId: string;
  captureId: string;
  creatorId: string;
  reason: HoldReason;
  detail: string;
}

const byTime = (a: GuardSale, b: GuardSale) =>
  a.capturedAt < b.capturedAt
    ? -1
    : a.capturedAt > b.capturedAt
      ? 1
      : a.captureId < b.captureId
        ? -1
        : a.captureId > b.captureId
          ? 1
          : 0;

const ms = (iso: string) => toDate(iso).getTime();

/** A sale whose buyer, or whose agent's owner, is the creator it would credit. */
export function isSelfPurchase(sale: GuardSale, creator: GuardCreator): boolean {
  const own = new Set([creator.creatorId, creator.paypalId].filter((x): x is string => !!x));
  return (
    (!!sale.buyerId && !!creator.paypalId && sale.buyerId === creator.paypalId) ||
    (!!sale.sessionOwnerId && own.has(sale.sessionOwnerId))
  );
}

/**
 * Every hold the guard puts on the ledger's pending credits, one per (credit, reason). Counts
 * look at every credit that was not voided for review (paid credits still count as history);
 * only pending credits are held. Deterministic: the same ledger always gives the same holds.
 */
export function evaluateHolds(input: GuardInput): Hold[] {
  const cfg = { ...DEFAULT_GUARD, ...input.config };
  const sales = new Map(input.sales.map((s) => [s.captureId, s]));
  const creators = new Map(input.creators.map((c) => [c.creatorId, c]));
  const counted = input.credits.filter((c) => c.voidReason !== "review" && sales.has(c.captureId));
  const holds = new Map<string, Hold>();
  const hold = (c: Credit, reason: HoldReason, detail: string) => {
    if (c.state !== "pending") return;
    const key = `${c.id}|${reason}`;
    if (!holds.has(key))
      holds.set(key, {
        creditId: c.id,
        captureId: c.captureId,
        creatorId: c.creatorId,
        reason,
        detail,
      });
  };
  const creditsOn = (captureId: string) => counted.filter((c) => c.captureId === captureId);

  // 1. Self-purchase: the creator (or their agent) bought the product their test sells.
  for (const c of counted) {
    const sale = sales.get(c.captureId) as GuardSale;
    const creator = creators.get(c.creatorId) ?? { creatorId: c.creatorId };
    if (isSelfPurchase(sale, creator))
      hold(
        c,
        "self_purchase",
        sale.buyerId && sale.buyerId === creator.paypalId
          ? "the buyer's PayPal account is the creator's"
          : "the agent session belongs to the creator",
      );
  }

  // 2. Repeat buyer: the (repeatMax+1)-th caused purchase of one UPC by one buyer in the window.
  const live = (captureId: string) => creditsOn(captureId).some((c) => c.state !== "voided");
  const purchases = new Map<string, GuardSale[]>();
  for (const id of new Set(counted.map((c) => c.captureId))) {
    const s = sales.get(id) as GuardSale;
    if (!s.buyerId || !live(id)) continue;
    const k = `${s.buyerId}|${s.upc}`;
    purchases.set(k, [...(purchases.get(k) ?? []), s]);
  }
  const repeatMs = cfg.repeatWindowDays * MS_PER_DAY;
  for (const list of purchases.values()) {
    const sorted = [...list].sort(byTime);
    sorted.forEach((s, i) => {
      const t = ms(s.capturedAt);
      const before = sorted.slice(0, i).filter((p) => t - ms(p.capturedAt) < repeatMs).length;
      if (before < cfg.repeatMax) return;
      for (const c of creditsOn(s.captureId))
        hold(
          c,
          "repeat_buyer",
          `purchase ${before + 1} of this UPC by one buyer in ${cfg.repeatWindowDays} days (limit ${cfg.repeatMax})`,
        );
    });
  }

  // 3. Velocity: a creator's caused sales in a trailing window far above their own baseline.
  const byCreator = new Map<string, GuardSale[]>();
  for (const c of counted) {
    const list = byCreator.get(c.creatorId) ?? [];
    if (!list.some((s) => s.captureId === c.captureId))
      list.push(sales.get(c.captureId) as GuardSale);
    byCreator.set(c.creatorId, list);
  }
  const baselineMs = cfg.velocityBaselineDays * MS_PER_DAY;
  for (const [creatorId, list] of byCreator) {
    const sorted = [...list].sort(byTime);
    const times = sorted.map((s) => ms(s.capturedAt));
    sorted.forEach((s, i) => {
      const t = times[i] as number;
      const start = t - cfg.velocityWindowMs;
      let inWindow = 0;
      let inBaseline = 0;
      for (let j = 0; j <= i; j++) {
        const u = times[j] as number;
        if (u > start) inWindow++;
        else if (u > start - baselineMs) inBaseline++;
      }
      const expected = (inBaseline * cfg.velocityWindowMs) / baselineMs;
      const limit = Math.max(cfg.velocityFloor, cfg.velocityMultiple * expected);
      if (inWindow <= limit) return;
      for (const c of creditsOn(s.captureId).filter((x) => x.creatorId === creatorId))
        hold(
          c,
          "velocity",
          `${inWindow} caused sales in ${cfg.velocityWindowMs / 60_000} min, limit ${Math.floor(limit)}`,
        );
    });
  }

  // 4. Refund ring: buyers who refund most of what they buy hold the rest of their credits.
  const buyerSales = new Map<string, GuardSale[]>();
  for (const id of new Set(counted.map((c) => c.captureId))) {
    const s = sales.get(id) as GuardSale;
    if (s.buyerId) buyerSales.set(s.buyerId, [...(buyerSales.get(s.buyerId) ?? []), s]);
  }
  for (const list of buyerSales.values()) {
    const refunded = list.filter((s) => s.refunded).length;
    if (list.length < cfg.refundRingMinSales || refunded < cfg.refundRingRate * list.length)
      continue;
    for (const s of list)
      for (const c of creditsOn(s.captureId))
        hold(c, "refund_ring", `buyer refunded ${refunded} of ${list.length} credited sales`);
  }

  return [...holds.values()].sort((a, b) =>
    a.creditId < b.creditId ? -1 : a.creditId > b.creditId ? 1 : a.reason < b.reason ? -1 : 1,
  );
}
