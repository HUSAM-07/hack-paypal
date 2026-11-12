/**
 * The Trust view's rows: every credit the engine is not simply holding for 30 days, in words.
 * A credit lands here when the abuse guard holds it for a reviewer, a PayPal dispute freezes it,
 * a refund or a lost dispute voided it, a reviewer voided it, or a reviewer released a hold.
 *
 * Reasons come only from what the engine emits: the guard's four hold codes (@pact/attribution
 * HOLD_REASONS), a frozen credit (an open dispute) and a void's reason (refund, partial_refund,
 * dispute, review). Pure: no new read endpoint, no write.
 */
import type { RawEngine, RawReviewFlag } from "./dashboard";

type Row = Record<string, string | number | boolean | null>;

export type TrustStatus = "held" | "frozen" | "voided" | "released";

export const TRUST_STATUS_LABEL: Record<TrustStatus, string> = {
  held: "Waiting for a reviewer",
  frozen: "Frozen",
  voided: "Voided",
  released: "Released by a reviewer",
};

/** The reasons, in plain English, keyed by the engine's code. One line each, no jargon. */
export const TRUST_REASON: Record<string, string> = {
  self_purchase: "Creator bought through their own PayPal",
  repeat_buyer: "Same buyer bought repeatedly",
  velocity: "Sudden spike in sales",
  refund_ring: "Buyer refunds often",
  open_dispute: "Open dispute: frozen until PayPal decides",
  refund: "Refund voided this credit",
  partial_refund: "Part of the sale was refunded",
  dispute: "Buyer won a dispute, so this credit was voided",
  review: "A reviewer voided this credit",
};

const GUARD_CODES = ["self_purchase", "repeat_buyer", "velocity", "refund_ring"];

/**
 * The guard's own detail line, said for a shop owner. Falls back to the plain reason when the
 * engine's wording is not one we know, so an unexpected line is never shown raw.
 */
export function explainHold(code: string, detail: string | null): string {
  const d = detail ?? "";
  if (code === "self_purchase")
    return d.startsWith("the agent session")
      ? "The shopping agent that made this sale belongs to the creator being credited."
      : "The PayPal account that paid is the creator's own.";
  if (code === "repeat_buyer") {
    const m = /purchase (\d+) of this UPC by one buyer in (\d+) days \(limit (\d+)\)/.exec(d);
    return m
      ? `This is purchase ${m[1]} of the same product by one buyer within ${m[2]} days (up to ${m[3]} is normal).`
      : "One buyer bought the same product more often than usual.";
  }
  if (code === "velocity") {
    const m = /(\d+) caused sales in (\d+) min, limit (\d+)/.exec(d);
    return m
      ? `${m[1]} sales credited to one creator in ${m[2]} minutes (more than ${m[3]} is unusual).`
      : "A creator's credited sales jumped far above their usual pace.";
  }
  if (code === "refund_ring") {
    const m = /refunded (\d+) of (\d+) credited sales/.exec(d);
    return m
      ? `This buyer refunded ${m[1]} of their ${m[2]} credited purchases.`
      : "This buyer refunds most of what they buy.";
  }
  return TRUST_REASON[code] ?? "";
}

export interface TrustContext {
  nameOf: (creatorId: string) => string;
  brandOf: (brandId: string) => string;
  orderOfCapture: Map<string, string>;
  saleDateOfOrder: Map<string, string>;
}

const usd = (minor: number) => Math.round(minor) / 100;

export function trustRows(raw: RawEngine, ctx: TrustContext): Row[] {
  const holdFlags = new Map<string, RawReviewFlag[]>();
  for (const f of raw.reviewFlags ?? [])
    if (f.hold && GUARD_CODES.includes(f.reason))
      holdFlags.set(f.creditId, [...(holdFlags.get(f.creditId) ?? []), f]);

  const rows: Row[] = [];
  for (const c of raw.creators) {
    for (const x of c.credits) {
      const flags = holdFlags.get(x.id) ?? [];
      const open = flags.filter((f) => f.status === "open");
      let status: TrustStatus | null = null;
      let codes: string[] = [];
      let why: string[] = [];

      if (x.state === "pending" && x.held) {
        status = "held";
        codes = x.holdReasons?.length ? x.holdReasons : open.map((f) => f.reason);
        why = codes.map((k) => explainHold(k, open.find((f) => f.reason === k)?.detail ?? null));
        if (x.frozen) {
          codes = [...codes, "open_dispute"];
          why = [...why, "The buyer also has a PayPal dispute open."];
        }
      } else if (x.state === "pending" && x.frozen) {
        status = "frozen";
        codes = ["open_dispute"];
        why = ["The buyer opened a PayPal dispute. The credit is not paid while it is open."];
      } else if (x.state === "voided") {
        status = "voided";
        if (x.voidReason === "review") {
          codes = flags.length ? [...new Set(flags.map((f) => f.reason))] : ["review"];
          why = [
            "A reviewer voided it.",
            ...codes
              .filter((k) => k !== "review")
              .map((k) => explainHold(k, flags.find((f) => f.reason === k)?.detail ?? null)),
          ];
        } else {
          codes = [x.voidReason ?? "refund"];
          why =
            codes[0] === "dispute"
              ? ["PayPal decided the dispute for the buyer."]
              : codes[0] === "partial_refund"
                ? ["The seller refunded part of the sale before the credit was paid."]
                : ["The seller refunded the sale before the credit was paid."];
        }
      } else if (flags.length && !open.length && x.state !== "voided") {
        status = "released";
        codes = [...new Set(flags.map((f) => f.reason))];
        why = codes.map((k) => explainHold(k, flags.find((f) => f.reason === k)?.detail ?? null));
      }
      if (!status) continue;

      const orderId = ctx.orderOfCapture.get(x.captureId) ?? null;
      const date =
        (orderId ? ctx.saleDateOfOrder.get(orderId) : undefined) ?? flags[0]?.createdAt ?? null;
      rows.push({
        id: x.id,
        creditId: x.id,
        creatorId: c.creatorId,
        creator: ctx.nameOf(c.creatorId),
        brand: ctx.brandOf(x.brandId),
        orderId,
        amount: usd(x.amountMinor),
        currency: x.currency ?? "USD",
        status: TRUST_STATUS_LABEL[status],
        statusKey: status,
        reason: codes.map((k) => TRUST_REASON[k] ?? k).join("; "),
        reasonCodes: codes.join(","),
        why: why.filter(Boolean).join(" "),
        date: date ? date.slice(0, 10) : null,
        // The open holds a reviewer can decide, for the Release and Void buttons.
        flagIds: status === "held" ? open.map((f) => f.id).join(",") : "",
      });
    }
  }
  return rows.sort((a, b) =>
    String(a.statusKey) === String(b.statusKey)
      ? String(b.date) < String(a.date)
        ? -1
        : 1
      : ORDER.indexOf(String(a.statusKey)) - ORDER.indexOf(String(b.statusKey)),
  );
}

const ORDER: string[] = ["held", "frozen", "voided", "released"];
