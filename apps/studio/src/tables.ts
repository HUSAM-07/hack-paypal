/**
 * The engine's read API reshaped into the flat tables AG Studio loads as data sources, so the
 * built-in widgets, the custom widgets and the AI agents all query the same rows.
 *
 * Every sum is done in integer cents; a table's money columns are divided by 100 only at the
 * end, because Studio formats and aggregates plain numbers (display values, never re-summed
 * into a payout). Pure, so every number on screen is testable without a browser.
 */
import type { ArmName, RawCredit, RawEngine, RawPayoutBatch, RawWhatIf } from "./dashboard";

export type { RawWhatIf };

/** Seeded demo runs use a stand-in model (`scripted-<family>`, `fake-<family>` in older data); say so plainly rather than show the id. */
export const agentLabel = (model: string): string =>
  /^(fake|scripted)-/.test(model) ? "Seeded demo agent" : model;

export type Scope = "first" | "todate";
export const SCOPES: Scope[] = ["first", "todate"];
export const SCOPE_LABEL: Record<Scope, string> = {
  first: "First payout",
  todate: "Programme to date",
};

type Row = Record<string, string | number | boolean | null>;

export interface StudioTables {
  asOf: string;
  /** A short fingerprint of the snapshot, so the client applies a transaction only on change. */
  version: string;
  /** The day-30 batch the "first payout" scope is anchored on; null before any payout. */
  firstBatch: { senderBatchId: string; createdAt: string; label: string } | null;
  tables: Record<TableId, Row[]>;
  /** The recorded sales the commission what-if re-prices in the browser; not a table. */
  whatIf: RawWhatIf | null;
}

export type TableId =
  | "brands"
  | "arms"
  | "creators"
  | "credits"
  | "journeys"
  | "shares"
  | "payouts"
  | "deposits"
  | "flags";

const usd = (minor: number) => Math.round(minor) / 100;
const HOLD_DAYS = 30;
const DAY = 86_400_000;
const ARM_LABEL: Record<ArmName, string> = {
  test: "Shown the test",
  placebo: "Same-creator placebo",
  none: "Held out",
};

/** Oldest first; batches made at the same demo instant keep the engine's order. */
export function orderedBatches(raw: RawEngine): RawPayoutBatch[] {
  return [...(raw.payouts ?? [])]
    .map((b, i) => ({ b, i }))
    .sort((x, y) =>
      x.b.createdAt < y.b.createdAt ? -1 : x.b.createdAt > y.b.createdAt ? 1 : x.i - y.i,
    )
    .map((x) => x.b);
}

function programmeStart(raw: RawEngine): string | null {
  const dates = raw.deposits
    .flatMap((d) => d.deposits.map((x) => x.createdAt))
    .filter((x): x is string => !!x)
    .sort();
  return dates[0] ?? null;
}

/** "Batch 1 · day 30": the day counts from the first deposit, on the engine's (demo) clock. */
export function batchLabels(raw: RawEngine): Map<string, string> {
  const start = programmeStart(raw);
  return new Map(
    orderedBatches(raw).flatMap((b, i) => {
      const day = start ? Math.round((Date.parse(b.createdAt) - Date.parse(start)) / DAY) : null;
      const label = `Batch ${i + 1}${day === null ? "" : ` · day ${day}`}`;
      return [
        [b.senderBatchId, label] as const,
        ...(b.paypalBatchId ? [[b.paypalBatchId, label] as const] : []),
      ];
    }),
  );
}

type CreditWithCreator = RawCredit & { creatorId: string };

/** A credit names its batch by PayPal's payout_batch_id; ours is the sender_batch_id. Accept both. */
const isBatch = (b: RawPayoutBatch, id: string) => id === b.paypalBatchId || id === b.senderBatchId;

/**
 * The first payout's cycle: the credits that batch paid, plus refund voids whose hold had
 * ended by the time it ran (they would have been in it). Later cycles' credits are excluded.
 */
export function inFirstPayout(x: CreditWithCreator, first: RawPayoutBatch | undefined): boolean {
  if (!first) return false;
  if (x.payoutBatchId) return isBatch(first, x.payoutBatchId);
  return (
    x.state === "voided" &&
    x.voidReason === "refund" &&
    x.holdUntil !== null &&
    x.holdUntil <= first.createdAt
  );
}

