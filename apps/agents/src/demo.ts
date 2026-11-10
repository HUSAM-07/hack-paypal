/**
 * The scripted demo: plays every beat of cited/spec/CITED-packet.md against the live local stack
 * (engine, and the catalogue that also runs the agents' PayPal checkout), in order, from a seed.
 * No storefronts: agents read offers synced to PayPal and pay the seller's PayPal account from
 * the wallet the buyer linked to them. Each beat emits events; see README.md.
 *
 * The 147 sessions follow the shape of the price-matched study (19 exposed, 18 placebo, 12 held-out
 * per model; Winix buyers 57/57, 3/54, 3/36). Under the fake provider the agents' choices are
 * scripted to that shape, so the card's numbers (57 sales → 51 units → $391.64) come out of the real
 * pipeline, not out of the script. With real models the numbers are whatever the models do.
 */
import { type Arm, DEMO_SHOP_PRICES, UPC_LEVOIT_CORE300, UPC_WINIX_A230 } from "@pact/protocol";
import { runSession } from "./run";
import { ShopperSession } from "./session";
import { type Endpoints, MODEL_FAMILIES, type ModelFamily, type RunRecord } from "./types";

export const BEATS = [
  "fund",
  "exposed",
  "heldout",
  "study",
  "credits",
  "refund",
  "jump",
  "payout",
  "return",
  "analyst",
  "shapley",
  "dispute",
  "checks",
] as const;
export type BeatId = (typeof BEATS)[number];

/** One line of the event stream. `seq` starts at 1; there are no wall-clock fields, so a seed replays byte for byte. */
export interface DemoEvent {
  v: 1;
  seq: number;
  type: "run.start" | "beat.start" | "line" | "session" | "numbers" | "beat.end" | "run.end";
  beat?: BeatId;
  /** Human sentence for `line`, `beat.start` and `beat.end`. */
  text?: string;
  data?: Record<string, unknown>;
}

