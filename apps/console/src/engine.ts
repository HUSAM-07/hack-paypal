/** Read-only client for the engine's /api. Every shape here is documented in apps/engine/README.md. */

export interface EngineJourney {
  orderId: string;
  sessionId: string;
  model: string;
  arm: string;
  storesViewed: string[];
  storeChosen: string;
  items: { upc: string; amountMinor: number; currency: string }[];
  priceSavedMinor: number | null;
  commission: { pending: number; paid: number; voided: number };
  holdStatus: "none" | "held" | "paid" | "voided";
  holdUntil: string | null;
  capturedAt: string;
}

export interface EnginePayoutBatch {
  senderBatchId: string;
  paypalBatchId: string | null;
  status: string;
  items: {
    creatorId: string;
    receiver: string;
    /** "VENMO" when the creator is paid to Venmo; absent means PayPal. */
    wallet?: "VENMO";
    amountMinor: number;
    currency: string;
    creditIds: string[];
    /** PayPal's payout_item_id, when the engine records it. */
    payoutItemId?: string;
  }[];
  createdAt: string;
}

export interface EngineCreatorCredits {
  creatorId: string;
  name: string;
  totals: { pending: number; voided: number; paid: number; frozen?: number };
  credits: {
    brandId: string;
    amountMinor: number;
    /** The credit's own currency (its programme's). Absent from an engine older than currencies: USD. */
    currency?: string;
    state: string;
    /** The PayPal batch that paid it (engine `payout_batch_id`). */
    payoutBatchId?: string | null;
  }[];
}

export interface EngineLift {
  brandId: string;
  name: string;
  exposedSales: number;
  causedUnits: number;
  lowerBound: number | null;
}

/** A brand statement: the PayPal Invoicing v2 invoice the engine issues at cycle close. */
export interface EngineStatement {
  id: string;
  brandId: string;
  invoiceNumber: string;
  invoiceId: string | null;
  status: string;
  currency: string;
  creditedMinor: number;
  voidedMinor: number;
  paidMinor: number;
  returnedMinor: number;
  depositedMinor: number;
  reservedMinor: number;
  invoiceTotalMinor: number | null;
  invoicePaidMinor: number | null;
  invoiceDueMinor: number | null;
  lines: {
    creatorId: string;
    name: string;
    creditedMinor: number;
    voidedMinor: number;
    paidMinor: number;
    credits: number;
  }[];
  payoutBatchIds: string[];
  refundIds: string[];
  createdAt: string;
}

export class EngineUnavailable extends Error {}

export interface EngineClient {
  journeys(limit?: number): Promise<EngineJourney[]>;
  payouts(): Promise<EnginePayoutBatch[]>;
  credits(): Promise<EngineCreatorCredits[]>;
  lift(): Promise<EngineLift[]>;
  statements(): Promise<EngineStatement[]>;
}

export function createEngineClient(opts: {
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch | undefined;
}): EngineClient {
  const f = opts.fetch ?? fetch;
  async function get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await f(`${opts.baseUrl.replace(/\/$/, "")}/api${path}`, {
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      });
    } catch {
      throw new EngineUnavailable(`Engine not reachable at ${opts.baseUrl}`);
    }
    if (!res.ok) throw new EngineUnavailable(`Engine answered ${res.status} for /api${path}`);
    return (await res.json()) as T;
  }
  return {
    journeys: async (limit = 50) =>
      (await get<{ journeys: EngineJourney[] }>(`/journeys?limit=${limit}`)).journeys,
    payouts: async () => (await get<{ batches: EnginePayoutBatch[] }>("/payouts")).batches,
    credits: async () => (await get<{ creators: EngineCreatorCredits[] }>("/credits")).creators,
    lift: async () => (await get<{ brands: EngineLift[] }>("/lift")).brands,
    statements: async () => (await get<{ statements: EngineStatement[] }>("/invoices")).statements,
  };
}