/** Why the abuse guard held a credit, in words. */
export const HOLD_LABEL: Record<string, string> = {
  self_purchase: "Self-purchase",
  repeat_buyer: "Repeat buyer",
  velocity: "Sales spike",
  refund_ring: "Refund ring",
  refund: "Refunded after payout",
  partial_refund: "Part-refunded after payout",
  dispute: "Disputed after payout",
};
const holdLabel = (r: string) => HOLD_LABEL[r] ?? r;

/** Pending splits three ways: held for review by the guard, frozen by a dispute, or on its 30-day hold. */
const isHeld = (x: RawCredit) => x.state === "pending" && !!x.held;
const isFrozen = (x: RawCredit) => x.state === "pending" && !x.held && !!x.frozen;
const isPending = (x: RawCredit) => x.state === "pending" && !x.held && !x.frozen;
const stateOf = (x: RawCredit) => (isHeld(x) ? "held" : isFrozen(x) ? "frozen" : x.state);

export function buildTables(raw: RawEngine): StudioTables {
  const batches = orderedBatches(raw);
  const first = batches[0];
  // The first payout's cycle: sales whose 30-day hold had ended when that batch ran. The arm
  // strip and the journeys table both scope "First payout" by it, so they agree with the tile.
  const firstCycleEnd = first ? Date.parse(first.createdAt) - HOLD_DAYS * DAY : null;
  const inFirstCycle = (j: { capturedAt: string }) =>
    firstCycleEnd !== null && Date.parse(j.capturedAt) <= firstCycleEnd;
  const labels = batchLabels(raw);
  const creatorName = new Map(raw.creators.map((c) => [c.creatorId, c.name]));
  const nameOf = (id: string) => creatorName.get(id) ?? id;
  const credits: CreditWithCreator[] = raw.creators.flatMap((c) =>
    c.credits.map((x) => ({ ...x, creatorId: c.creatorId })),
  );
  const byCapture = new Map<string, CreditWithCreator[]>();
  for (const x of credits) byCapture.set(x.captureId, [...(byCapture.get(x.captureId) ?? []), x]);
  const orderOfCapture = new Map<string, string>();
  for (const j of raw.journeys)
    for (const s of j.shapley) orderOfCapture.set(s.captureId, j.orderId);
  const productOf = new Map(raw.lift.map((b) => [b.upc, b.name]));
  const sum = (xs: CreditWithCreator[], f: (x: CreditWithCreator) => boolean) =>
    xs.filter(f).reduce((a, x) => a + x.amountMinor, 0);

  const brands: Row[] = [];
  const arms: Row[] = [];
  for (const b of raw.lift) {
    const mine = credits.filter((x) => x.brandId === b.brandId);
    const dep = raw.deposits.find((d) => d.brandId === b.brandId);
    const initial = dep?.deposits.filter((d) => d.kind === "initial") ?? [];
    const initialMinor = initial.reduce((a, d) => a + d.amountMinor, 0);
    for (const scope of SCOPES) {
      const xs = scope === "todate" ? mine : mine.filter((x) => inFirstPayout(x, first));
      const captures = new Set(xs.map((x) => x.captureId));
      const paid = sum(xs, (x) => x.state === "paid");
      // The first payout is funded by the initial deposit alone; top-ups come after it.
      const deposit =
        scope === "todate"
          ? {
              deposited: dep?.deposited ?? 0,
              initial: initialMinor,
              topUps: (dep?.deposited ?? 0) - initialMinor,
              spent: dep?.spent ?? 0,
              reserved: dep?.reserved ?? 0,
              returned: dep?.returned ?? 0,
              available: dep?.available ?? 0,
            }
          : {
              deposited: initialMinor,
              initial: initialMinor,
              topUps: 0,
              spent: paid,
              reserved: 0,
              returned: initial.reduce((a, d) => a + d.returnedMinor, 0),
              available: Math.max(
                0,
                initialMinor - paid - initial.reduce((a, d) => a + d.returnedMinor, 0),
              ),
            };
      // The first cycle's exposed sales: those whose 30-day hold had ended when the first batch ran.
      const cycleEnd = first ? Date.parse(first.createdAt) - HOLD_DAYS * DAY : 0;
      const exposedFirst = first
        ? raw.journeys.filter(
            (j) =>
              j.arm === "test" &&
              Date.parse(j.capturedAt) <= cycleEnd &&
              j.items.some((i) => i.upc === b.upc),
          ).length
        : 0;
      brands.push({
        id: `${b.brandId}:${scope}`,
        brandId: b.brandId,
        brand: b.name,
        category: b.category,
        scope: SCOPE_LABEL[scope],
        scopeKey: scope,
        exposedSales: scope === "todate" ? b.exposedSales : exposedFirst,
        // To date: the engine's verdict. First payout: the sales that batch's cycle credited.
        causedUnits: scope === "todate" ? b.causedUnits : captures.size,
        lift: scope === "todate" ? b.lift : null,
        lowerBound: scope === "todate" ? b.lowerBound : null,
        attributableFraction: scope === "todate" ? b.attributableFraction : null,
        credited: usd(sum(xs, () => true)),
        pending: usd(sum(xs, isPending)),
        frozen: usd(sum(xs, isFrozen)),
        held: usd(sum(xs, isHeld)),
        voided: usd(sum(xs, (x) => x.state === "voided")),
        paid: usd(paid),
        deposited: usd(deposit.deposited),
        initialDeposit: usd(deposit.initial),
        topUps: usd(deposit.topUps),
        spent: usd(deposit.spent),
        reserved: usd(deposit.reserved),
        returned: usd(deposit.returned),
        available: usd(deposit.available),
      });
    }
    // The first payout's arms count only the sessions whose hold had ended when that batch ran,
    // so the strip agrees with the "+51 of 57" tile beside it. Journeys are purchases, so this
    // counts buying sessions; in the forced-buy demo every session buys.
    const firstJourneys = raw.journeys.filter(inFirstCycle);
    for (const scope of SCOPES) {
      for (const arm of ["test", "placebo", "none"] as const) {
        const inArm = firstJourneys.filter((j) => j.arm === arm);
        const a =
          scope === "todate"
            ? (b.arms[arm] ?? { sessions: 0, purchases: 0 })
            : {
                sessions: inArm.length,
                purchases: inArm.filter((j) => j.items.some((i) => i.upc === b.upc)).length,
              };
        arms.push({
          id: `${b.brandId}:${arm}:${scope}`,
          brandId: b.brandId,
          brand: b.name,
          scope: SCOPE_LABEL[scope],
          scopeKey: scope,
          armKey: arm,
          arm: ARM_LABEL[arm],
          sessions: a.sessions,
          purchases: a.purchases,
          share: a.sessions > 0 ? a.purchases / a.sessions : 0,
        });
      }
    }
  }

  const creditRows: Row[] = credits.map((x) => {
    const others = (byCapture.get(x.captureId) ?? []).filter((s) => s.creatorId !== x.creatorId);
    return {
      id: x.id,
      creatorId: x.creatorId,
      creator: nameOf(x.creatorId),
      brand: raw.lift.find((b) => b.brandId === x.brandId)?.name ?? x.brandId,
      captureId: x.captureId,
      orderId: orderOfCapture.get(x.captureId) ?? null,
      amount: usd(x.amountMinor),
      state: stateOf(x),
      // Text cells read "–" rather than blank: a grid shows a null as "(Blanks)".
      voidReason: x.voidReason ?? "–",
      holdReason: isHeld(x) ? (x.holdReasons ?? []).map(holdLabel).join(", ") || "–" : "–",
      holdUntil: x.holdUntil ? x.holdUntil.slice(0, 10) : null,
      payoutBatch: x.payoutBatchId
        ? (labels.get(x.payoutBatchId) ?? x.payoutBatchId)
        : x.state === "voided"
          ? "–"
          : "Not paid yet",
      firstPayout: inFirstPayout(x, first),
      coExposed: others.length > 0,
      splitWith:
        others.map((s) => `${nameOf(s.creatorId)} $${usd(s.amountMinor).toFixed(2)}`).join(", ") ||
        "–",
    };
  });

  const creators: Row[] = raw.creators.map((c) => {
    const xs = credits.filter((x) => x.creatorId === c.creatorId);
    return {
      id: c.creatorId,
      creatorId: c.creatorId,
      creator: c.name,
      pending: usd(sum(xs, isPending)),
      frozen: usd(sum(xs, isFrozen)),
      held: usd(sum(xs, isHeld)),
      voided: usd(sum(xs, (x) => x.state === "voided")),
      paid: usd(sum(xs, (x) => x.state === "paid")),
      credits: xs.length,
      voidedCount: xs.filter((x) => x.state === "voided").length,
      frozenCount: xs.filter(isFrozen).length,
      heldCount: xs.filter(isHeld).length,
      heldReasons:
        [...new Set(xs.filter(isHeld).flatMap((x) => x.holdReasons ?? []))]
          .map(holdLabel)
          .join(", ") || "–",
      coExposed: xs.filter((x) => (byCapture.get(x.captureId)?.length ?? 0) > 1).length,
      firstPayout: usd(
        first?.items
          .filter((i) => i.creatorId === c.creatorId)
          .reduce((a, i) => a + i.amountMinor, 0) ?? 0,
      ),
    };
  });

  const journeys: Row[] = raw.journeys.map((j) => {
    const price = j.items.reduce((a, i) => a + i.amountMinor, 0);
    const firstStore = j.storesViewed[0] ?? j.storeChosen;
    const caps = new Set(j.shapley.map((s) => s.captureId));
    const creatorsSeen = [
      ...new Set(j.shapley.flatMap((s) => s.shares.map((x) => nameOf(x.creatorId)))),
    ];
    return {
      id: j.orderId,
      orderId: j.orderId,
      model: agentLabel(j.model),
      arm: ARM_LABEL[j.arm as ArmName] ?? j.arm,
      product: j.items.map((i) => productOf.get(i.upc) ?? i.upc).join(", "),
      firstStore,
      firstPrice:
        firstStore !== j.storeChosen && j.priceSavedMinor !== null
          ? usd(price + j.priceSavedMinor)
          : usd(price),
      storeChosen: j.storeChosen,
      price: usd(price),
      saved: j.priceSavedMinor === null ? null : usd(j.priceSavedMinor),
      commission: usd(j.commission.pending + j.commission.paid),
      voided: usd(j.commission.voided),
      holdStatus: j.holdStatus,
      holdUntil: j.holdUntil ? j.holdUntil.slice(0, 10) : null,
      creators: creatorsSeen.join(" + ") || null,
      coExposed: creatorsSeen.length > 1,
      captures: caps.size,
      capturedAt: j.capturedAt,
      firstPayout: inFirstCycle(j),
    };
  });

  const shares: Row[] = raw.journeys.flatMap((j) =>
    j.shapley.flatMap((s) =>
      s.shares.map((x) => {
        const credit = (byCapture.get(s.captureId) ?? []).find((c) => c.creatorId === x.creatorId);
        return {
          id: `${s.captureId}:${x.creatorId}`,
          orderId: j.orderId,
          captureId: s.captureId,
          creatorId: x.creatorId,
          creator: nameOf(x.creatorId),
          amount: usd(x.amountMinor),
          state: credit ? stateOf(credit) : x.state,
          payoutBatch: credit?.payoutBatchId
            ? (labels.get(credit.payoutBatchId) ?? credit.payoutBatchId)
            : null,
          splitOf: s.shares.length,
        };
      }),
    ),
  );

  const payouts: Row[] = batches.flatMap((b, i) =>
    b.items.map((it) => ({
      id: `${b.senderBatchId}:${it.creatorId}`,
      batch: labels.get(b.senderBatchId) ?? b.senderBatchId,
      batchIndex: i + 1,
      senderBatchId: b.senderBatchId,
      creatorId: it.creatorId,
      creator: nameOf(it.creatorId),
      amount: usd(it.amountMinor),
      credits: it.creditIds.length,
      status: b.status,
      createdAt: b.createdAt,
    })),
  );

  const deposits: Row[] = raw.deposits.flatMap((d) =>
    d.deposits.map((x) => ({
      id: x.id,
      brandId: d.brandId,
      brand: d.name,
      kind: x.kind,
      amount: usd(x.amountMinor),
      returned: usd(x.returnedMinor),
      status: x.status ?? null,
      createdAt: x.createdAt ?? null,
    })),
  );

  const brandOf = new Map(raw.lift.map((b) => [b.brandId, b.name]));
  const flags: Row[] = (raw.reviewFlags ?? []).map((f) => ({
    id: f.id,
    creditId: f.creditId,
    creatorId: f.credit?.creatorId ?? null,
    creator: f.credit ? nameOf(f.credit.creatorId) : "–",
    brand: f.credit ? (brandOf.get(f.credit.brandId) ?? f.credit.brandId) : "–",
    captureId: f.captureId,
    orderId: orderOfCapture.get(f.captureId) ?? null,
    amount: usd(f.credit?.amountMinor ?? 0),
    kind: f.hold ? "Held for review" : "Note on a paid credit",
    hold: f.hold,
    reason: holdLabel(f.reason),
    detail: f.detail ?? "–",
    status: f.hold
      ? f.status === "open"
        ? "Waiting for a reviewer"
        : f.status === "released"
          ? "Released"
          : "Voided"
      : f.status,
    creditState: f.credit?.state ?? "–",
    createdAt: f.createdAt ?? null,
  }));

  const tables: Record<TableId, Row[]> = {
    brands,
    arms,
    creators,
    credits: creditRows,
    journeys,
    shares,
    payouts,
    deposits,
    flags,
  };
  return {
    asOf: raw.now,
    version: fingerprint(JSON.stringify(tables)),
    whatIf: raw.whatIf ?? null,
    firstBatch: first
      ? {
          senderBatchId: first.senderBatchId,
          createdAt: first.createdAt,
          label: labels.get(first.senderBatchId) ?? first.senderBatchId,
        }
      : null,
    tables,
  };
}