export interface DemoOptions {
  engineUrl: string;
  catalogueUrl: string;
  seed: string;
  provider: "fake" | "openai-compatible";
  /** Where the refund beat sits. See README. */
  refund: "before-payout" | "after-payout";
  emit: (e: DemoEvent) => void | Promise<void>;
  /** Pause between beats (ms), for a live screen. */
  pace?: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DemoResult {
  numbers: {
    sessions: number;
    purchased: number;
    exposedSales: number;
    causedUnits: number;
    creditedMinor: number;
    paidMinor: number;
    returnedMinor: number;
    levoitCausedUnits: number;
    liftPoints: number;
    /** The co-exposure cohort and dispute beats: a later cycle, stated on its own. */
    coExposure: CoExposureNumbers;
  };
  checks: Check[];
  /** True when every number on the card was reproduced (fake provider only). */
  matchesCard: boolean;
  /** Every session's run record, in play order (the console's side-by-side frame reads these). */
  records: RunRecord[];
}

/** The study's shape, per model in MODEL_FAMILIES order. */
export const PLAN = {
  exposed: [19, 19, 19],
  placebo: [18, 18, 18],
  none: [12, 12, 12],
  /** Placebo sessions that buy the Winix anyway (3/54). */
  placeboWinix: [2, 0, 1],
  /** Held-out sessions that buy the Winix anyway (3/36). */
  noneWinix: [1, 1, 1],
};

/** Agents per model in the co-exposure cohort: shown both HouseFresh's and AirLab's tests. */
export const COHORT_PER_MODEL = 4;
const AIRLAB = { creatorId: "airlab", name: "AirLab", paypalId: "AIRLAB-PP" };

export interface CoExposureNumbers {
  sessions: number;
  winixBuyers: number;
  causedUnitsBefore: number;
  causedUnitsAfter: number;
  /** Earlier HouseFresh-only sales the tighter bound now credits. */
  earlierSalesCredited: number;
  coExposedSalesCredited: number;
  /** The one sale the runner shows (and later disputes). */
  splitSale: {
    captureId: string;
    totalMinor: number;
    housefreshMinor: number;
    airlabMinor: number;
  };
  /** Day 60's batch, with the disputed sale's credits held back. */
  day60: { housefreshMinor: number; airlabMinor: number; frozenMinor: number };
  /** Paid once PayPal resolved the dispute for the seller. */
  released: { housefreshMinor: number; airlabMinor: number };
}

/**
 * What the cohort and dispute beats must reproduce under the fake provider (seed cited-demo).
 * Demo outputs, not eval results: the card's numbers come from the first cycle only.
 */
export const COEXPOSURE: Omit<CoExposureNumbers, "splitSale"> & {
  splitSale: Omit<CoExposureNumbers["splitSale"], "captureId">;
} = {
  sessions: 12,
  winixBuyers: 12,
  causedUnitsBefore: 51,
  causedUnitsAfter: 62,
  earlierSalesCredited: 6,
  coExposedSalesCredited: 5,
  splitSale: { totalMinor: 768, housefreshMinor: 384, airlabMinor: 384 },
  day60: { housefreshMinor: 6_143, airlabMinor: 1_536, frozenMinor: 768 },
  released: { housefreshMinor: 384, airlabMinor: 384 },
};

/** The card: what the pipeline must reproduce. */
export const CARD = {
  sessions: 147,
  exposedSales: 57,
  causedUnits: 51,
  creditedMinor: 39_164,
  returnedMinor: 60_836,
  deposit: 100_000,
};

const SELLERS = ["northwind", "lumen", "megamart"] as const;
const SELLER_NAMES: Record<string, string> = {
  northwind: "Northwind",
  lumen: "Lumen",
  megamart: "MegaMart",
};
const sellerName = (id: string | null | undefined) => (id ? (SELLER_NAMES[id] ?? id) : "?");
const REQUEST = "Small bedroom purifier, light sleeper, around $100, just buy it";
const CATEGORY = "purifier";

export const usd = (minor: number): string =>
  `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Json = Record<string, any>;

const hfOf = (credits: Json): Json =>
  (credits.creators as Json[]).find((c) => c.creatorId === "housefresh") ?? {
    totals: { pending: 0, voided: 0, paid: 0, frozen: 0 },
    credits: [],
  };

function tag(seed: string): string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36).slice(0, 6);
}

interface Slot {
  id: string;
  arm: Arm;
  model: ModelFamily;
  index: number;
  buysWinix: boolean;
  browse: string;
  coExposed?: boolean;
}

export async function runDemo(o: DemoOptions): Promise<DemoResult> {
  let seq = 0;
  const emit = async (e: Omit<DemoEvent, "v" | "seq">) => {
    await o.emit({ v: 1, seq: ++seq, ...e } as DemoEvent);
  };
  const line = (beat: BeatId, text: string, data?: Record<string, unknown>) =>
    emit({ type: "line", beat, text, ...(data ? { data } : {}) });
  const numbers = (beat: BeatId, data: Record<string, unknown>) =>
    emit({ type: "numbers", beat, data });
  const beat = async (b: BeatId, title: string, body: () => Promise<void>) => {
    await emit({ type: "beat.start", beat: b, text: title });
    await body();
    await emit({ type: "beat.end", beat: b });
    if (o.pace) await new Promise((r) => setTimeout(r, o.pace));
  };

  const eng = async (method: "GET" | "POST", path: string, body?: unknown): Promise<Json> => {
    const res = await fetch(`${o.engineUrl}/api${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const json = (await res.json()) as Json;
    if (!res.ok)
      throw new Error(`engine ${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  /** The catalogue: offers, the agents' PayPal checkout, and the sellers' refund action. */
  const cat = async (method: "GET" | "POST", path: string, body?: unknown): Promise<Json> => {
    const res = await fetch(`${o.catalogueUrl}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const json = (await res.json()) as Json;
    if (!res.ok) throw new Error(`catalogue ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  };

  const ep: Endpoints = {
    catalogueUrl: o.catalogueUrl,
    engineUrl: o.engineUrl,
  };
  const fake = o.provider === "fake";
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  await emit({
    type: "run.start",
    text: "CITED demo",
    data: { seed: o.seed, provider: o.provider, refund: o.refund, beats: [...BEATS] },
  });

  // ── Setup, then Beat 1: the brands fund the category programme ──
  await beat("fund", "Winix and Levoit fund the purifier programme", async () => {
    await eng("POST", "/brands", {
      brandId: "winix",
      name: "Winix",
      category: CATEGORY,
      upc: UPC_WINIX_A230,
    });
    await eng("POST", "/brands", {
      brandId: "levoit",
      name: "Levoit",
      category: CATEGORY,
      upc: UPC_LEVOIT_CORE300,
    });
    await eng("POST", "/creators", {
      creatorId: "housefresh",
      name: "HouseFresh",
      paypalId: "HOUSEFRESH-PP",
    });
    await eng("POST", "/listings", {
      listings: (Object.keys(DEMO_SHOP_PRICES) as (keyof typeof DEMO_SHOP_PRICES)[]).flatMap(
        (shopId) =>
          [UPC_WINIX_A230, UPC_LEVOIT_CORE300].map((upc) => ({
            shopId,
            upc,
            priceMinor: (DEMO_SHOP_PRICES[shopId] as Record<string, number>)[upc],
            currency: "USD",
          })),
      ),
    });
    for (const [brandId, name] of [
      ["winix", "Winix"],
      ["levoit", "Levoit"],
    ] as const) {
      const d = await eng("POST", `/brands/${brandId}/deposits`, { amountMinor: CARD.deposit });
      await line(
        "fund",
        `${name} deposits ${usd(CARD.deposit)} into the purifier programme (Orders v2 capture ${d.captureId}). It pays only for its own lifted units; it never sees or buys a verdict.`,
        { brandId, amountMinor: CARD.deposit, captureId: d.captureId },
      );
    }
    await line(
      "fund",
      "Northwind, Lumen and MegaMart sync their catalogues to PayPal; no agent visits their websites. Lumen offers both purifiers $4.00 under Northwind, and Levoit is priced the same as Winix at every seller.",
      { prices: DEMO_SHOP_PRICES },
    );
    await line(
      "fund",
      "Each buyer linked their PayPal to their shopping agent once (PayPal Vault, payment_source.paypal). Every agent below checks out through PayPal with that saved wallet; the money goes straight to the seller's PayPal account.",
    );
  });

  // ── Choose the sessions: the catalogue is stateless, so probing ids to land each on its arm is free ──
  const t = tag(o.seed);
  const need: Record<Arm, number> = {
    test: PLAN.exposed.reduce((a, b) => a + b, 0),
    placebo: PLAN.placebo.reduce((a, b) => a + b, 0),
    none: PLAN.none.reduce((a, b) => a + b, 0),
  };
  const pool: Record<Arm, string[]> = { test: [], placebo: [], none: [] };
  for (
    let n = 0;
    pool.test.length < need.test ||
    pool.placebo.length < need.placebo ||
    pool.none.length < need.none;
    n++
  ) {
    if (n > 20_000) throw new Error("could not find session ids for every arm");
    const id = `${t}-${n.toString(36)}`;
    const probe = new ShopperSession(ep, `probe-${id}`, { sessionId: id });
    try {
      await probe.search({ query: "air purifier" });
    } finally {
      await probe.close();
    }
    const arm = probe.passportBody()?.arm;
    if (arm && pool[arm].length < need[arm]) pool[arm].push(id);
  }

  const slots: Slot[] = [];
  const counts: Record<Arm, number[]> = {
    test: PLAN.exposed,
    placebo: PLAN.placebo,
    none: PLAN.none,
  };
  const cursor: Record<Arm, number> = { test: 0, placebo: 0, none: 0 };
  const longest = Math.max(...PLAN.exposed, ...PLAN.placebo, ...PLAN.none);
  for (let i = 0; i < longest; i++) {
    MODEL_FAMILIES.forEach((model, m) => {
      for (const arm of ["test", "placebo", "none"] as const) {
        const total = counts[arm][m] as number;
        if (i >= total) continue;
        const winixBuyers =
          arm === "placebo" ? PLAN.placeboWinix[m] : arm === "none" ? PLAN.noneWinix[m] : total;
        slots.push({
          id: pool[arm][cursor[arm]++] as string,
          arm,
          model,
          index: i,
          buysWinix: arm === "test" ? true : i >= total - (winixBuyers as number),
          browse: SELLERS[(i + m) % SELLERS.length] as string,
        });
      }
    });
  }
  const heroExposed = slots.find((s) => s.arm === "test" && s.model === "gpt") as Slot;
  const heroHeld = slots.find((s) => s.arm === "none" && s.model === "gpt" && !s.buysWinix) as Slot;
  heroExposed.browse = "northwind";
  const ordered = [
    heroExposed,
    heroHeld,
    ...slots.filter((s) => s !== heroExposed && s !== heroHeld),
  ];

  const records = new Map<string, RunRecord>();
  const play = async (s: Slot): Promise<RunRecord> => {
    const r = await runSession({
      endpoints: ep,
      seed: o.seed,
      runIndex: records.size,
      family: s.model,
      provider: o.provider,
      request: REQUEST,
      sessionId: s.id,
      category: CATEGORY,
      ...(s.coExposed ? { coExposed: true } : {}),
      fake: {
        browseSeller: s.browse,
        loyalty: 0,
        ...(s.arm === "test"
          ? {}
          : { baselineUpc: s.buysWinix ? UPC_WINIX_A230 : UPC_LEVOIT_CORE300 }),
      },
    });
    if (r.status === "error") throw new Error(`session ${s.id} failed: ${r.error}`);
    records.set(s.id, r);
    await emit({ type: "session", data: sessionData(r) });
    return r;
  };

  let heroSale: RunRecord | undefined;
  await beat(
    "exposed",
    "An exposed agent reads Northwind's offer and pays Lumen through PayPal",
    async () => {
      const r = await play(heroExposed);
      heroSale = r;
      const nw = DEMO_SHOP_PRICES.northwind[UPC_WINIX_A230];
      const lu = DEMO_SHOP_PRICES.lumen[UPC_WINIX_A230];
      await line(
        "exposed",
        `"${REQUEST}" → ${r.model} (arm: ${r.arm}) saw HouseFresh's test while reading ${r.storesViewed.map(sellerName).join(", ")}'s offer at ${usd(nw)}. The agent checked out through PayPal with the buyer's saved PayPal, paid ${sellerName(r.seller)} ${usd(r.total?.amountMinor ?? 0)} for the ${r.product?.name} (order ${r.orderId}, capture ${r.captureId}). Saved ${usd(nw - lu)}. Same offers, same order as any other agent; only the test was added.`,
        {
          sessionId: r.sessionId,
          orderId: r.orderId,
          captureId: r.captureId,
          seller: r.seller,
          savedMinor: nw - lu,
        },
      );
    },
  );
  await beat(
    "heldout",
    "A held-out agent sees everything except the test and buys Levoit",
    async () => {
      const r = await play(heroHeld);
      await line(
        "heldout",
        `Same request → ${r.model} (arm: ${r.arm}), same offers in the same order, no test. The agent checked out through PayPal with the buyer's saved PayPal, paid ${sellerName(r.seller)} ${usd(r.total?.amountMinor ?? 0)} for the ${r.product?.name}.`,
        { sessionId: r.sessionId, orderId: r.orderId, seller: r.seller },
      );
    },
  );

