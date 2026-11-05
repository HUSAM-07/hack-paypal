import type { ProgrammeDeposit } from "@pact/protocol";
import { toPayPalValue } from "@pact/protocol";
import { nowOf } from "./clock";
import type { Env } from "./env";
import { getPayPal } from "./paypal";

export interface Brand {
  brandId: string;
  name: string;
  category: string;
  upc: string;
  currency: string;
}

export interface DepositRow {
  id: string;
  brandId: string;
  category: string;
  kind: "initial" | "topup";
  orderId: string;
  captureId: string | null;
  amountMinor: number;
  returnedMinor: number;
  currency: string;
  status: "created" | "captured";
  approveUrl?: string;
  createdAt: string;
}

type Row = Record<string, unknown>;
const toBrand = (r: Row): Brand => ({
  brandId: r.brand_id as string,
  name: r.name as string,
  category: r.category as string,
  upc: r.upc as string,
  currency: r.currency as string,
});
const toDeposit = (r: Row): DepositRow => ({
  id: r.id as string,
  brandId: r.brand_id as string,
  category: r.category as string,
  kind: r.kind as "initial" | "topup",
  orderId: r.order_id as string,
  captureId: (r.capture_id as string | null) ?? null,
  amountMinor: r.amount_minor as number,
  returnedMinor: r.returned_minor as number,
  currency: r.currency as string,
  status: r.status as "created" | "captured",
  createdAt: r.created_at as string,
});

export async function listBrands(env: Env): Promise<Brand[]> {
  const { results } = await env.DB.prepare("SELECT * FROM brands ORDER BY brand_id").all<Row>();
  return results.map(toBrand);
}

export async function getBrand(env: Env, brandId: string): Promise<Brand | undefined> {
  const r = await env.DB.prepare("SELECT * FROM brands WHERE brand_id = ?")
    .bind(brandId)
    .first<Row>();
  return r ? toBrand(r) : undefined;
}

export async function listDeposits(env: Env, brandId?: string): Promise<DepositRow[]> {
  const q = brandId
    ? env.DB.prepare("SELECT * FROM deposits WHERE brand_id = ? ORDER BY rowid").bind(brandId)
    : env.DB.prepare("SELECT * FROM deposits ORDER BY rowid");
  return (await q.all<Row>()).results.map(toDeposit);
}

/** Captured deposits of a brand folded into one ProgrammeDeposit for the ledger maths. */
export function aggregateDeposit(brand: Brand, rows: readonly DepositRow[]): ProgrammeDeposit {
  const captured = rows.filter((d) => d.status === "captured");
  const sum = (f: (d: DepositRow) => number) => captured.reduce((a, d) => a + f(d), 0);
  const first = captured[0];
  return {
    id: `dep-${brand.brandId}`,
    brandId: brand.brandId,
    category: brand.category,
    captureId: first?.captureId ?? "none",
    deposited: { amountMinor: sum((d) => d.amountMinor), currency: brand.currency },
    spent: { amountMinor: 0, currency: brand.currency },
    returned: { amountMinor: sum((d) => d.returnedMinor), currency: brand.currency },
  };
}

export async function upsertBrand(env: Env, b: Brand): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO brands (brand_id, name, category, upc, currency) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (brand_id) DO UPDATE SET name = excluded.name, category = excluded.category,
       upc = excluded.upc, currency = excluded.currency`,
  )
    .bind(b.brandId, b.name, b.category, b.upc, b.currency)
    .run();
}

export interface DepositRequest {
  brandId: string;
  amountMinor: number;
  kind: "initial" | "topup";
  /** Idempotency key: the same key never charges twice. Top-ups use the approval id. */
  key: string;
}

/**
 * Create the Orders v2 CAPTURE order that funds a programme. In simulated mode the buyer
 * approval is automatic and the order is captured at once; in sandbox the order comes back
 * `created` with an approve URL and `captureDeposit` finishes it after approval.
 */
export async function requestDeposit(env: Env, req: DepositRequest): Promise<DepositRow> {
  if (!Number.isInteger(req.amountMinor) || req.amountMinor <= 0)
    throw new Error("amountMinor must be a positive integer");
  const brand = await getBrand(env, req.brandId);
  if (!brand) throw new Error("unknown brand");

  const existing = await env.DB.prepare(
    "SELECT * FROM deposits WHERE brand_id = ? AND idem_key = ?",
  )
    .bind(brand.brandId, req.key)
    .first<Row>();
  if (existing) {
    const row = toDeposit(existing);
    if (row.amountMinor !== req.amountMinor)
      throw new Error("idempotency key reused with a different amount");
    return row.status === "captured" ? row : captureDeposit(env, row.orderId);
  }

  const { paypal } = getPayPal(env);
  const amount = { amountMinor: req.amountMinor, currency: brand.currency };
  const order = await paypal.orders.create(
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount,
          reference_id: `cited-dep-${brand.brandId}`.slice(0, 256),
          custom_id: `cited-dep:${brand.brandId}`,
          description: `CITED ${brand.category} programme deposit`,
        },
      ],
    },
    { requestId: `cited-dep:${brand.brandId}:${req.key}`.slice(0, 108) },
  );
  const id = `dep_${brand.brandId}_${req.key}`.slice(0, 64);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO deposits (id, brand_id, category, kind, idem_key, order_id, amount_minor,
       currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?)`,
  )
    .bind(
      id,
      brand.brandId,
      brand.category,
      req.kind,
      req.key,
      order.id,
      amount.amountMinor,
      amount.currency,
      await nowOf(env),
    )
    .run();

  const { mock } = getPayPal(env);
  if (mock) {
    mock.approveOrder(order.id);
    return captureDeposit(env, order.id);
  }
  const row = toDeposit(
    (await env.DB.prepare("SELECT * FROM deposits WHERE id = ?").bind(id).first<Row>()) as Row,
  );
  const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  return approve ? { ...row, approveUrl: approve } : row;
}

/** Capture an approved deposit order and record the capture id. Safe to repeat. */
export async function captureDeposit(env: Env, orderId: string): Promise<DepositRow> {
  const found = await env.DB.prepare("SELECT * FROM deposits WHERE order_id = ?")
    .bind(orderId)
    .first<Row>();
  if (!found) throw new Error("unknown deposit order");
  const row = toDeposit(found);
  if (row.status === "captured") return row;

  const { paypal } = getPayPal(env);
  const order = await paypal.orders.capture(orderId, {
    requestId: `cited-dep-capture:${orderId}`.slice(0, 108),
  });
  const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap?.id || cap.status !== "COMPLETED") throw new Error("deposit capture did not complete");
  await env.DB.prepare("UPDATE deposits SET capture_id = ?, status = 'captured' WHERE order_id = ?")
    .bind(cap.id, orderId)
    .run();
  return { ...row, captureId: cap.id, status: "captured" };
}

export { toPayPalValue };
