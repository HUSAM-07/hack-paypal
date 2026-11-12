/**
 * Every purchase spends against a `@pact/policy` mandate, so one engine decides all money:
 *  - an approved auto-buy rule becomes a standing mandate (one charge, total cap, expiry,
 *    this PayPal seller only);
 *  - a one-off purchase the user just approved becomes a one-shot mandate for that total.
 * `checkPurchase` adds the shop's own limits (PayPal seller, unit price, quantity) on top of
 * `authorize()`.
 */
import { authorize, type LedgerEntry } from "@pact/policy";
import type { DenyReason, Mandate, Money, PolicyDecision, SpendIntent } from "@pact/protocol";
import type { AutoBuyRule, Offer } from "./contract";
import type { Quote } from "./sellers";

export type RuleTerms = Omit<AutoBuyRule, "mandateId">;

export type PurchaseDenyReason =
  | DenyReason
  | "step_up_required"
  | "seller_not_paypal"
  | "over_unit_price"
  | "over_quantity"
  | "out_of_stock";

export type PurchaseCheck =
  | { ok: true; mandateId: string }
  | { ok: false; reasons: PurchaseDenyReason[]; decision?: PolicyDecision };

export const SHOP_CATEGORY = "shop";

function sellerOf(offer: Offer): string | undefined {
  return offer.buyable && offer.source === "paypalSeller"
    ? offer.merchant.paypalSellerId
    : undefined;
}

export function mandateForRule(input: {
  id: string;
  userId: string;
  offer: Offer;
  rule: RuleTerms;
  now: Date;
}): Mandate {
  const seller = sellerOf(input.offer);
  if (!seller) throw new Error("auto-buy rules are for PayPal sellers only");
  return {
    id: input.id,
    userId: input.userId,
    maxPerCharge: input.rule.maxTotal,
    maxTotal: input.rule.maxTotal,
    period: "none",
    categories: [SHOP_CATEGORY],
    merchantAllow: [seller],
    validFrom: input.now.toISOString(),
    validUntil: input.rule.expiresAt,
    maxCharges: 1,
    status: "active",
    createdAt: input.now.toISOString(),
  };
}

/** The user approved this exact purchase just now: a mandate for that total, briefly valid. */
export function mandateForApprovedPurchase(input: {
  id: string;
  userId: string;
  offer: Offer;
  total: Money;
  now: Date;
  validMinutes?: number;
}): Mandate {
  const seller = sellerOf(input.offer);
  if (!seller) throw new Error("only PayPal seller offers can be bought");
  return {
    id: input.id,
    userId: input.userId,
    maxPerCharge: input.total,
    maxTotal: input.total,
    period: "none",
    categories: [SHOP_CATEGORY],
    merchantAllow: [seller],
    validFrom: input.now.toISOString(),
    validUntil: new Date(input.now.getTime() + (input.validMinutes ?? 30) * 60_000).toISOString(),
    maxCharges: 1,
    status: "active",
    createdAt: input.now.toISOString(),
  };
}

export function checkPurchase(input: {
  intentId: string;
  userId: string;
  offer: Offer;
  quote: Quote;
  mandate: Mandate | undefined;
  /** The auto-buy rule's terms, when a rule placed this purchase. */
  rule?: RuleTerms | undefined;
  ledger: readonly LedgerEntry[];
  now: Date;
  initiatedBy: SpendIntent["initiatedBy"];
}): PurchaseCheck {
  const { offer, quote, rule } = input;
  const reasons: PurchaseDenyReason[] = [];
  const seller = sellerOf(offer);
  if (!seller) reasons.push("seller_not_paypal");
  if (!quote.inStock) reasons.push("out_of_stock");
  if (rule) {
    if (
      rule.maxUnitPrice.currency !== quote.unit.currency ||
      rule.maxTotal.currency !== quote.total.currency
    ) {
      reasons.push("currency_mismatch");
    } else {
      if (quote.unit.amountMinor > rule.maxUnitPrice.amountMinor) reasons.push("over_unit_price");
      if (quote.total.amountMinor > rule.maxTotal.amountMinor) reasons.push("over_total");
    }
    if (quote.quantity > rule.quantity) reasons.push("over_quantity");
    if (input.now.getTime() >= Date.parse(rule.expiresAt)) reasons.push("mandate_expired");
  }
  if (!input.mandate) reasons.push("no_mandate");
  if (reasons.length > 0 || !input.mandate) return { ok: false, reasons: dedupe(reasons) };

  const intent: SpendIntent = {
    id: input.intentId,
    userId: input.userId,
    amount: quote.total,
    merchant: seller as string,
    category: SHOP_CATEGORY,
    description: `${quote.quantity} × ${offer.title}`.slice(0, 500),
    initiatedBy: input.initiatedBy,
    at: input.now.toISOString(),
  };
  const decision = authorize(intent, [input.mandate], input.ledger, input.now);
  if (decision.outcome === "allow") return { ok: true, mandateId: decision.mandateId };
  return { ok: false, reasons: dedupe(decision.reasons), decision };
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** The ledger entry for an authorization hold (counts against the mandate until voided). */
export function ledgerEntry(mandateId: string, amount: Money, at: Date): LedgerEntry {
  return {
    mandateId,
    amountMinor: amount.amountMinor,
    currency: amount.currency,
    at: at.toISOString(),
  };
}