  await beat(
    "study",
    `The other ${ordered.length - 2} sessions: three models, three arms`,
    async () => {
      let done = 2;
      for (const s of ordered.slice(2)) {
        await play(s);
        done++;
        if (done % 25 === 0 || done === ordered.length) {
          await line("study", `${done}/${ordered.length} sessions played`, { done });
        }
      }
      const all = [...records.values()];
      const by = (arm: Arm, upc: string) =>
        all.filter((r) => r.arm === arm && r.product?.upc === upc).length;
      const n = (arm: Arm) => all.filter((r) => r.arm === arm).length;
      const rows = (["test", "placebo", "none"] as const).map((arm) => ({
        arm,
        sessions: n(arm),
        winix: by(arm, UPC_WINIX_A230),
        levoit: by(arm, UPC_LEVOIT_CORE300),
      }));
      await numbers("study", { sessions: all.length, byArm: rows });
      await line(
        "study",
        `Winix share: shown the test ${rows[0]?.winix}/${rows[0]?.sessions}; same-creator placebo ${rows[1]?.winix}/${rows[1]?.sessions}; held out ${rows[2]?.winix}/${rows[2]?.sessions}.`,
      );
    },
  );

  // ── Credits: only what the test caused ──
  let creditedMinor = 0;
  let causedUnits = 0;
  let exposedSales = 0;
  let levoitUnits = -1;
  let liftPoints = 0;
  await beat("credits", "The engine credits only the sales the test caused", async () => {
    const rec = await eng("POST", "/credits/recompute");
    const winix = await eng("GET", "/lift/winix");
    const levoit = await eng("GET", "/lift/levoit");
    const hf = hfOf(await eng("GET", "/credits"));
    exposedSales = winix.exposedSales;
    causedUnits = winix.causedUnits;
    levoitUnits = levoit.causedUnits;
    liftPoints = Math.round(winix.lift * 100);
    creditedMinor = hf?.totals.pending ?? 0;
    await numbers("credits", {
      exposedSales,
      causedUnits,
      attributableFraction: winix.attributableFraction,
      liftPoints,
      lowerBound: winix.lowerBound,
      credits: rec.created,
      creditedMinor,
      levoitCausedUnits: levoitUnits,
      levoitLowerBound: levoit.lowerBound,
    });
    await line(
      "credits",
      `Winix: ${exposedSales} exposed sales → ${causedUnits} caused units (lift +${liftPoints} points, attributable fraction ${(winix.attributableFraction * 100).toFixed(1)}% at the 80% lower bound) → ${usd(creditedMinor)} credited to HouseFresh, held 30 days.`,
    );
    await line(
      "credits",
      `Levoit: lift bound ${(levoit.lowerBound * 100).toFixed(1)} points → ${levoitUnits} caused units → ${usd(0)}. Levoit pays nothing, and its brand manager never asked HouseFresh for a better verdict.`,
    );
  });

