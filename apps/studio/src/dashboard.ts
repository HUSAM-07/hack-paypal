/**
 * AG Studio's data: one JSON document built from the engine's read API (shapes in
 * apps/engine/README.md). Pure, so the widgets' numbers are testable without a browser.
 */

export type ArmName = "test" | "placebo" | "none";

interface ArmCount {
  sessions: number;
  purchases: number;
}

export interface RawLift {
  brandId: string;
  name: string;
  category: string;
  upc: string;
  /** The programme's commission rate in basis points. Absent from an engine older than self-serve. */
  commissionBps?: number;
  arms: Record<ArmName, ArmCount>;
  lift: number | null;
  lowerBound: number | null;
  attributableFraction: number;
  exposedSales: number;
  causedUnits: number;
}

export interface RawDeposits {
  brandId: string;
  name: string;
  currency: string;
  deposited: number;
  reserved: number;
  spent: number;
  returned: number;
  available: number;
  deposits: {
    id: string;
    kind: string;
    amountMinor: number;
    returnedMinor: number;
    status?: string;
    createdAt?: string;
  }[];
}

export interface RawPayoutBatch {
  senderBatchId: string;
  /** PayPal's payout_batch_id; credits record this one. */
  paypalBatchId?: string | null;
  status: string;
  createdAt: string;
  items: { creatorId: string; amountMinor: number; currency: string; creditIds: string[] }[];
}

export interface RawCredit {
  id: string;
  captureId: string;
  brandId: string;
  upc: string;
  amountMinor: number;
  currency: string;
  state: string;
  voidReason: string | null;
  holdUntil: string | null;
  payoutBatchId: string | null;
  payoutStatus: string | null;
  /** Pending but held back by an open PayPal dispute. */
  frozen?: boolean;
  /** Pending but held by the abuse guard for a reviewer: never paid automatically. */
  held?: boolean;
  /** The guard's open reasons, e.g. `self_purchase`. */
  holdReasons?: string[];
}

/** A review flag: a guard hold on a pending credit, or a note on a paid credit whose sale came back. */
export interface RawReviewFlag {
  id: string;
  creditId: string;
  captureId: string;
  reason: string;
  detail: string | null;
  /** open, released or voided. */
  status: string;
  /** True for a guard hold (self_purchase, repeat_buyer, velocity, refund_ring). */
  hold: boolean;
  createdAt: string | null;
  resolvedAt: string | null;
  credit: {
    creatorId: string;
    brandId: string;
    amountMinor: number;
    currency: string;
    state: string;
  } | null;
}

export interface RawCreator {
  creatorId: string;
  name: string;
  totals: { pending: number; voided: number; paid: number; frozen?: number; held?: number };
  credits: RawCredit[];
}

export interface RawJourney {
  orderId: string;
  sessionId: string;
  model: string;
  arm: string;
  storesViewed: string[];
  storeChosen: string;
  items: { upc: string; amountMinor: number; currency: string }[];
  priceSavedMinor: number | null;
  commission: { pending: number; paid: number; voided: number };
  holdStatus: string;
  holdUntil: string | null;
  shapley: {
    captureId: string;
    shares: { creatorId: string; amountMinor: number; state: string }[];
  }[];
  capturedAt: string;
}

/**
 * The recorded sales behind the Studio commission what-if (engine `GET /what-if`). Money is
 * integer minor units; the page re-runs the ledger's own maths on it and never writes back.
 */
export interface RawWhatIf {
  brands: {
    brandId: string;
    upc: string;
    currency: string;
    causedUnits: number;
    sales: RawWhatIfSale[];
    selfDealtSales: RawWhatIfSale[];
    coalitions: Record<string, number>;
  }[];
  /** True when there were too many sales to send: the panel says so instead of guessing. */
  truncated: boolean;
}

export interface RawWhatIfSale {
  captureId: string;
  orderId: string;
  shopId: string;
  upc: string;
  amount: { amountMinor: number; currency: string };
  sessionId: string;
  arm: ArmName;
  creatorsSeen: string[];
  model: string;
  capturedAt: string;
}

export interface RawEngine {
  now: string;
  lift: RawLift[];
  deposits: RawDeposits[];
  creators: RawCreator[];
  journeys: RawJourney[];
  /** Payout batches, oldest first. Optional so older callers (and tests) can omit them. */
  payouts?: RawPayoutBatch[];
  /** Review flags (guard holds and late-refund notes). Optional, like `payouts`. */
  reviewFlags?: RawReviewFlag[];
  /** Inputs for the commission what-if. Optional: an older engine does not have the endpoint. */
  whatIf?: RawWhatIf | null;
}

export interface BrandView {
  brandId: string;
  name: string;
  category: string;
  arms: { arm: ArmName; sessions: number; purchases: number; share: number }[];
  exposedSales: number;
  causedUnits: number;
  lowerBound: number | null;
  credited: number;
  pending: number;
  voided: number;
  paid: number;
  deposit: {
    initial: number;
    topUps: number;
    deposited: number;
    spent: number;
    reserved: number;
    returned: number;
    available: number;
  };
}

