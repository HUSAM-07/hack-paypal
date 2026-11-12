/**
 * Where a creator is paid: PayPal (their payer id from Log in with PayPal, the default) or Venmo.
 *
 * Venmo follows PayPal's "Payouts to Venmo" guide: the item carries `recipient_wallet: "VENMO"`,
 * a `recipient_type` of PHONE (a US mobile number) or USER_HANDLE (the Venmo username), the
 * matching `receiver`, and a `note`. US recipients and USD only. A creator on Venmo keeps their
 * PayPal payer id on file: it is the fallback for any payout Venmo can't take (another currency).
 * https://developer.paypal.com/docs/payouts/standard/payouts-to-venmo/
 */
import { z } from "zod";

export type VenmoReceiverType = "PHONE" | "USER_HANDLE";

export interface VenmoReceiver {
  type: VenmoReceiverType;
  /** What goes in the payout item's `receiver`. */
  receiver: string;
}

export type ParsedVenmo = { ok: true; value: VenmoReceiver } | { ok: false; error: string };

/**
 * A US mobile number or a Venmo username, as a creator types it. A number becomes `1-415-555-0123`
 * (the dashed country-code form PayPal's own Payouts examples use); a username keeps its `@`.
 */
export function parseVenmoReceiver(raw: unknown): ParsedVenmo {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "Add the US mobile number or @username of your Venmo." };
  if (text.length > 40) return { ok: false, error: "That Venmo detail is too long." };
  if (/^[+\d\s().-]+$/.test(text)) {
    let digits = text.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length !== 10 || /^[01]/.test(digits))
      return { ok: false, error: "Venmo payouts need a US mobile number, such as 415 555 0123." };
    return {
      ok: true,
      value: {
        type: "PHONE",
        receiver: `1-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`,
      },
    };
  }
  const handle = text.replace(/^@/, "");
  if (!/^[A-Za-z0-9_-]{5,30}$/.test(handle))
    return {
      ok: false,
      error: "A Venmo username is 5 to 30 letters, numbers, dashes or underscores.",
    };
  return { ok: true, value: { type: "USER_HANDLE", receiver: `@${handle}` } };
}

/** The sentence every payout item to Venmo carries: Venmo requires a note. */
export const VENMO_NOTE = "CITED: commission on sales your test caused";

/** Venmo takes US dollars only. */
export const VENMO_CURRENCY = "USD";

/** `Venmo ···0123` or `Venmo @name`: enough to recognise, never the full number. */
export function venmoLabel(v: VenmoReceiver): string {
  if (v.type === "USER_HANDLE") return `Venmo ${v.receiver}`;
  return `Venmo ···${v.receiver.slice(-4)}`;
}

export const PayoutMethodInput = z.object({
  creator: z.object({
    creatorId: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/),
    name: z.string().min(1).max(80),
    paypalId: z.string().regex(/^[A-Z0-9]{8,20}$/),
  }),
  method: z.enum(["PAYPAL", "VENMO"]),
  /** Required (and checked) when `method` is VENMO. */
  venmo: z.string().max(40).optional(),
});
export type PayoutMethodInput = z.infer<typeof PayoutMethodInput>;