  /** The seller whose sale it was refunds it through PayPal: `captures/{id}/refund`. */
  const refundOne = async (): Promise<{ captureId: string; amountMinor: number }> => {
    const captureId = heroSale?.captureId as string;
    const before = hfOf(await eng("GET", "/credits")).credits.find(
      (c: Json) => c.captureId === captureId,
    );
    await cat("POST", `/sellers/${heroSale?.seller}/refunds`, { captureId });
    return { captureId, amountMinor: before?.amountMinor ?? 0 };
  };

  let voidedMinor = 0;
  const doRefund = async () => {
    const r = await refundOne();
    const creds = (await eng("GET", "/credits")) as Json;
    const hf = hfOf(creds);
    const voided = hf.credits.filter((c: Json) => c.state === "voided");
    voidedMinor = hf.totals.voided;
    await numbers("refund", {
      captureId: r.captureId,
      voidedCredits: voided.length,
      voidedMinor,
      reviewFlags: creds.reviewFlags.length,
      creditStates: hf.totals,
    });
    return { creds, voided };
  };

  if (o.refund === "before-payout") {
    await beat("refund", "A buyer returns one Winix and that commission disappears", async () => {
      const { voided } = await doRefund();
      await line(
        "refund",
        `The exposed buyer returns the Winix and ${sellerName(heroSale?.seller)} refunds it through PayPal (captures/${heroSale?.captureId}/refund). PayPal's refund webhook voids ${voided.length} pending credit (${usd(voidedMinor)}) before it can be paid.`,
      );
      check("one refund voids exactly one credit", voided.length === 1, `${voided.length} voided`);
    });
  }

  await beat("jump", "Day 30: the hold ends", async () => {
    const r = await eng("POST", "/clock/advance", { days: 30 });
    const { now: _now, ...payout } = r.payout as Json;
    await numbers("jump", { days: 30, payout });
    await line(
      "jump",
      "The demo clock jumps 30 days. Holds end; refunds and disputes have had their window.",
    );
  });

  let paidMinor = 0;
  let firstBatchId: string | undefined;
  await beat("payout", "HouseFresh is paid, in one batch, through PayPal Payouts", async () => {
    const payouts = await eng("GET", "/payouts");
    const credits = await eng("GET", "/credits");
    const hf = hfOf(credits);
    paidMinor = hf.totals.paid;
    const batch = payouts.batches[0];
    firstBatchId = batch?.senderBatchId;
    await numbers("payout", {
      batches: payouts.batches.length,
      senderBatchId: batch?.senderBatchId,
      items: batch?.items,
      paidMinor,
      pendingMinor: hf.totals.pending,
      voidedMinor: hf.totals.voided,
    });
    await line(
      "payout",
      `${usd(paidMinor)} lands in HouseFresh's PayPal account (PAYPAL_ID, batch ${batch?.senderBatchId}, status ${batch?.status})${voidedMinor ? `: ${usd(creditedMinor)} credited − ${usd(voidedMinor)} voided by the refund` : ""}. Nobody clicked a link.`,
    );
  });

  let returned: Json = { brands: [] };
  await beat("return", "Unspent deposits go back to the brands", async () => {
    returned = await eng("POST", "/cycle/close");
    const rows = returned.brands.map((b: Json) => ({
      brandId: b.brandId,
      spentMinor: b.spent,
      returnedMinor: b.returnedNow,
    }));
    await numbers("return", { brands: rows });
    for (const r of rows) {
      await line(
        "return",
        `${r.brandId === "winix" ? "Winix" : "Levoit"}: paid ${usd(r.spentMinor)}, ${usd(r.returnedMinor)} returned through captures/{id}/refund.`,
        r,
      );
    }
  });