export interface CreditRow {
  id: string;
  captureId: string;
  brand: string;
  amountMinor: number;
  state: string;
  voidReason: string | null;
  holdUntil: string | null;
  payoutBatchId: string | null;
  /** Every creator's share of the same sale; more than one means co-exposure. */
  split: { creatorId: string; name: string; amountMinor: number }[];
}

export interface JourneyRow {
  orderId: string;
  model: string;
  arm: string;
  product: string;
  /** Store the agent read first, then the store it paid at, with each price. */
  hops: { shop: string; priceMinor: number | null }[];
  storeChosen: string;
  priceMinor: number;
  priceSavedMinor: number | null;
  commissionMinor: number;
  voidedMinor: number;
  holdStatus: string;
  holdUntil: string | null;
  shares: { creatorId: string; name: string; amountMinor: number; state: string }[];
  capturedAt: string;
}

export interface Dashboard {
  asOf: string;
  brands: BrandView[];
  creators: {
    creatorId: string;
    name: string;
    totals: RawCreator["totals"];
    credits: CreditRow[];
  }[];
  journeys: JourneyRow[];
}

const ARMS: ArmName[] = ["test", "placebo", "none"];

const share = (c: ArmCount | undefined) => (c && c.sessions > 0 ? c.purchases / c.sessions : 0);

export function buildDashboard(raw: RawEngine): Dashboard {
  const allCredits = raw.creators.flatMap((c) =>
    c.credits.map((x) => ({ ...x, creatorId: c.creatorId })),
  );
  const creatorName = new Map(raw.creators.map((c) => [c.creatorId, c.name]));
  const nameOf = (id: string) => creatorName.get(id) ?? id;
  const productOf = new Map(raw.lift.map((b) => [b.upc, b.name]));
  const brandName = new Map(raw.lift.map((b) => [b.brandId, b.name]));

  const byCapture = new Map<string, typeof allCredits>();
  for (const x of allCredits)
    byCapture.set(x.captureId, [...(byCapture.get(x.captureId) ?? []), x]);

  const brands: BrandView[] = raw.lift.map((b) => {
    const credits = allCredits.filter((x) => x.brandId === b.brandId);
    const sum = (state?: string) =>
      credits.filter((x) => !state || x.state === state).reduce((a, x) => a + x.amountMinor, 0);
    const dep = raw.deposits.find((d) => d.brandId === b.brandId);
    const initial =
      dep?.deposits.filter((d) => d.kind === "initial").reduce((a, d) => a + d.amountMinor, 0) ?? 0;
    return {
      brandId: b.brandId,
      name: b.name,
      category: b.category,
      arms: ARMS.map((arm) => ({
        arm,
        sessions: b.arms[arm]?.sessions ?? 0,
        purchases: b.arms[arm]?.purchases ?? 0,
        share: share(b.arms[arm]),
      })),
      exposedSales: b.exposedSales,
      causedUnits: b.causedUnits,
      lowerBound: b.lowerBound,
      credited: sum(),
      pending: sum("pending"),
      voided: sum("voided"),
      paid: sum("paid"),
      deposit: {
        initial,
        topUps: (dep?.deposited ?? 0) - initial,
        deposited: dep?.deposited ?? 0,
        spent: dep?.spent ?? 0,
        reserved: dep?.reserved ?? 0,
        returned: dep?.returned ?? 0,
        available: dep?.available ?? 0,
      },
    };
  });

  const creators = raw.creators.map((c) => ({
    creatorId: c.creatorId,
    name: c.name,
    totals: c.totals,
    credits: c.credits.map(
      (x): CreditRow => ({
        id: x.id,
        captureId: x.captureId,
        brand: brandName.get(x.brandId) ?? x.brandId,
        amountMinor: x.amountMinor,
        state: x.state,
        voidReason: x.voidReason,
        holdUntil: x.holdUntil,
        payoutBatchId: x.payoutBatchId,
        split: (byCapture.get(x.captureId) ?? []).map((s) => ({
          creatorId: s.creatorId,
          name: nameOf(s.creatorId),
          amountMinor: s.amountMinor,
        })),
      }),
    ),
  }));

  const journeys = raw.journeys.map((j): JourneyRow => {
    const price = j.items.reduce((a, i) => a + i.amountMinor, 0);
    const first = j.storesViewed[0];
    const hops =
      first && first !== j.storeChosen
        ? [
            {
              shop: first,
              priceMinor: j.priceSavedMinor === null ? null : price + j.priceSavedMinor,
            },
            { shop: j.storeChosen, priceMinor: price },
          ]
        : [{ shop: j.storeChosen, priceMinor: price }];
    return {
      orderId: j.orderId,
      model: j.model,
      arm: j.arm,
      product: j.items.map((i) => productOf.get(i.upc) ?? i.upc).join(", "),
      hops,
      storeChosen: j.storeChosen,
      priceMinor: price,
      priceSavedMinor: j.priceSavedMinor,
      commissionMinor: j.commission.pending + j.commission.paid,
      voidedMinor: j.commission.voided,
      holdStatus: j.holdStatus,
      holdUntil: j.holdUntil,
      shares: j.shapley.flatMap((s) => s.shares.map((x) => ({ ...x, name: nameOf(x.creatorId) }))),
      capturedAt: j.capturedAt,
    };
  });

  return { asOf: raw.now, brands, creators, journeys };
}

