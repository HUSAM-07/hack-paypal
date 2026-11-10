import { toCsv } from "./sessions";

/** The fields of GET /api/cited/api/journeys this download uses (apps/engine/src/api.ts). */
interface Journey {
  orderId: string;
  sessionId: string;
  model: string | null;
  arm: string;
  storesViewed: string[];
  storeChosen: string;
  items: { upc: string; amountMinor: number; currency: string }[];
  commission: { pending: number; paid: number; voided: number };
  holdStatus: string;
  holdUntil: string | null;
  capturedAt: string;
}

const COLS = [
  "order_id",
  "session_id",
  "model",
  "arm",
  "seller",
  "sellers_viewed",
  "upc",
  "amount",
  "currency",
  "commission_pending",
  "commission_paid",
  "commission_voided",
  "credit_state",
  "hold_until",
  "captured_at",
] as const;

const dec = (minor: number) => (minor / 100).toFixed(2);

/** One CSV row per item of each demo sale. */
export function journeysCsv(body: unknown): { text: string; rows: number } {
  const list = (body as { journeys?: Journey[] } | null)?.journeys;
  if (!Array.isArray(list)) throw new Error("The engine's answer had no journeys.");
  const rows = list.flatMap((j) =>
    j.items.map((it) => ({
      order_id: j.orderId,
      session_id: j.sessionId,
      model: j.model ?? "",
      arm: j.arm,
      seller: j.storeChosen,
      sellers_viewed: j.storesViewed.join(" "),
      upc: it.upc,
      amount: dec(it.amountMinor),
      currency: it.currency,
      commission_pending: dec(j.commission.pending),
      commission_paid: dec(j.commission.paid),
      commission_voided: dec(j.commission.voided),
      credit_state: j.holdStatus,
      hold_until: j.holdUntil ?? "",
      captured_at: j.capturedAt,
    })),
  );
  return { text: toCsv(rows, COLS), rows: list.length };
}