  if (o.refund === "after-payout") {
    await beat("refund", "A buyer returns one Winix after the payout", async () => {
      const { creds } = await doRefund();
      await line(
        "refund",
        `The credit was already paid, so it is not clawed back: it appears as ${creds.reviewFlags.length} review flag for a person.`,
      );
      check(
        "a refund after payout is flagged, not clawed back",
        creds.reviewFlags.length === 1,
        `${creds.reviewFlags.length} flags`,
      );
    });
  }

  await beat("analyst", "The Analyst recommends; Maya approves", async () => {
    const w = await eng("GET", "/lift/winix");
    const points = Math.round(w.lift * 100);
    await line(
      "analyst",
      `Analyst: "Tests with a clear winner move agents ${points} points; close verdicts pay nothing. Raise the purifier budget."`,
      {
        liftPoints: points,
        closeVerdict: { boundPoints: -6.0, source: "packages/evals/results/cited/summary.md" },
      },
    );
    const top = await eng("POST", "/approvals/analyst-1/approve", {
      brandId: "winix",
      amountMinor: 50_000,
    });
    await line(
      "analyst",
      `Maya approves: Winix adds ${usd(50_000)} to the programme (scripted amount; capture ${top.captureId}). Money buys honest tests, never a better spot.`,
      { approval: "analyst-1", brandId: "winix", amountMinor: 50_000 },
    );
  });

  // ── A later cycle, stated on its own: two creators, one sale, and a disputed sale ──
  const co: CoExposureNumbers = {
    sessions: 0,
    winixBuyers: 0,
    causedUnitsBefore: 0,
    causedUnitsAfter: 0,
    earlierSalesCredited: 0,
    coExposedSalesCredited: 0,
    splitSale: { captureId: "", totalMinor: 0, housefreshMinor: 0, airlabMinor: 0 },
    day60: { housefreshMinor: 0, airlabMinor: 0, frozenMinor: 0 },
    released: { housefreshMinor: 0, airlabMinor: 0 },
  };
  const cohort: RunRecord[] = [];
  let splitSale: Json | undefined;
  await beat("shapley", "One sale, two creators: the commission splits by Shapley", async () => {
    await eng("POST", "/creators", AIRLAB);
    const ids: string[] = [];
    for (let n = 0; ids.length < COHORT_PER_MODEL * MODEL_FAMILIES.length; n++) {
      if (n > 5_000) throw new Error("could not find exposed session ids for the cohort");
      const id = `${t}-co-${n.toString(36)}`;
      const probe = new ShopperSession(ep, `probe-${id}`, { sessionId: id });
      try {
        await probe.search({ query: "air purifier" });
      } finally {
        await probe.close();
      }
      if (probe.passportBody()?.arm === "test") ids.push(id);
    }
    const before = await eng("GET", "/lift/winix");
    co.causedUnitsBefore = before.causedUnits;
    const creditedBefore = new Set<string>(
      ((await eng("GET", "/shapley")).sales as Json[]).map((x) => x.captureId),
    );
    let k = 0;
    for (let i = 0; i < COHORT_PER_MODEL; i++) {
      for (const [m, model] of MODEL_FAMILIES.entries()) {
        const r = await play({
          id: ids[k++] as string,
          arm: "test",
          model,
          index: i,
          buysWinix: true,
          browse: SELLERS[(i + m) % SELLERS.length] as string,
          coExposed: true,
        });
        cohort.push(r);
      }
    }
    co.sessions = cohort.length;
    co.winixBuyers = cohort.filter((r) => r.product?.upc === UPC_WINIX_A230).length;
    await line(
      "shapley",
      `A second creator, AirLab, publishes its own purifier test (living-room particle runs; it also recommends the Winix). ${co.sessions} more agents (${COHORT_PER_MODEL} per model) are shown both tests before they buy: ${co.winixBuyers} of ${co.sessions} buy the Winix.`,
      { sessions: co.sessions, winixBuyers: co.winixBuyers },
    );

    await eng("POST", "/credits/recompute");
    const after = await eng("GET", "/lift/winix");
    co.causedUnitsAfter = after.causedUnits;
    const sales = ((await eng("GET", "/shapley")).sales as Json[]).filter(
      (x) => !creditedBefore.has(x.captureId),
    );
    const isCo = (x: Json) => (x.shares as Json[]).length > 1;
    co.coExposedSalesCredited = sales.filter(isCo).length;
    co.earlierSalesCredited = sales.length - co.coExposedSalesCredited;
    splitSale = sales.find(isCo);
    const share = (x: Json | undefined, who: string) =>
      ((x?.shares as Json[] | undefined) ?? []).find((y) => y.creatorId === who)?.amountMinor ?? 0;
    co.splitSale = {
      captureId: splitSale?.captureId ?? "",
      totalMinor: splitSale?.totalMinor ?? 0,
      housefreshMinor: share(splitSale, "housefresh"),
      airlabMinor: share(splitSale, "airlab"),
    };

    // The coalition lifts the engine splits on, recomputed here from the run records.
    const exposed = [...records.values()].filter((r) => r.arm === "test");
    const placebo = [...records.values()].filter((r) => r.arm === "placebo");
    const winixRate = (rs: RunRecord[]) =>
      rs.length ? rs.filter((r) => r.product?.upc === UPC_WINIX_A230).length / rs.length : 0;
    const base = winixRate(placebo);
    const v = (who: string[]) =>
      Math.max(
        0,
        winixRate(exposed.filter((r) => who.every((c) => r.creatorsSeen.includes(c)))) - base,
      );
    const vH = v(["housefresh"]);
    const vA = v(["airlab"]);
    const vHA = v(["housefresh", "airlab"]);
    const phiH = (vH + (vHA - vA)) / 2;
    const phiA = (vA + (vHA - vH)) / 2;
    const pts = (x: number) => `+${(x * 100).toFixed(1)}`;
    await numbers("shapley", {
      ...co,
      lowerBound: after.lowerBound,
      exposedSales: after.exposedSales,
      coalitionLiftPoints: { housefresh: vH * 100, airlab: vA * 100, both: vHA * 100 },
      shapleyPoints: { housefresh: phiH * 100, airlab: phiA * 100 },
    });
    await line(
      "shapley",
      `More evidence tightens the 80% bound: ${co.causedUnitsBefore} → ${co.causedUnitsAfter} caused Winix units over ${after.exposedSales} exposed sales. The ${sales.length} new credits go, in sale order, to ${co.earlierSalesCredited} earlier HouseFresh-only sales and ${co.coExposedSalesCredited} co-exposed sales; they draw on Winix's approved top-up.`,
    );
    if (splitSale) {
      await line(
        "shapley",
        `One sale, two creators: ${usd(co.splitSale.totalMinor)} commission on capture ${co.splitSale.captureId} → HouseFresh ${usd(co.splitSale.housefreshMinor)}, AirLab ${usd(co.splitSale.airlabMinor)}, by Shapley. Lift over the placebo: HouseFresh's test ${pts(vH)} points, AirLab's ${pts(vA)}, both together ${pts(vHA)}; each adds the same at the margin, so each gets half.`,
        { captureId: co.splitSale.captureId },
      );
    } else {
      await line("shapley", "No co-exposed sale was credited in this run.");
    }
    check(
      "shapley: every co-exposed credit splits exactly, and both creators earn",
      sales
        .filter(isCo)
        .every(
          (x) =>
            share(x, "housefresh") > 0 &&
            share(x, "airlab") > 0 &&
            share(x, "housefresh") + share(x, "airlab") === x.totalMinor,
        ) &&
        (!fake || co.coExposedSalesCredited > 0),
      `${co.coExposedSalesCredited} co-exposed sales split`,
    );
  });