/** Reads the engine's /api over fetch (in-process inside pact-worker, HTTP standalone). */
export function createEngineReader(opts: {
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch | undefined;
}): () => Promise<RawEngine> {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  async function get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}/api${path}`, {
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      });
    } catch {
      throw new EngineUnavailable(`Engine not reachable at ${opts.baseUrl}`);
    }
    if (!res.ok) throw new EngineUnavailable(`Engine answered ${res.status} for /api${path}`);
    return (await res.json()) as T;
  }
  return async () => {
    const [clock, lift, deposits, credits, journeys, payouts, flags, whatIf] = await Promise.all([
      get<{ now: string }>("/clock"),
      get<{ brands: RawLift[] }>("/lift"),
      get<{ brands: RawDeposits[] }>("/deposits"),
      get<{ creators: RawCreator[] }>("/credits"),
      get<{ journeys: RawJourney[] }>("/journeys?limit=200"),
      get<{ batches: RawPayoutBatch[] }>("/payouts"),
      get<{ flags: RawReviewFlag[] }>("/review-flags"),
      // Only the what-if panel uses it, so an engine without it must not break the dashboards.
      get<RawWhatIf>("/what-if").catch(() => null),
    ]);
    return {
      now: clock.now,
      lift: lift.brands,
      deposits: deposits.brands,
      creators: credits.creators,
      journeys: journeys.journeys,
      payouts: payouts.batches,
      reviewFlags: flags.flags,
      whatIf,
    };
  };
}

/** Maya's approval: captures a top-up through the engine's approval endpoint. */
export function createEngineApprover(opts: {
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch | undefined;
}) {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  return async (a: { approvalId: string; brandId: string; amountMinor: number }) => {
    let res: Response;
    try {
      res = await f(`${base}/api/approvals/${encodeURIComponent(a.approvalId)}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
        body: JSON.stringify({ brandId: a.brandId, amountMinor: a.amountMinor }),
      });
    } catch {
      throw new EngineUnavailable(`Engine not reachable at ${opts.baseUrl}`);
    }
    if (!res.ok) throw new EngineUnavailable(`Engine answered ${res.status} for the approval`);
    return (await res.json()) as { id: string; status: string; amountMinor: number };
  };
}

/** The engine refused to start a programme (bad terms, or the product already has one). */
export class ProgrammeRejected extends Error {
  constructor(
    readonly status: 400 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface StartProgrammeInput {
  category: string;
  upc: string;
  depositMinor: number;
  commissionBps: number;
}

/** A brand's "Start a programme": creates the programme and captures its deposit in the engine. */
export function createEngineProgrammeStarter(opts: {
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch | undefined;
}) {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  return async (input: StartProgrammeInput) => {
    let res: Response;
    try {
      res = await f(`${base}/api/programmes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
        body: JSON.stringify(input),
      });
    } catch {
      throw new EngineUnavailable(`Engine not reachable at ${opts.baseUrl}`);
    }
    if (res.status === 400 || res.status === 409) {
      const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new ProgrammeRejected(
        res.status,
        b.error ?? "rejected",
        b.message ?? "The programme could not be started.",
      );
    }
    if (!res.ok) throw new EngineUnavailable(`Engine answered ${res.status} for the programme`);
    return (await res.json()) as {
      brand: { brandId: string; name: string; category: string; commissionBps: number };
      deposit: { status: string; amountMinor: number; captureId: string | null };
    };
  };
}

/** A reviewer's decision on a guard hold: release (paid at the next payout) or void the credit. */
export type ReviewAction = "release" | "void";

/** The engine said no (unknown flag, already decided, credit no longer pending). */
export class ReviewRejected extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Resolves a guard hold through the engine's review-flags write endpoints. */
export function createEngineReviewer(opts: {
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch | undefined;
}) {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  return async (id: string, action: ReviewAction) => {
    let res: Response;
    try {
      res = await f(`${base}/api/review-flags/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      });
    } catch {
      throw new EngineUnavailable(`Engine not reachable at ${opts.baseUrl}`);
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; flag?: RawReviewFlag };
    if (res.status === 404 || res.status === 409)
      throw new ReviewRejected(res.status, body.error ?? `engine answered ${res.status}`);
    if (!res.ok || !body.flag)
      throw new EngineUnavailable(`Engine answered ${res.status} for the review`);
    return body.flag;
  };
}

export class EngineUnavailable extends Error {}
