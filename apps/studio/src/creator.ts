/**
 * The Creator Analyst's figures, computed from the same Studio tables the creator's dashboard
 * shows (credits, shares, payouts, trust, brands). Read-only: this module only reads and
 * explains. The AG Studio agent in apps/web reaches it through one read tool; nothing here can
 * approve, release, void or pay anything.
 *
 * Every figure comes with its source (the table and filter it was read from), so the Analyst's
 * answer can be checked against the grids on the page.
 */
import type { Citation } from "./analyst";
import { usd } from "./analyst";
import type { RawEngine } from "./dashboard";
import { buildTables, type StudioTables } from "./tables";

type Row = Record<string, string | number | boolean | null>;

export const CREATOR_TOPICS = [
  "overview",
  "earned",
  "voided",
  "held",
  "shared",
  "earn_more",
] as const;
export type CreatorTopic = (typeof CREATOR_TOPICS)[number];

export const CREATOR_GUARD =
  "A creator earns more by publishing tests with clear, accurate verdicts in categories brands fund. Never by gaming the holdout, buying their own products, or bending a verdict toward a funder.";

export interface CreatorAnswer {
  creatorId: string;
  creator: string;
  topic: CreatorTopic;
  headline: string;
  /** Plain sentences the Analyst may say as they are: every number in them is cited. */
  summary: string;
  citations: Citation[];
  /** The credits behind the answer (at most ten), for the card under the reply. */
  credits: { orderId: string; amount: string; note: string }[];
  guard: string;
}

const num = (r: Row, k: string) => (typeof r[k] === "number" ? (r[k] as number) : 0);
const str = (r: Row, k: string) => (r[k] == null ? "" : String(r[k]));
/** Table money is dollars for display; the Analyst speaks in dollars and cents. */
const d = (dollars: number) => usd(Math.round(dollars * 100));
const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + num(r, k), 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pts = (x: number) => `${Math.round(x * 100)} points`;
const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;

const cite = (label: string, value: string, source: string): Citation => ({ label, value, source });

/** Which credits this creator earned, in the table the page shows. */
const MINE = (name: string) => `Credits table, creator = ${name}`;