  let disputeId: string | undefined;
  const frozenIds: string[] = [];
  let day60: Json | undefined;
  let releaseRun: Json | undefined;
  await beat(
    "dispute",
    "A buyer disputes a sale: its credits freeze until PayPal decides",
    async () => {
      if (!splitSale) {
        await line("dispute", "No credited co-exposed sale to dispute in this run.");
        return;
      }
      const captureId = splitSale.captureId as string;
      const opened = await cat("POST", "/mock/disputes", { captureId });
      disputeId = opened.disputeId;
      const held = (((await eng("GET", "/credits")).creators as Json[]) ?? []).flatMap((c) =>
        (c.credits as Json[]).filter((x) => x.captureId === captureId),
      );
      frozenIds.push(...held.filter((x) => x.frozen).map((x) => x.id as string));
      co.day60.frozenMinor = held.reduce((a, x) => a + x.amountMinor, 0);
      await line(
        "dispute",
        `The buyer of that sale opens a PayPal dispute ("item not received", ${opened.disputeId}). CUSTOMER.DISPUTE.CREATED reaches the engine: the sale's ${held.length} pending credits (${usd(co.day60.frozenMinor)}) freeze. Not voided: PayPal has not decided.`,
        {
          disputeId,
          captureId,
          frozenCredits: frozenIds.length,
          frozenMinor: co.day60.frozenMinor,
        },
      );

      const jump = await eng("POST", "/clock/advance", { days: 30 });
      day60 = jump.payout as Json;
      const item = (who: string) =>
        ((day60?.items as Json[] | undefined) ?? []).find((i) => i.creatorId === who);
      co.day60.housefreshMinor = item("housefresh")?.amountMinor ?? 0;
      co.day60.airlabMinor = item("airlab")?.amountMinor ?? 0;
      await numbers("dispute", {
        day60: { senderBatchId: day60?.senderBatchId, items: day60?.items },
      });
      await line(
        "dispute",
        `Day 60: holds end. One batch, two PayPal accounts (PAYPAL_ID): HouseFresh ${usd(co.day60.housefreshMinor)}, AirLab ${usd(co.day60.airlabMinor)} (batch ${day60?.senderBatchId}). The disputed sale's ${usd(co.day60.frozenMinor)} is held back.`,
      );

      const resolved = await cat("POST", `/mock/disputes/${disputeId}/resolve`, {
        favour: "seller",
      });
      releaseRun = await eng("POST", "/payouts/run");
      const rel = (who: string) =>
        ((releaseRun?.items as Json[] | undefined) ?? []).find((i) => i.creatorId === who)
          ?.amountMinor ?? 0;
      co.released = { housefreshMinor: rel("housefresh"), airlabMinor: rel("airlab") };
      await numbers("dispute", {
        outcome: resolved.outcome,
        released: { senderBatchId: releaseRun?.senderBatchId, items: releaseRun?.items },
      });
      await line(
        "dispute",
        `PayPal resolves the dispute in the seller's favour (${resolved.outcome}). CUSTOMER.DISPUTE.RESOLVED releases the credits, and the next payout pays them: HouseFresh ${usd(co.released.housefreshMinor)}, AirLab ${usd(co.released.airlabMinor)} (batch ${releaseRun?.senderBatchId}). Had the buyer won, they would have been voided.`,
      );
    },
  );

