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
  deposits: { id: string; kind: string; amountMinor: number; returnedMinor: number }[];
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
}

export interface RawCreator {
  creatorId: string;
  name: string;
  totals: { pending: number; voided: number; paid: number };
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

export interface RawEngine {
  now: string;
  lift: RawLift[];
  deposits: RawDeposits[];
  creators: RawCreator[];
  journeys: RawJourney[];
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
    const [clock, lift, deposits, credits, journeys] = await Promise.all([
      get<{ now: string }>("/clock"),
      get<{ brands: RawLift[] }>("/lift"),
      get<{ brands: RawDeposits[] }>("/deposits"),
      get<{ creators: RawCreator[] }>("/credits"),
      get<{ journeys: RawJourney[] }>("/journeys?limit=200"),
    ]);
    return {
      now: clock.now,
      lift: lift.brands,
      deposits: deposits.brands,
      creators: credits.creators,
      journeys: journeys.journeys,
    };
  };
}

export class EngineUnavailable extends Error {}