export function creatorAnswer(
  raw: RawEngine,
  creatorId: string,
  topic: CreatorTopic = "overview",
): CreatorAnswer | null {
  const t: StudioTables["tables"] = buildTables(raw).tables;
  // The creator's own row is in their first currency (USD when they have any). The answer speaks
  // in that one currency and never adds money in another to it.
  const me = (t.creators ?? []).find((c) => c.creatorId === creatorId);
  if (!me) return null;
  const name = str(me, "creator");
  const currency = str(me, "currency") || "USD";
  const inCurrency = (r: Row) => (str(r, "currency") || "USD") === currency;
  const d = (dollars: number) => usd(Math.round(dollars * 100), currency);
  const credits = (t.credits ?? []).filter((c) => c.creatorId === creatorId && inCurrency(c));
  const trust = (t.trust ?? []).filter((c) => c.creatorId === creatorId && inCurrency(c));
  const payouts = (t.payouts ?? []).filter((p) => p.creatorId === creatorId && inCurrency(p));
  const shares = (t.shares ?? []).filter(
    (s) => s.creatorId === creatorId && num(s, "splitOf") > 1 && inCurrency(s),
  );
  const base = { creatorId, creator: name, topic, guard: CREATOR_GUARD };
  const byState = (s: string) => credits.filter((c) => c.state === s);
  const paid = byState("paid");
  const voided = byState("voided");
  const held = byState("held");
  const frozen = byState("frozen");
  const pending = byState("pending");
  const first = payouts.find((p) => num(p, "batchIndex") === 1);

  if (topic === "earned") {
    const brandName = str(
      credits.find((c) => c.firstPayout === true && c.state === "paid") ?? {},
      "brand",
    );
    const programme = (scope: string) =>
      (t.brands ?? []).find((b) => b.scopeKey === scope && b.brand === brandName);
    // The first payout's own cycle for the caused count; the programme's lift for the bound.
    const winix = programme("first");
    const lift = programme("todate");
    const inFirst = credits.filter((c) => c.firstPayout === true && c.state === "paid");
    const firstAmount = first ? num(first, "amount") : sum(inFirst, "amount");
    const firstCredits = first ? num(first, "credits") : inFirst.length;
    const brands = [...new Set(inFirst.map((c) => str(c, "brand")))].join(" and ") || "a brand";
    const each = firstCredits > 0 ? firstAmount / firstCredits : 0;
    const cites = [
      cite(
        "Paid in the first payout",
        `${d(firstAmount)} across ${plural(firstCredits, "credit")}`,
        "Payouts table, batch 1 (PayPal Payouts)",
      ),
      cite("Average credit in it", d(each), `${MINE(name)}, in the first payout`),
      cite("Paid to date, all batches", d(sum(paid, "amount")), `${MINE(name)}, state = paid`),
    ];
    if (winix) {
      cites.push(
        cite(
          `${brandName} sales the test caused in that cycle`,
          `${num(winix, "causedUnits")} of ${num(winix, "exposedSales")} exposed`,
          `Brands table, ${brandName}, first payout`,
        ),
      );
    }
    if (lift && num(lift, "lowerBound") > 0)
      cites.push(
        cite(
          "Lift at the 80% lower bound",
          pct(num(lift, "lowerBound")),
          `Brands table, ${brandName}, programme to date`,
        ),
      );
    if (voided.length)
      cites.push(
        cite(
          "Voided before it was paid",
          d(sum(voided, "amount")),
          `${MINE(name)}, state = voided`,
        ),
      );
    return {
      ...base,
      headline: `${d(firstAmount)} was your first payout`,
      summary:
        `${d(firstAmount)} is what PayPal Payouts sent you in batch 1: ${plural(firstCredits, "credit")} of about ${d(each)} each, all for ${brands} sales your test caused. ` +
        `CITED credits only the sales the test caused, counted at the 80% lower bound of the lift` +
        (winix
          ? ` (${num(winix, "causedUnits")} of ${num(winix, "exposedSales")} exposed Winix sales)`
          : "") +
        `, and holds each credit 30 days before paying.` +
        (voided.length
          ? ` ${d(sum(voided, "amount"))} is not in it: ${voided.every((c) => c.voidReason === "refund") ? "that sale was refunded before the credit was paid" : "that credit was voided"}.`
          : "") +
        ` Across all batches you have been paid ${d(sum(paid, "amount"))}.`,
      citations: cites,
      credits: inFirst.slice(0, 10).map((c) => ({
        orderId: str(c, "orderId"),
        amount: d(num(c, "amount")),
        note: str(c, "payoutBatch"),
      })),
    };
  }

  if (topic === "voided") {
    const rows = trust.filter((c) => c.statusKey === "voided");
    const total = sum(voided, "amount");
    return {
      ...base,
      headline: voided.length ? `${d(total)} was voided` : "Nothing of yours is voided",
      summary: voided.length
        ? `${plural(voided.length, "credit")} (${d(total)}) was voided. ` +
          rows
            .slice(0, 3)
            .map((r) => `${str(r, "reason")}: ${str(r, "why")}`)
            .join(" ") +
          " A voided credit is never paid, and the brand's deposit is not charged for it."
        : "None of your credits is voided, so every credit is still pending, held, frozen or paid.",
      citations: [
        cite("Voided", d(total), `${MINE(name)}, state = voided`),
        ...rows
          .slice(0, 3)
          .map((r) =>
            cite(
              `Order ${str(r, "orderId")}`,
              `${d(num(r, "amount"))}: ${str(r, "reason")}`,
              "Trust review table",
            ),
          ),
      ],
      credits: voided.slice(0, 10).map((c) => ({
        orderId: str(c, "orderId"),
        amount: d(num(c, "amount")),
        note: `Void reason: ${str(c, "voidReason")}`,
      })),
    };
  }

  if (topic === "held") {
    const rows = trust.filter((c) => c.statusKey === "held" || c.statusKey === "frozen");
    const all = [...held, ...frozen];
    const total = sum(all, "amount");
    return {
      ...base,
      headline: all.length ? `${d(total)} is held or frozen` : "Nothing of yours is held",
      summary: all.length
        ? `${plural(all.length, "credit")} (${d(total)}) is not moving. ` +
          rows
            .slice(0, 3)
            .map((r) => `${str(r, "reason")}: ${str(r, "why")}`)
            .join(" ") +
          " A held credit is never paid automatically: a person releases it or voids it, and a frozen credit waits for PayPal's decision on the dispute."
        : `You have ${plural(pending.length, "credit")} on the normal 30-day hold (${d(sum(pending, "amount"))}) and nothing held for review.`,
      citations: [
        cite("Held for review", d(sum(held, "amount")), `${MINE(name)}, state = held`),
        cite("Frozen by a dispute", d(sum(frozen, "amount")), `${MINE(name)}, state = frozen`),
        ...rows
          .slice(0, 3)
          .map((r) =>
            cite(
              `Order ${str(r, "orderId")}`,
              `${d(num(r, "amount"))}: ${str(r, "status")}`,
              "Trust review table",
            ),
          ),
      ],
      credits: all.slice(0, 10).map((c) => ({
        orderId: str(c, "orderId"),
        amount: d(num(c, "amount")),
        note: `${str(c, "state") === "held" ? "Held because" : "Frozen"}: ${str(c, "holdReason")}`,
      })),
    };
  }

  if (topic === "shared") {
    const mine = sum(shares, "amount");
    const sales = shares.length;
    const allShares = (t.shares ?? []).filter((s) => num(s, "splitOf") > 1);
    // Even when every sale's shares are within a cent of each other.
    const even = shares.every((s) => {
      const peers = allShares
        .filter((x) => x.captureId === s.captureId)
        .map((x) => num(x, "amount"));
      return Math.max(...peers) - Math.min(...peers) <= 0.01;
    });
    const sharedCredits = credits.filter((c) => c.coExposed === true);
    return {
      ...base,
      headline: sales
        ? `${sales === 1 ? "1 sale was" : `${sales} sales were`} split with another creator`
        : "None of your sales is shared",
      summary: sales
        ? `On ${plural(sales, "sale")}, the agent had read another creator's test too, so CITED split each sale's credit with the Shapley method: each creator gets the average value they added across every order in which the tests could have been read. ` +
          (even
            ? `Here both tests added the same, so each sale split evenly: your share was ${d(mine)} in total. `
            : `Your share of them was ${d(mine)} in total. `) +
          `The split never pays out more than the one credit the sale earned.`
        : "None of your credits is split: no agent that bought your test's product had also read another creator's test.",
      citations: [
        cite("Shared sales", String(sales), "Shapley shares table, creator = " + name),
        cite("Your share of them", d(mine), "Shapley shares table, creator = " + name),
        ...sharedCredits
          .slice(0, 3)
          .map((c) =>
            cite(
              `Order ${str(c, "orderId")}`,
              `you ${d(num(c, "amount"))}; ${str(c, "splitWith")}`,
              MINE(name),
            ),
          ),
      ],
      credits: sharedCredits.slice(0, 10).map((c) => ({
        orderId: str(c, "orderId"),
        amount: d(num(c, "amount")),
        note: `Split with ${str(c, "splitWith")}`,
      })),
    };
  }

  if (topic === "earn_more") {
    const programmes = (t.brands ?? []).filter((b) => b.scopeKey === "todate");
    const funded = programmes.filter((b) => num(b, "lowerBound") > 0 && num(b, "available") > 0);
    const clear = programmes.filter((b) => num(b, "causedUnits") > 0);
    const solo = credits.filter((c) => c.coExposed !== true && c.state === "paid");
    const shared = credits.filter((c) => c.coExposed === true && c.state === "paid");
    const soloAvg = solo.length ? sum(solo, "amount") / solo.length : 0;
    const sharedAvg = shared.length ? sum(shared, "amount") / shared.length : 0;
    const open = [...held, ...frozen, ...pending];
    const fundedNames = funded.map((b) => `${str(b, "brand")} (${str(b, "category")})`).join(", ");
    return {
      ...base,
      headline: "More earnings come from clear tests in funded categories",
      summary:
        (clear.length
          ? `You are paid when your test makes buyers choose the brand your verdict names: ${clear
              .map(
                (b) =>
                  `${str(b, "brand")} ${pts(num(b, "lift"))} lift, ${num(b, "causedUnits")} of ${num(b, "exposedSales")} exposed sales caused`,
              )
              .join("; ")}. `
          : "") +
        (funded.length
          ? `Brands still have deposit left in ${fundedNames}, so tests in categories brands fund have room to earn. `
          : "No brand programme has deposit left right now, so a new test earns once a brand funds its category. ") +
        (solo.length && shared.length
          ? `A sale only your test was read for credited you ${d(soloAvg)} on average; a sale shared with another creator credited you ${d(sharedAvg)}, because the credit is split. `
          : "") +
        `Publish tests with a clear verdict and accurate claims. ` +
        `Do not buy your own products (those credits are held and never paid), do not game the holdout, and do not change a verdict to favour a funder: that is how credits get held or voided. ` +
        (open.length
          ? `${plural(open.length, "credit")} (${d(sum(open, "amount"))}) of yours is still waiting.`
          : ""),
      citations: [
        ...programmes.map((b) =>
          cite(
            `${str(b, "brand")} programme`,
            `lift ${num(b, "lift") ? pts(num(b, "lift")) : "none yet"}, ${num(b, "causedUnits")} caused of ${num(b, "exposedSales")} exposed, ${d(num(b, "available"))} deposit left`,
            "Brands table, programme to date",
          ),
        ),
        cite(
          "Average paid credit, sale read only for you",
          d(soloAvg),
          `${MINE(name)}, paid, not co-exposed`,
        ),
        cite("Average paid credit, sale shared", d(sharedAvg), `${MINE(name)}, paid, co-exposed`),
      ],
      credits: [],
    };
  }

  // overview
  const total = sum(credits, "amount");
  return {
    ...base,
    headline: `${name}: ${d(sum(paid, "amount"))} paid`,
    summary: `${name} has ${plural(credits.length, "credit")} (${d(total)}): ${d(sum(paid, "amount"))} paid, ${d(sum(pending, "amount"))} on the 30-day hold, ${d(sum(held, "amount"))} held for review, ${d(sum(frozen, "amount"))} frozen and ${d(sum(voided, "amount"))} voided.`,
    citations: [
      cite("Paid", d(sum(paid, "amount")), `${MINE(name)}, state = paid`),
      cite("Pending", d(sum(pending, "amount")), `${MINE(name)}, state = pending`),
      cite("Held for review", d(sum(held, "amount")), `${MINE(name)}, state = held`),
      cite("Frozen", d(sum(frozen, "amount")), `${MINE(name)}, state = frozen`),
      cite("Voided", d(sum(voided, "amount")), `${MINE(name)}, state = voided`),
    ],
    credits: [],
  };
}