/** FNV-1a, enough to notice a changed snapshot. */
function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Field metadata Studio and its agents read: names and descriptions are prompt text too. */
export type FieldFormat =
  | "textFormat"
  | "integerFormat"
  | "decimalFormat"
  | "currencyFormat"
  | "percentageFormat"
  | "booleanFormat";

export interface TableMeta {
  id: TableId;
  name: string;
  description: string;
  fields: { id: string; name: string; format: FieldFormat; description?: string; hide?: boolean }[];
}

const t = (id: string, name: string, description?: string) =>
  ({ id, name, format: "textFormat", ...(description ? { description } : {}) }) as const;
const n = (id: string, name: string, description?: string) =>
  ({ id, name, format: "integerFormat", ...(description ? { description } : {}) }) as const;
const m = (id: string, name: string, description?: string) =>
  ({ id, name, format: "currencyFormat", ...(description ? { description } : {}) }) as const;
const p = (id: string, name: string, description?: string) =>
  ({ id, name, format: "percentageFormat", ...(description ? { description } : {}) }) as const;
const b = (id: string, name: string, description?: string) =>
  ({ id, name, format: "booleanFormat", ...(description ? { description } : {}) }) as const;

export const TABLES: TableMeta[] = [
  {
    id: "brands",
    name: "Brand programme",
    description:
      "One row per brand per scope. Scope 'Programme to date' is the engine's current verdict; 'First payout' is the day-30 cycle only. Filter on scope before summing: the two scopes overlap.",
    fields: [
      t("id", "Row id"),
      t("brandId", "Brand id"),
      t("brand", "Brand"),
      t("category", "Category"),
      t("scope", "Scope", "First payout (day-30 cycle) or Programme to date."),
      t("scopeKey", "Scope key"),
      n("exposedSales", "Exposed sales", "Sales by agents shown the creator's test."),
      n(
        "causedUnits",
        "Caused units",
        "Sales the test caused, credited at the 80% lower bound of lift.",
      ),
      p("lift", "Lift", "Exposed purchase rate minus placebo rate."),
      p("lowerBound", "Lift lower bound (80%)"),
      p("attributableFraction", "Attributable fraction"),
      m("credited", "Credited"),
      m("pending", "Pending (30-day hold)"),
      m("frozen", "Frozen by a dispute"),
      m(
        "held",
        "Held for review",
        "Pending credits the abuse guard holds (e.g. a creator buying through their own PayPal). Never paid until a reviewer releases them.",
      ),
      m("voided", "Voided"),
      m("paid", "Paid"),
      m("deposited", "Deposited"),
      m("initialDeposit", "Initial deposit"),
      m("topUps", "Top-ups"),
      m("spent", "Spent on payouts"),
      m("reserved", "Reserved"),
      m("returned", "Returned to the brand"),
      m("available", "Deposit left"),
    ],
  },
  {
    id: "arms",
    name: "Arms",
    description:
      "Agent sessions per brand per group: shown the test, a same-creator placebo, or held out. Ranking was identical in every group. One row per scope: the first payout's cycle, or the programme to date.",
    fields: [
      t("id", "Row id"),
      t("brandId", "Brand id"),
      t("brand", "Brand"),
      t("scope", "Scope"),
      t("scopeKey", "Scope key"),
      t("armKey", "Arm key"),
      t("arm", "Group"),
      n("sessions", "Sessions"),
      n("purchases", "Purchases of this brand"),
      p("share", "Share of sessions buying this brand"),
    ],
  },
  {
    id: "creators",
    name: "Creators",
    description: "Each creator's credits by state, to date.",
    fields: [
      t("id", "Row id"),
      t("creatorId", "Creator id"),
      t("creator", "Creator"),
      m("pending", "Pending (30-day hold)"),
      m("frozen", "Frozen by a dispute"),
      m("held", "Held for review", "Held by the abuse guard; never paid automatically."),
      m("voided", "Voided"),
      m("paid", "Paid"),
      n("credits", "Credits"),
      n("voidedCount", "Voided credits"),
      n("frozenCount", "Frozen credits"),
      n("heldCount", "Credits held for review"),
      t("heldReasons", "Why they are held"),
      n("coExposed", "Co-exposed credits"),
      m("firstPayout", "Paid in the first payout"),
    ],
  },
  {
    id: "credits",
    name: "Credits",
    description:
      "One row per creator per credited sale. State is pending, held (for review by the abuse guard), frozen, voided or paid; void reason is refund, dispute or review.",
    fields: [
      t("id", "Credit id"),
      t("creatorId", "Creator id"),
      t("creator", "Creator"),
      t("brand", "Brand"),
      t("captureId", "PayPal capture"),
      t("orderId", "PayPal order"),
      m("amount", "Amount"),
      t("state", "State"),
      t("voidReason", "Void reason"),
      t("holdReason", "Held for review because"),
      t("holdUntil", "Hold ends"),
      t("payoutBatch", "Payout batch"),
      b("firstPayout", "In the first payout"),
      b("coExposed", "Co-exposed"),
      t("splitWith", "Shapley split with"),
    ],
  },
  {
    id: "journeys",
    name: "Agent journeys",
    description:
      "One row per PayPal order an agent placed: the store it read first, the store it paid, and the commission.",
    fields: [
      t("id", "Row id"),
      t("orderId", "PayPal order"),
      t("model", "Agent model"),
      t("arm", "Group"),
      t("product", "Product"),
      t("firstStore", "Store read first"),
      m("firstPrice", "Price there"),
      t("storeChosen", "Store paid"),
      m("price", "Price paid"),
      m("saved", "Saved"),
      m("commission", "Commission"),
      m("voided", "Voided commission"),
      t("holdStatus", "Hold status"),
      t("holdUntil", "Hold ends"),
      t("creators", "Creators read"),
      b("coExposed", "Co-exposed"),
      n("captures", "Captures"),
      t("capturedAt", "Captured at"),
      b("firstPayout", "In the first payout's cycle"),
    ],
  },
  {
    id: "shares",
    name: "Shapley shares",
    description: "Each creator's Shapley share of each credited sale.",
    fields: [
      t("id", "Row id"),
      t("orderId", "PayPal order"),
      t("captureId", "PayPal capture"),
      t("creatorId", "Creator id"),
      t("creator", "Creator"),
      m("amount", "Share"),
      t("state", "State"),
      t("payoutBatch", "Payout batch"),
      n("splitOf", "Creators sharing the sale"),
    ],
  },
  {
    id: "payouts",
    name: "Payouts",
    description: "PayPal Payouts batch items, one per creator per batch, oldest batch first.",
    fields: [
      t("id", "Row id"),
      t("batch", "Batch"),
      n("batchIndex", "Batch number"),
      t("senderBatchId", "sender_batch_id"),
      t("creatorId", "Creator id"),
      t("creator", "Creator"),
      m("amount", "Amount"),
      n("credits", "Credits paid"),
      t("status", "Status"),
      t("createdAt", "Created at"),
    ],
  },
  {
    id: "deposits",
    name: "Deposits",
    description: "Brand deposits into the programme: the initial deposit and approved top-ups.",
    fields: [
      t("id", "Deposit id"),
      t("brandId", "Brand id"),
      t("brand", "Brand"),
      t("kind", "Kind"),
      m("amount", "Amount"),
      m("returned", "Returned"),
      t("status", "Status"),
      t("createdAt", "Created at"),
    ],
  },
  {
    id: "flags",
    name: "Review flags",
    description:
      "Credits a person must look at. 'Held for review': the abuse guard held a pending credit (self-purchase, repeat buyer, sales spike, refund ring); it is never paid until a reviewer releases it, and voided if they void it. 'Note on a paid credit': the sale was refunded or disputed after the payout.",
    fields: [
      t("id", "Flag id"),
      t("creditId", "Credit id"),
      t("creatorId", "Creator id"),
      t("creator", "Creator"),
      t("brand", "Brand"),
      t("captureId", "PayPal capture"),
      t("orderId", "PayPal order"),
      m("amount", "Credit"),
      t("kind", "Kind"),
      b("hold", "Held for review"),
      t("reason", "Reason"),
      t("detail", "Detail"),
      t("status", "Status"),
      t("creditState", "Credit state"),
      t("createdAt", "Flagged at"),
    ],
  },
];
