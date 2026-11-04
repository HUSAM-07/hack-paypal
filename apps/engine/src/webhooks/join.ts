import { type AttributedSale, fromPayPalValue, type Money, verifyPassport } from "@pact/protocol";
import type { Env } from "../env";

export interface OrderItem {
  upc: string;
  amount?: Money;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function money(v: unknown): Money | undefined {
  const a = obj(v);
  const value = str(a?.value);
  const cur = str(a?.currency_code);
  if (!value || !cur) return undefined;
  try {
    return fromPayPalValue(value, cur);
  } catch {
    return undefined;
  }
}

/** `items[].upc` is `{type, code}` on PayPal's wire; a bare string is accepted too. */
export function readItems(items: unknown): OrderItem[] {
  if (!Array.isArray(items)) return [];
  const out: OrderItem[] = [];
  for (const raw of items) {
    const it = obj(raw);
    const u = it?.upc;
    const upc = str(u) ?? str(obj(u)?.code);
    if (!upc) continue;
    const unit = money(it?.unit_amount);
    const qty = Number(it?.quantity ?? 1);
    const amount =
      unit && Number.isInteger(qty) && qty > 0
        ? { ...unit, amountMinor: unit.amountMinor * qty }
        : undefined;
    out.push(amount ? { upc, amount } : { upc });
  }
  return out;
}

/** ShortId-safe shop id from a purchase unit: merchant id, else reference id. */
export function shopOf(unit: Raw | undefined): string {
  const raw = str(obj(unit?.payee)?.merchant_id) ?? str(unit?.reference_id) ?? "unknown";
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "unknown";
}

export interface CaptureFacts {
  captureId: string;
  orderId: string;
  customId?: string;
  amount?: Money;
  capturedAt: string;
  /** Items found on the webhook resource itself, if any. */
  items: OrderItem[];
  shopId?: string;
}

/**
 * Joins a completed capture to the session arm named by its signed passport, and stores
 * one sale row per UPC. Anything that does not verify is stored as unattributed.
 */
export async function recordCapture(env: Env, f: CaptureFacts): Promise<AttributedSale[]> {
  const order = await env.DB.prepare(
    "SELECT custom_id, shop_id, items_json FROM orders WHERE order_id = ?",
  )
    .bind(f.orderId)
    .first<{ custom_id: string | null; shop_id: string; items_json: string }>();

  const items = f.items.length
    ? f.items
    : order
      ? (JSON.parse(order.items_json) as OrderItem[])
      : [];
  const customId = f.customId ?? order?.custom_id ?? undefined;
  const shopId = f.shopId ?? order?.shop_id ?? "unknown";

  let passport: Awaited<ReturnType<typeof verifyPassport>> = { ok: false, reason: "malformed" };
  let reason: string | undefined;
  if (!customId) reason = "missing_passport";
  else if (!env.PASSPORT_KEY) reason = "no_passport_key";
  else {
    passport = await verifyPassport(customId, env.PASSPORT_KEY);
    if (!passport.ok) reason = passport.reason;
  }
  const body = passport.ok ? passport.body : undefined;

  const rows = items.length ? items : [{ upc: "" } as OrderItem];
  const sold: AttributedSale[] = [];
  const stmts: D1PreparedStatement[] = [];
  let model: string | null = null;
  if (body) {
    const s = await env.DB.prepare("SELECT model FROM agent_sessions WHERE session_id = ?")
      .bind(body.sessionId)
      .first<{ model: string }>();
    model = s?.model ?? "unknown";
  }
  for (const it of rows) {
    const amount = it.amount ?? (items.length <= 1 ? f.amount : undefined);
    if (!amount) continue;
    const why = reason ?? (it.upc ? undefined : "no_upc");
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO sales (capture_id, upc, order_id, shop_id, amount_minor, currency,
           session_id, arm, creators_seen, model, captured_at, unattributed_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        f.captureId,
        it.upc,
        f.orderId,
        shopId,
        amount.amountMinor,
        amount.currency,
        why ? null : (body?.sessionId ?? null),
        why ? null : (body?.arm ?? null),
        JSON.stringify(why ? [] : (body?.creatorsSeen ?? [])),
        why ? null : model,
        f.capturedAt,
        why ?? null,
      ),
    );
    if (!why && body && model) {
      sold.push({
        captureId: f.captureId,
        orderId: f.orderId,
        shopId,
        upc: it.upc,
        amount,
        sessionId: body.sessionId,
        arm: body.arm,
        creatorsSeen: body.creatorsSeen,
        model,
        capturedAt: f.capturedAt,
      });
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return sold;
}
