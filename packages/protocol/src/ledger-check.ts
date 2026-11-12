/**
 * The ledger-vs-PayPal reconciliation checks, as pure functions over the engine's public read
 * API. The one-command demo (apps/agents/src/demo.ts) uses the small helpers at the top for its
 * own checks; the public /console/ledger page runs `ledgerChecks` on the live engine.
 * Money is integer minor units throughout.
 */

// biome-ignore lint/suspicious/noExplicitAny: loosely-typed JSON from the read API
type Json = Record<string, any>;

export const formatUsd = (minor: number): string =>
  `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** An amount in a payout item, whether the engine's (`amountMinor`) or PayPal mock's (`amount.amountMinor`). */
const itemMinor = (i: Json): number => i.amountMinor ?? i.amount?.amountMinor ?? 0;
const itemsOf = (b: Json): Json[] => (b.items as Json[] | undefined) ?? [];

/** What the ledger says it paid creators (`GET /credits`). */
export const paidInLedger = (creators: Json[]): number =>
  creators.reduce((a, c) => a + (c.totals?.paid ?? 0), 0);

/** The total of every item in a list of payout batches, engine's or PayPal's. */
export const batchesTotal = (batches: Json[]): number =>
  batches.reduce((a, b) => a + itemsOf(b).reduce((x, i) => x + itemMinor(i), 0), 0);

/** Deposit = paid + returned + reserved + still available. */
export const brandAddsUp = (b: Json): boolean =>
  b.spent + b.returned + b.reserved + b.available === b.deposited;

/** Paid credits that carry no payout batch id (there should be none). */
export const paidWithoutBatch = (credits: Json[]): Json[] =>
  credits.filter((c) => c.state === "paid" && !c.payoutBatchId);

export type CheckStatus = "pass" | "fail" | "skip";

export interface LedgerCheck {
  id: string;
  status: CheckStatus;
  /** The claim, in plain words. */
  title: string;
  /** One line on what it proves, or why it did not run. */
  plain: string;
  /** The two numbers compared; absent for a skipped check. */
  left?: { label: string; value: string } | undefined;
  right?: { label: string; value: string } | undefined;
}

/** Everything the checks read: each field is one public read of the engine. */
export interface LedgerSnapshot {
  deposits: Json;
  credits: Json;
  payouts: Json;
  invoices?: Json | undefined;
  journeys?: Json | undefined;
  /** The simulated PayPal's own record (`GET /mock/state`); absent or empty when it holds nothing. */
  mock?: Json | null | undefined;
  /** How many sales one journeys read can return at most. */
  journeysLimit?: number | undefined;
}

export interface LedgerReport {
  checks: LedgerCheck[];
  /** Checks the demo runs that this page does not, with the reason. */
  notRun: { title: string; reason: string }[];
  counts: { pass: number; fail: number; skip: number };
}

const pass = (
  id: string,
  title: string,
  plain: string,
  left: { label: string; value: string },
  right: { label: string; value: string },
  ok: boolean,
): LedgerCheck => ({ id, status: ok ? "pass" : "fail", title, plain, left, right });

const skip = (id: string, title: string, plain: string): LedgerCheck => ({
  id,
  status: "skip",
  title,
  plain,
});

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

export function ledgerChecks(s: LedgerSnapshot): LedgerReport {
  const out: LedgerCheck[] = [];
  const creators = (s.credits?.creators ?? []) as Json[];
  const credits = creators.flatMap((c) => (c.credits ?? []) as Json[]);
  const batches = (s.payouts?.batches ?? []) as Json[];
  const brands = (s.deposits?.brands ?? []) as Json[];
  const byPaypalBatch = new Map<string, Json>(
    batches.filter((b) => b.paypalBatchId).map((b) => [b.paypalBatchId as string, b]),
  );
  const batchedCreditIds = new Set(
    batches.flatMap((b) => itemsOf(b).flatMap((i) => i.creditIds ?? [])),
  );
  const paid = credits.filter((c) => c.state === "paid");

  // 1. Sales: every credited sale is one the engine recorded.
  if (s.journeys) {
    const limit = s.journeysLimit ?? 200;
    const journeys = (s.journeys.journeys ?? []) as Json[];
    const recorded = new Set(
      journeys.flatMap((j) => ((j.shapley ?? []) as Json[]).map((x) => x.captureId as string)),
    );
    const sold = new Set(credits.map((c) => c.captureId as string));
    const found = [...sold].filter((id) => recorded.has(id)).length;
    out.push(
      journeys.length >= limit
        ? skip(
            "sales-recorded",
            "Every credited sale was recorded by the engine",
            `Not run: there are ${limit} or more sales, more than one read of the engine returns.`,
          )
        : pass(
            "sales-recorded",
            "Every credited sale was recorded by the engine",
            "Each credit points to a PayPal sale that reached the engine as a signed capture event.",
            { label: "Sales with a credit", value: String(sold.size) },
            { label: "Found among recorded sales", value: String(found) },
            found === sold.size,
          ),
    );
  }

  // 2. Every paid credit carries a payout batch that exists.
  const withBatch = paid.filter((c) => c.payoutBatchId && byPaypalBatch.has(c.payoutBatchId));
  out.push(
    pass(
      "paid-have-batch",
      "Every paid credit carries a payout batch",
      "A credit is only ever marked paid together with the PayPal payout batch that paid it.",
      { label: "Credits marked paid", value: String(paid.length) },
      { label: "With a PayPal batch", value: String(withBatch.length) },
      paid.length === withBatch.length,
    ),
  );

  // 3. Ledger paid equals the PayPal payout batches.
  const ledgerPaid = paidInLedger(creators);
  const batchTotal = batchesTotal(batches);
  out.push(
    pass(
      "paid-equals-batches",
      "The ledger's paid total equals the PayPal payout batches",
      "What CITED says it paid creators is exactly what PayPal's payout batches sent, to the cent.",
      { label: "Ledger paid", value: formatUsd(ledgerPaid) },
      { label: `PayPal, ${n(batches.length, "batch", "batches")}`, value: formatUsd(batchTotal) },
      ledgerPaid === batchTotal,
    ),
  );

  // 4. PayPal reports every batch as paid.
  const succeeded = batches.filter((b) => b.status === "SUCCESS").length;
  out.push(
    pass(
      "batches-succeeded",
      "PayPal reports every payout batch as successful",
      "No batch is pending, failed or returned: each one finished at PayPal.",
      { label: "Batches", value: String(batches.length) },
      { label: "Reported SUCCESS", value: String(succeeded) },
      batches.length === succeeded,
    ),
  );

  // 5. Per creator: ledger paid equals the payout items addressed to that creator.
  for (const c of creators) {
    const items = batches.flatMap(itemsOf).filter((i) => i.creatorId === c.creatorId);
    const inBatches = items.reduce((a, i) => a + itemMinor(i), 0);
    const ledger = c.totals?.paid ?? 0;
    if (ledger === 0 && items.length === 0) continue;
    out.push(
      pass(
        `creator-${c.creatorId}`,
        `${c.name}: paid in the ledger equals what PayPal sent`,
        "Counted from the payout items addressed to this creator's PayPal account.",
        { label: "Ledger paid", value: formatUsd(ledger) },
        { label: "PayPal payout items", value: formatUsd(inBatches) },
        ledger === inBatches,
      ),
    );
  }

  // 6. Each payout item equals the credits inside it.
  const creditById = new Map<string, Json>(credits.map((c) => [c.id as string, c]));
  const items = batches.flatMap(itemsOf);
  const itemsOk = items.filter(
    (i) =>
      ((i.creditIds ?? []) as string[]).reduce(
        (a, id) => a + (creditById.get(id)?.amountMinor ?? Number.NaN),
        0,
      ) === itemMinor(i),
  ).length;
  out.push(
    pass(
      "items-equal-credits",
      "Every payout item equals the credits inside it",
      "Each payment to a creator is the sum of the individual credits it settles, nothing more.",
      { label: "Payout items", value: String(items.length) },
      { label: "Matching their credits", value: String(itemsOk) },
      items.length === itemsOk,
    ),
  );

  // 7. Per brand: deposit = paid + returned + reserved + available.
  for (const b of brands) {
    out.push(
      pass(
        `brand-${b.brandId}`,
        `${b.name}: the deposit is fully accounted for`,
        "Deposit = paid to creators + handed back + set aside for pending credits + still available.",
        { label: "Deposited", value: formatUsd(b.deposited) },
        {
          label: `${formatUsd(b.spent)} + ${formatUsd(b.returned)} + ${formatUsd(b.reserved)} + ${formatUsd(b.available)}`,
          value: formatUsd(b.spent + b.returned + b.reserved + b.available),
        },
        brandAddsUp(b),
      ),
    );
  }

  // 8. Per brand: the deposit captures and refunds the engine recorded add up.
  for (const b of brands) {
    const captured = ((b.deposits ?? []) as Json[])
      .filter((d) => d.status === "captured")
      .reduce((a, d) => a + d.amountMinor, 0);
    const refunded = ((b.refunds ?? []) as Json[]).reduce((a, r) => a + r.amountMinor, 0);
    out.push(
      pass(
        `brand-money-${b.brandId}`,
        `${b.name}: deposits and refunds match the PayPal records`,
        "The deposit total is the sum of its PayPal captures; the money handed back is the sum of its PayPal refunds.",
        {
          label: "Deposited / returned",
          value: `${formatUsd(b.deposited)} / ${formatUsd(b.returned)}`,
        },
        {
          label: "PayPal captures / refunds",
          value: `${formatUsd(captured)} / ${formatUsd(refunded)}`,
        },
        captured === b.deposited && refunded === b.returned,
      ),
    );
  }

  // 9. A brand whose test caused nothing pays $0 and gets the deposit back.
  const levoit = brands.find((b) => b.brandId === "levoit");
  out.push(
    levoit
      ? pass(
          "levoit-zero",
          "Levoit pays $0 and gets its whole deposit back",
          "Its test caused no sales, so it owes nothing: the deposit goes back through a PayPal refund.",
          { label: "Paid to creators", value: formatUsd(levoit.spent) },
          {
            label: "Returned of deposit",
            value: `${formatUsd(levoit.returned)} of ${formatUsd(levoit.deposited)}`,
          },
          levoit.spent === 0 && levoit.returned === levoit.deposited,
        )
      : skip(
          "levoit-zero",
          "Levoit pays $0 and gets its whole deposit back",
          "Not run: this ledger has no Levoit programme.",
        ),
  );

  // 10. No credit paid inside its 30-day hold.
  const early = paid.filter((c) => {
    const batch = byPaypalBatch.get(c.payoutBatchId);
    return !!batch && !!c.holdUntil && Date.parse(batch.createdAt) < Date.parse(c.holdUntil);
  });
  out.push(
    pass(
      "no-pay-in-hold",
      "No credit was paid inside its 30-day hold",
      "Each payout batch was created on or after the day the credit's hold ended.",
      { label: "Credits marked paid", value: String(paid.length) },
      { label: "Paid before the hold ended", value: String(early.length) },
      early.length === 0,
    ),
  );

  // 11. Voided, held and frozen credits are in no batch.
  const stuck = credits.filter((c) => c.state === "voided" || c.held || c.frozen);
  const leaked = stuck.filter((c) => c.payoutBatchId || batchedCreditIds.has(c.id));
  out.push(
    pass(
      "withheld-not-paid",
      "Voided, held and frozen credits are in no payout batch",
      "A refunded sale, a sale held for review and a sale under dispute are never paid.",
      { label: "Withheld credits", value: String(stuck.length) },
      { label: "Found in a payout batch", value: String(leaked.length) },
      leaked.length === 0,
    ),
  );

  // 12. Brand statements agree with the payout batches and refunds they cite. A statement is
  // written at cycle close, so it is compared with what it cites, not with today's totals.
  const stmts = (s.invoices?.statements ?? []) as Json[];
  for (const x of stmts) {
    const b = brands.find((y) => y.brandId === x.brandId);
    if (!b) continue;
    const cited = new Set((x.payoutBatchIds ?? []) as string[]);
    const creditIds = new Set((x.creditIds ?? []) as string[]);
    const paidCited = credits
      .filter((c) => creditIds.has(c.id) && c.state === "paid" && cited.has(c.payoutBatchId))
      .reduce((a, c) => a + c.amountMinor, 0);
    const refundIds = new Set((x.refundIds ?? []) as string[]);
    const refundedCited = ((b.refunds ?? []) as Json[])
      .filter((r) => refundIds.has(r.refundId))
      .reduce((a, r) => a + r.amountMinor, 0);
    const invoiced = x.invoiceId
      ? x.invoiceTotalMinor === x.paidMinor && x.invoiceDueMinor === 0
      : x.paidMinor === 0;
    const ok =
      x.creditedMinor - x.voidedMinor === x.paidMinor &&
      x.paidMinor === paidCited &&
      x.returnedMinor === refundedCited &&
      invoiced;
    out.push(
      pass(
        `statement-${x.brandId}`,
        `${b.name}: the PayPal statement matches the payouts and refunds it cites`,
        x.invoiceId
          ? "The invoice total is what the cited payout batches paid, and nothing is due because it is settled from the deposit."
          : "Nothing was paid out, so there is no invoice: the statement just shows the deposit coming back.",
        {
          label: "Statement paid / returned",
          value: `${formatUsd(x.paidMinor)} / ${formatUsd(x.returnedMinor)}`,
        },
        {
          label: "Cited batches / refunds",
          value: `${formatUsd(paidCited)} / ${formatUsd(refundedCited)}`,
        },
        ok,
      ),
    );
  }

  // Against the simulated PayPal's own record: only while it holds something.
  const mock = s.mock;
  const mockHolds = !!mock && ((mock.batches?.length ?? 0) > 0 || (mock.captures?.length ?? 0) > 0);
  if (mockHolds && mock) {
    const mockBatches = (mock.batches ?? []) as Json[];
    const mockTotal = batchesTotal(mockBatches);
    out.push(
      pass(
        "mock-batches",
        "The ledger's paid total equals PayPal's own batch record",
        "Compared with the simulated PayPal's record of the batches it received, not the engine's copy.",
        { label: "Ledger paid", value: formatUsd(ledgerPaid) },
        {
          label: `PayPal, ${n(mockBatches.length, "batch", "batches")}`,
          value: formatUsd(mockTotal),
        },
        ledgerPaid === mockTotal && mockBatches.length === batches.length,
      ),
    );
    const captures = new Map<string, Json>(((mock.captures ?? []) as Json[]).map((c) => [c.id, c]));
    for (const b of brands) {
      const funded = ((b.deposits ?? []) as Json[]).filter((d) => d.status === "captured");
      const inMock = funded.reduce(
        (a, d) => a + (captures.get(d.captureId)?.amount?.amountMinor ?? 0),
        0,
      );
      out.push(
        pass(
          `mock-deposit-${b.brandId}`,
          `${b.name}: the deposit equals PayPal's own capture record`,
          "Compared with the simulated PayPal's record of the deposit it took.",
          { label: "Deposited", value: formatUsd(b.deposited) },
          { label: "PayPal captured", value: formatUsd(inMock) },
          inMock === b.deposited,
        ),
      );
    }
  }

  const notRun: LedgerReport["notRun"] = [
    {
      title: "Every PayPal sale capture reached the engine through a webhook",
      reason:
        "Needs the simulated PayPal's own list of sales, which is empty after a restart. The first check above covers the engine's side instead.",
    },
    {
      title:
        "One seller refund voids exactly one credit; a dispute freezes, then releases or voids",
      reason:
        "Needs a refund or dispute made on purpose during a run. The demo command checks it; live data may have none.",
    },
    {
      title: "The numbers match the card (57 sales, 51 caused, $391.64)",
      reason:
        "Those are fixed numbers of the recorded study, not a property of whatever is in the live ledger.",
    },
  ];
  if (!mockHolds)
    notRun.unshift({
      title: "The ledger against PayPal's own record of captures and payout batches",
      reason:
        "The simulated PayPal keeps its record in memory, and it holds nothing right now (it starts empty when the demo restarts). The checks above use the PayPal ids and statuses the engine stored.",
    });

  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const c of out) counts[c.status] += 1;
  return { checks: out, notRun, counts };
}