  // ── The ledger and PayPal must agree ──
  await beat("checks", "Ledger and PayPal agree", async () => {
    const [deposits, credits, payouts, mock, salesMock, journeys, offers] = await Promise.all([
      eng("GET", "/deposits"),
      eng("GET", "/credits"),
      eng("GET", "/payouts"),
      eng("GET", "/mock/state"),
      cat("GET", "/mock/state"),
      eng("GET", "/journeys?limit=200"),
      cat("GET", "/offers"),
    ]);
    const hf = hfOf(credits);
    const creators = credits.creators as Json[];
    const ledgerPaid = creators.reduce((a, c) => a + c.totals.paid, 0);
    const itemsOf = (b: Json) => b.items as Json[];
    const mockBatchTotal = (mock.batches as Json[]).reduce(
      (a, b) => a + itemsOf(b).reduce((x, i) => x + i.amount.amountMinor, 0),
      0,
    );
    check(
      "payouts: ledger paid == PayPal batch totals",
      ledgerPaid === mockBatchTotal && mock.batches.length === payouts.batches.length,
      `ledger ${usd(ledgerPaid)}, PayPal ${usd(mockBatchTotal)} in ${mock.batches.length} batches`,
    );
    const receivers: Record<string, string> = {
      housefresh: "HOUSEFRESH-PP",
      airlab: "AIRLAB-PP",
    };
    for (const c of creators) {
      const inPayPal = (mock.batches as Json[])
        .flatMap(itemsOf)
        .filter((i) => i.receiver === receivers[c.creatorId] && i.recipientType === "PAYPAL_ID")
        .reduce((a, i) => a + i.amount.amountMinor, 0);
      check(
        `payouts: ${c.name} paid in ledger == paid to its PAYPAL_ID`,
        inPayPal === c.totals.paid,
        `${usd(c.totals.paid)} vs ${usd(inPayPal)}`,
      );
    }
    const firstMock = (mock.batches as Json[]).find((b) => b.senderBatchId === firstBatchId);
    const item = firstMock?.items[0];
    check(
      "day-30 payout: one item, to HouseFresh's PAYPAL_ID",
      firstMock?.items.length === 1 &&
        item?.receiver === "HOUSEFRESH-PP" &&
        item?.recipientType === "PAYPAL_ID",
      `${item?.recipientType} ${item?.receiver}`,
    );
    const ids = (bs: Json[]) => bs.map((b) => b.senderBatchId as string).sort();
    check(
      "payouts: the same batch ids in ledger and PayPal",
      JSON.stringify(ids(payouts.batches)) === JSON.stringify(ids(mock.batches)),
      `${payouts.batches.length} batches`,
    );
    const depositedMock = new Map<string, Json>(mock.captures.map((c: Json) => [c.id, c]));
    for (const b of deposits.brands as Json[]) {
      const funded = b.deposits.filter((d: Json) => d.status === "captured");
      const inMock = funded.reduce(
        (a: number, d: Json) => a + (depositedMock.get(d.captureId)?.amount.amountMinor ?? 0),
        0,
      );
      const refundedMock = funded.reduce(
        (a: number, d: Json) => a + (depositedMock.get(d.captureId)?.refunded ?? 0),
        0,
      );
      check(
        `${b.brandId}: deposits in ledger == captures in PayPal`,
        inMock === b.deposited,
        `${usd(b.deposited)} vs ${usd(inMock)}`,
      );
      check(
        `${b.brandId}: returned in ledger == refunded in PayPal`,
        refundedMock === b.returned,
        `${usd(b.returned)} vs ${usd(refundedMock)}`,
      );
      check(
        `${b.brandId}: spent + returned + reserved + available == deposited`,
        b.spent + b.returned + b.reserved + b.available === b.deposited,
        `${usd(b.deposited)}`,
      );
    }
    const sales = salesMock.captures as Json[];
    const attributed = (journeys.journeys as Json[]).flatMap((j) => j.items as Json[]);
    check(
      "sales: every agent's PayPal capture reached the engine through a webhook",
      attributed.length === sales.length && salesMock.failedDeliveries.length === 0,
      `${attributed.length} attributed / ${sales.length} captured, ${salesMock.failedDeliveries.length} failed deliveries`,
    );
    const payeeOf = new Map<string, string>(
      (offers.offers as Json[]).map((x) => [x.seller.id, JSON.stringify(x.seller.payee)]),
    );
    const byCapture = new Map<string, Json>(sales.map((x) => [x.id, x]));
    const all = [...records.values()];
    const paidRight = all.filter((r) => {
      const c = byCapture.get(r.captureId ?? "");
      return c?.vaulted === true && JSON.stringify(c.payee) === payeeOf.get(r.seller ?? "");
    });
    check(
      "sales: every agent paid the seller's PayPal account (payee) from the buyer's saved wallet",
      paidRight.length === all.length && sales.length === all.length,
      `${paidRight.length}/${all.length} orders`,
    );
    check(
      "cross-seller: the exposed agent read Northwind's offer and paid Lumen",
      heroSale?.storesViewed.includes("northwind") === true && heroSale?.seller === "lumen",
      `read ${heroSale?.storesViewed.join(",")}, paid ${heroSale?.seller}`,
    );
    check(
      "sales: engine amounts == PayPal amounts",
      attributed.reduce((a, i) => a + i.amountMinor, 0) ===
        sales.reduce((a, s) => a + s.amount.amountMinor, 0),
      `${usd(attributed.reduce((a, i) => a + i.amountMinor, 0))}`,
    );
    const refunded = sales.filter((s) => s.refunded > 0).length;
    const voided = hf.credits.filter((c: Json) => c.state === "voided").length;
    check(
      "one refund by the seller == one voided credit in the ledger",
      refunded === 1 &&
        (o.refund === "after-payout" ? credits.reviewFlags.length === 1 : voided === 1),
      `${refunded} refunded, ${voided} voided, ${credits.reviewFlags.length} flagged`,
    );
    if (disputeId) {
      const d = (salesMock.disputes as Json[]).find((x) => x.id === disputeId);
      const disputed = creators.flatMap((c) =>
        (c.credits as Json[]).filter((x) => x.captureId === d?.captureId),
      );
      const day60Ids = new Set(
        ((day60?.items as Json[] | undefined) ?? []).flatMap((i) => i.creditIds as string[]),
      );
      const releasedIds = new Set(
        ((releaseRun?.items as Json[] | undefined) ?? []).flatMap((i) => i.creditIds as string[]),
      );
      check(
        "dispute: PayPal resolved it for the seller; the ledger released, not voided, its credits",
        d?.status === "RESOLVED" &&
          d?.outcome === "RESOLVED_SELLER_FAVOUR" &&
          disputed.length === frozenIds.length &&
          disputed.every((x) => x.state === "paid" && !x.frozen),
        `${d?.status} ${d?.outcome}; ${disputed.map((x) => x.state).join(", ")}`,
      );
      check(
        "dispute: frozen credits were held out of the day-60 batch and paid in the next",
        frozenIds.length > 0 &&
          frozenIds.every((id) => !day60Ids.has(id) && releasedIds.has(id)) &&
          releasedIds.size === frozenIds.length,
        `${frozenIds.length} frozen, ${releasedIds.size} released`,
      );
    }
    check(
      "every credit ends paid or voided: none left pending or frozen",
      creators.every((c) => c.totals.frozen === 0 && c.totals.pending === 0),
      creators.map((c) => `${c.name} pending ${usd(c.totals.pending)}`).join(", "),
    );
    check(
      "every session purchased",
      [...records.values()].every((r) => r.status === "purchased"),
      `${[...records.values()].filter((r) => r.status === "purchased").length}/${records.size}`,
    );
    check(
      "no credit paid inside its hold",
      hf.credits.every((c: Json) => c.state !== "paid" || c.payoutBatchId),
      "all paid credits carry a batch id",
    );

    const levoitReturned =
      (returned.brands as Json[]).find((b) => b.brandId === "levoit")?.returnedNow ?? 0;
    check(
      "Levoit pays $0 and gets the whole deposit back",
      levoitUnits === 0 && levoitReturned === CARD.deposit,
      `${usd(levoitReturned)} returned`,
    );
    await numbers("checks", { checks });
    for (const c of checks)
      await line("checks", `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
  });

  const returnedMinor =
    (returned.brands as Json[]).find((b) => b.brandId === "winix")?.returnedNow ?? 0;
  const result: DemoResult = {
    numbers: {
      sessions: records.size - cohort.length,
      purchased: [...records.values()].filter(
        (r) => r.status === "purchased" && !cohort.includes(r),
      ).length,
      exposedSales,
      causedUnits,
      creditedMinor,
      paidMinor,
      returnedMinor,
      levoitCausedUnits: levoitUnits,
      liftPoints,
      coExposure: co,
    },
    checks,
    matchesCard: false,
    records: [...records.values()],
  };
  if (fake) {
    const expectPaid =
      o.refund === "before-payout" ? CARD.creditedMinor - voidedMinor : CARD.creditedMinor;
    const cardOk =
      records.size - cohort.length === CARD.sessions &&
      exposedSales === CARD.exposedSales &&
      causedUnits === CARD.causedUnits &&
      creditedMinor === CARD.creditedMinor &&
      levoitUnits === 0 &&
      paidMinor === expectPaid &&
      returnedMinor === CARD.deposit - expectPaid;
    result.matchesCard = cardOk;
    check(
      "numbers match the card (57 → 51 → $391.64; Levoit $0)",
      cardOk,
      `${exposedSales} → ${causedUnits} → ${usd(creditedMinor)}`,
    );
    const { captureId: _id, ...split } = co.splitSale;
    const coOk = JSON.stringify({ ...co, splitSale: split }) === JSON.stringify(COEXPOSURE);
    check(
      "co-exposure and dispute numbers match the pinned demo outputs",
      coOk,
      `${co.causedUnitsBefore} → ${co.causedUnitsAfter} units; split ${usd(split.housefreshMinor)} / ${usd(split.airlabMinor)}`,
    );
  }
  await emit({
    type: "run.end",
    text: checks.every((c) => c.ok) ? "ok" : "failed",
    data: { ...result.numbers, matchesCard: result.matchesCard, checks },
  });
  return result;
}

function sessionData(r: RunRecord): Record<string, unknown> {
  return {
    sessionId: r.sessionId,
    model: r.model,
    arm: r.arm,
    storesViewed: r.storesViewed,
    seller: r.seller,
    sellerName: r.sellerName,
    paidWith: r.paidWith,
    product: r.product?.name ?? null,
    upc: r.product?.upc ?? null,
    totalMinor: r.total?.amountMinor ?? null,
    orderId: r.orderId,
    captureId: r.captureId,
    reason: r.reason,
    status: r.status,
  };
}
