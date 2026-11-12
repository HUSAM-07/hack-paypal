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
import {
  type Arm,
  batchesTotal,
  brandAddsUp,
  DEMO_SHOP_PRICES,
  HEADPHONE_SHOP_PRICES,
  paidInLedger,
  paidWithoutBatch,
  UPC_BOSE_QC,
  UPC_LEVOIT_CORE300,
  UPC_ROBOROCK_Q7MAX,
  UPC_ROOMBA_J5,
  UPC_SONY_XM5,
  UPC_WINIX_A230,
  VACUUM_SHOP_PRICES,
} from "@pact/protocol";
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
  "guard",
  "categories",
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
  /**
   * Wait at the Analyst beat for Maya to approve the top-up in AG Studio (/studio) instead of
   * approving it from the script. For recording the dashboards; gives up after this many ms.
   */
  approveInStudioMs?: number;
  /**
   * Bearer token for a hosted engine's writes and the catalogue's demo controls (the worker's
   * CITED_API_TOKEN). Local stacks run keyless and leave it unset.
   */
  apiToken?: string | undefined;
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
    /** The guard beat: a creator buys through their own PayPal; the credit is held. */
    guard: GuardNumbers;
    /** The categories beat: robot vacuums and headphones, each a funded programme of its own. */
    categories: CategoryNumbers[];
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

export interface GuardNumbers {
  captureId: string;
  /** The PayPal payer id PayPal reports for the sale: the creator's own account. */
  payerId: string;
  heldMinor: number;
  holdReasons: string[];
  /** The study before and after the self-purchase: it must not move. */
  exposedSales: [number, number];
  causedUnits: [number, number];
}

/** What the guard beat must reproduce under the fake provider (seed cited-demo). */
export const GUARD = { payerId: "HOUSEFRESH-PP", heldMinor: 768, holdReasons: ["self_purchase"] };

/**
 * The categories beat: the same pipeline in two more categories, played after every purifier beat
 * so no purifier number moves. Each is a funded programme (the brand of the creator's tested
 * product) with its own creator and a smaller study than the purifier card's. Under the fake
 * provider the test arm buys the creator's pick and the other arms mostly buy the rival, so the
 * measured lift is positive. The study is sized so the whole demo stays under the 200 sales one
 * read of the engine's journeys returns (the ledger page skips its sales check beyond that).
 */
export interface CategoryStudy {
  category: string;
  brandId: string;
  brand: string;
  upc: string;
  rivalUpc: string;
  /** What the agents search for; the catalogue routes it to the category. */
  query: string;
  request: string;
  creator: { creatorId: string; name: string; paypalId: string };
  prices: Record<string, Record<string, number>>;
  /** Suffix of the probed session ids, so the two categories never share one. */
  tag: string;
}

export const CATEGORY_STUDIES: CategoryStudy[] = [
  {
    category: "robot-vacuum",
    brandId: "roborock",
    brand: "Roborock",
    upc: UPC_ROBOROCK_Q7MAX,
    rivalUpc: UPC_ROOMBA_J5,
    query: "robot vacuum",
    request: "Robot vacuum for a small apartment with pets, under $350, just buy it",
    creator: { creatorId: "crumblab", name: "CrumbLab", paypalId: "CRUMBLAB-PP" },
    prices: VACUUM_SHOP_PRICES,
    tag: "v",
  },
  {
    category: "headphones",
    brandId: "bose",
    brand: "Bose",
    upc: UPC_BOSE_QC,
    rivalUpc: UPC_SONY_XM5,
    query: "noise-cancelling headphones",
    request: "Noise-cancelling headphones for a noisy commute and calls, under $400, just buy it",
    creator: { creatorId: "quietbench", name: "QuietBench", paypalId: "QUIETBENCH-PP" },
    prices: HEADPHONE_SHOP_PRICES,
    tag: "h",
  },
];

/** Sessions per model in each category's study, in MODEL_FAMILIES order. */
export const CATEGORY_PLAN = {
  exposed: [2, 2, 2],
  placebo: [2, 2, 2],
  none: [1, 1, 1],
  /** Placebo sessions that buy the creator's pick anyway. */
  placeboTested: [1, 0, 0],
  /** Held-out sessions that buy the creator's pick anyway. */
  noneTested: [0, 1, 0],
};

export interface CategoryNumbers {
  category: string;
  brandId: string;
  creatorId: string;
  sessions: number;
  testedBuyers: Record<Arm, number>;
  exposedSales: number;
  causedUnits: number;
  liftPoints: number;
  depositMinor: number;
  /** Credited to the creator and still pending: the beat pays nothing. */
  pendingMinor: number;
}

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

  // A hosted engine locks its writes (and the catalogue its demo controls) behind this token.
  const auth: Record<string, string> = o.apiToken ? { authorization: `Bearer ${o.apiToken}` } : {};
  const headersFor = (body: unknown) => ({
    ...auth,
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  });
  const eng = async (method: "GET" | "POST", path: string, body?: unknown): Promise<Json> => {
    const res = await fetch(`${o.engineUrl}/api${path}`, {
      method,
      headers: headersFor(body),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
      headers: headersFor(body),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as Json;
    if (!res.ok) throw new Error(`catalogue ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  };

  const ep: Endpoints = {
    catalogueUrl: o.catalogueUrl,
    engineUrl: o.engineUrl,
    // Each session is reported to the engine's write API, so it carries the token too.
    ...(o.apiToken
      ? {
          engineFetch: (input: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            headers.set("authorization", `Bearer ${o.apiToken}`);
            return fetch(input, { ...init, headers });
          },
        }
      : {}),
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
    const statements = (returned.statements ?? []) as Json[];
    await numbers("return", {
      statements: statements.map((x) => ({
        brandId: x.brandId,
        invoiceNumber: x.invoiceNumber,
        invoiceId: x.invoiceId,
        status: x.status,
        creditedMinor: x.creditedMinor,
        voidedMinor: x.voidedMinor,
        paidMinor: x.paidMinor,
        returnedMinor: x.returnedMinor,
        depositedMinor: x.depositedMinor,
        invoiceDueMinor: x.invoiceDueMinor,
      })),
    });
    for (const x of statements) {
      const who = x.brandId === "winix" ? "Winix" : "Levoit";
      await line(
        "return",
        x.invoiceId
          ? `${who}'s statement through PayPal Invoicing (${x.invoiceNumber}, ${x.invoiceId}): ${usd(x.creditedMinor)} credited − ${usd(x.voidedMinor)} voided = ${usd(x.paidMinor)} paid to creators; ${usd(x.returnedMinor)} of the ${usd(x.depositedMinor)} deposit returned. Marked paid against the deposit: ${x.status}, ${usd(x.invoiceDueMinor ?? 0)} due.`
          : `${who}'s statement: nothing paid, so no PayPal invoice (${x.status}); ${usd(x.returnedMinor)} of the ${usd(x.depositedMinor)} deposit returned.`,
        { invoiceNumber: x.invoiceNumber, invoiceId: x.invoiceId, status: x.status },
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
    if (o.approveInStudioMs) {
      await line("analyst", "Waiting for Maya to approve the top-up in AG Studio (/studio)…");
      const deadline = Date.now() + o.approveInStudioMs;
      let topUp: Json | undefined;
      while (!topUp) {
        const d = await eng("GET", "/deposits");
        const winix = (d.brands as Json[]).find((b) => b.brandId === "winix");
        topUp = (winix?.deposits as Json[] | undefined)?.find(
          (x) => x.kind !== "initial" && x.status === "captured",
        );
        if (topUp) break;
        if (Date.now() > deadline)
          throw new Error("nobody approved the top-up in AG Studio in time");
        await new Promise((r) => setTimeout(r, 1000));
      }
      await line(
        "analyst",
        `Maya approves in AG Studio: Winix adds ${usd(topUp.amountMinor as number)} to the programme (capture ${String(topUp.captureId)}). Money buys honest tests, never a better spot.`,
        { approval: "analyst-1", brandId: "winix", amountMinor: topUp.amountMinor },
      );
    } else {
      const top = await eng("POST", "/approvals/analyst-1/approve", {
        brandId: "winix",
        amountMinor: 50_000,
      });
      await line(
        "analyst",
        `Maya approves: Winix adds ${usd(50_000)} to the programme (scripted amount; capture ${top.captureId}). Money buys honest tests, never a better spot.`,
        { approval: "analyst-1", brandId: "winix", amountMinor: 50_000 },
      );
    }
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

  // ── The guard: a creator cannot pay themselves through their own agent or wallet ──
  const guardRecords: RunRecord[] = [];
  const gd: GuardNumbers = {
    captureId: "",
    payerId: "",
    heldMinor: 0,
    holdReasons: [],
    exposedSales: [0, 0],
    causedUnits: [0, 0],
  };
  let guardRun: Json | undefined;
  await beat(
    "guard",
    "A creator buys through their own PayPal: the credit is held for review",
    async () => {
      let id = "";
      for (let n = 0; !id; n++) {
        if (n > 5_000) throw new Error("could not find an exposed session id for the guard beat");
        const probe = new ShopperSession(ep, `probe-${t}-self-${n}`, {
          sessionId: `${t}-self-${n.toString(36)}`,
        });
        try {
          await probe.search({ query: "air purifier" });
        } finally {
          await probe.close();
        }
        if (probe.passportBody()?.arm === "test") id = probe.passportBody()?.sessionId as string;
      }
      const before = await eng("GET", "/lift/winix");
      // A co-conspirator's agent, paying from the PayPal account HouseFresh is paid into.
      await cat("POST", "/mock/buyers", { sessionId: id, payerId: "HOUSEFRESH-PP" });
      const r = await play({
        id,
        arm: "test",
        model: "gpt",
        index: 0,
        buysWinix: true,
        browse: "lumen",
      });
      guardRecords.push(r);
      await eng("POST", "/credits/recompute");
      const after = await eng("GET", "/lift/winix");
      gd.captureId = r.captureId ?? "";
      gd.exposedSales = [before.exposedSales, after.exposedSales];
      gd.causedUnits = [before.causedUnits, after.causedUnits];
      const mine = hfOf(await eng("GET", "/credits")).credits.filter(
        (c: Json) => c.captureId === gd.captureId,
      ) as Json[];
      gd.heldMinor = mine.filter((c) => c.held).reduce((a, c) => a + c.amountMinor, 0);
      gd.holdReasons = [...new Set(mine.flatMap((c) => c.holdReasons as string[]))].sort();
      gd.payerId =
        ((await cat("GET", "/mock/state")).captures as Json[]).find((c) => c.id === gd.captureId)
          ?.payerId ?? "";
      await line(
        "guard",
        `A co-conspirator's ${r.model} agent is shown HouseFresh's test and buys a Winix for ${usd(r.total?.amountMinor ?? 0)}, paid from HouseFresh's own PayPal (payer ${gd.payerId}, capture ${gd.captureId}). The buyer is the creator, so the session is kept out of the study: still ${after.causedUnits} caused units over ${after.exposedSales} exposed sales. The ${usd(gd.heldMinor)} credit is held for review: ${gd.holdReasons.join(", ").replace(/_/g, "-")}.`,
        { sessionId: id, ...gd },
      );
      const jump = await eng("POST", "/clock/advance", { days: 30 });
      guardRun = jump.payout as Json;
      await numbers("guard", {
        ...gd,
        payout: { status: guardRun?.status, held: guardRun?.held },
      });
      await line(
        "guard",
        `Day 90: its 30-day hold is over, and the payout run still pays nothing (${guardRun?.status}): held credits are never paid automatically. A reviewer releases or voids it (POST /review-flags/:id/release or /void, behind the API token). Repeat buyers, sudden spikes in a creator's sales and buyers who refund most of what they buy are held the same way.`,
      );
    },
  );

  // ── Two more categories: robot vacuums and headphones are funded programmes too ──
  const categoryRecords: RunRecord[] = [];
  const categoryNumbers: CategoryNumbers[] = [];
  /** The purifier numbers before and after the beat: it must not move any. */
  const purifierBefore: Json = {};
  const purifierAfter: Json = {};
  await beat(
    "categories",
    "Roborock and Bose fund robot-vacuum and headphone programmes: a /try purchase can be credited",
    async () => {
      const snapshot = async (into: Json) => {
        const w = await eng("GET", "/lift/winix");
        const l = await eng("GET", "/lift/levoit");
        const c = await eng("GET", "/credits");
        const guarded = await eng("GET", "/review-flags");
        into.winix = [w.exposedSales, w.causedUnits];
        into.levoit = l.causedUnits;
        into.housefresh = hfOf(c).totals;
        into.airlab = (c.creators as Json[]).find((x) => x.creatorId === "airlab")?.totals;
        into.paid = paidInLedger(c.creators as Json[]);
        into.openFlags = (guarded.flags as Json[]).filter((f) => f.status === "open").length;
      };
      await snapshot(purifierBefore);

      for (const st of CATEGORY_STUDIES) {
        await eng("POST", "/brands", {
          brandId: st.brandId,
          name: st.brand,
          category: st.category,
          upc: st.upc,
        });
        await eng("POST", "/creators", st.creator);
      }
      await eng("POST", "/listings", {
        listings: CATEGORY_STUDIES.flatMap((st) =>
          Object.entries(st.prices).flatMap(([shopId, byUpc]) =>
            Object.entries(byUpc).map(([upc, priceMinor]) => ({
              shopId,
              upc,
              priceMinor,
              currency: "USD",
            })),
          ),
        ),
      });
      for (const st of CATEGORY_STUDIES) {
        const d = await eng("POST", `/brands/${st.brandId}/deposits`, {
          amountMinor: CARD.deposit,
        });
        await line(
          "categories",
          `${st.brand} deposits ${usd(CARD.deposit)} into the ${st.category.replace("-", " ")} programme (Orders v2 capture ${d.captureId}), and ${st.creator.name} registers. Until now a /try purchase of the ${st.brand} was never credited: no brand funded it.`,
          { brandId: st.brandId, amountMinor: CARD.deposit, captureId: d.captureId },
        );
      }

      const slotsOf = (pool: Record<Arm, string[]>): Slot[] => {
        const out: Slot[] = [];
        const counts: Record<Arm, number[]> = {
          test: CATEGORY_PLAN.exposed,
          placebo: CATEGORY_PLAN.placebo,
          none: CATEGORY_PLAN.none,
        };
        const at: Record<Arm, number> = { test: 0, placebo: 0, none: 0 };
        const rounds = Math.max(
          ...CATEGORY_PLAN.exposed,
          ...CATEGORY_PLAN.placebo,
          ...CATEGORY_PLAN.none,
        );
        for (let i = 0; i < rounds; i++) {
          MODEL_FAMILIES.forEach((model, m) => {
            for (const arm of ["test", "placebo", "none"] as const) {
              const total = counts[arm][m] as number;
              if (i >= total) continue;
              const tested =
                arm === "placebo"
                  ? CATEGORY_PLAN.placeboTested[m]
                  : arm === "none"
                    ? CATEGORY_PLAN.noneTested[m]
                    : total;
              out.push({
                id: pool[arm][at[arm]++] as string,
                arm,
                model,
                index: i,
                buysWinix: arm === "test" ? true : i >= total - (tested as number),
                // Never Northwind: the exposed purifier hero (read Northwind, paid Lumen) stays
                // the console's pair.
                browse: (["lumen", "megamart"] as const)[(i + m) % 2] as string,
              });
            }
          });
        }
        return out;
      };

      for (const st of CATEGORY_STUDIES) {
        // A later cycle: the catalogue's steady-state schedule leaves few placebo and held-out
        // draws, so the ids are probed (free: the catalogue is stateless) until every arm is full.
        const need: Record<Arm, number> = {
          test: CATEGORY_PLAN.exposed.reduce((a, b) => a + b, 0),
          placebo: CATEGORY_PLAN.placebo.reduce((a, b) => a + b, 0),
          none: CATEGORY_PLAN.none.reduce((a, b) => a + b, 0),
        };
        const pool: Record<Arm, string[]> = { test: [], placebo: [], none: [] };
        for (
          let n = 0;
          pool.test.length < need.test ||
          pool.placebo.length < need.placebo ||
          pool.none.length < need.none;
          n++
        ) {
          if (n > 20_000)
            throw new Error(`could not find session ids for every ${st.category} arm`);
          const id = `${t}-${st.tag}-${n.toString(36)}`;
          const probe = new ShopperSession(ep, `probe-${id}`, { sessionId: id });
          try {
            await probe.search({ query: st.query });
          } finally {
            await probe.close();
          }
          const arm = probe.passportBody()?.arm;
          if (arm && pool[arm].length < need[arm]) pool[arm].push(id);
        }
        const mine: RunRecord[] = [];
        for (const s of slotsOf(pool)) {
          const r = await runSession({
            endpoints: ep,
            seed: o.seed,
            runIndex: records.size,
            family: s.model,
            provider: o.provider,
            request: st.request,
            sessionId: s.id,
            category: st.category,
            fake: {
              browseSeller: s.browse,
              loyalty: 0,
              query: st.query,
              ...(s.arm === "test" ? {} : { baselineUpc: s.buysWinix ? st.upc : st.rivalUpc }),
            },
          });
          if (r.status === "error") throw new Error(`session ${s.id} failed: ${r.error}`);
          records.set(s.id, r);
          categoryRecords.push(r);
          mine.push(r);
          await emit({ type: "session", data: sessionData(r) });
        }
        const bought = (arm: Arm) =>
          mine.filter((r) => r.arm === arm && r.product?.upc === st.upc).length;
        const n = (arm: Arm) => mine.filter((r) => r.arm === arm).length;
        await line(
          "categories",
          `${st.brand} study (${mine.length} sessions, three models): shown ${st.creator.name}'s test ${bought("test")}/${n("test")} buy the ${st.brand}; shown its placebo ${bought("placebo")}/${n("placebo")}; held out ${bought("none")}/${n("none")}.`,
          {
            category: st.category,
            test: bought("test"),
            placebo: bought("placebo"),
            none: bought("none"),
          },
        );
        categoryNumbers.push({
          category: st.category,
          brandId: st.brandId,
          creatorId: st.creator.creatorId,
          sessions: mine.length,
          testedBuyers: { test: bought("test"), placebo: bought("placebo"), none: bought("none") },
          exposedSales: 0,
          causedUnits: 0,
          liftPoints: 0,
          depositMinor: CARD.deposit,
          pendingMinor: 0,
        });
      }

      await eng("POST", "/credits/recompute");
      const allCredits = await eng("GET", "/credits");
      for (const cn of categoryNumbers) {
        const lift = await eng("GET", `/lift/${cn.brandId}`);
        const mineCredits = (
          (allCredits.creators as Json[]).find((c) => c.creatorId === cn.creatorId)?.credits as
            | Json[]
            | undefined
        )?.filter((c) => c.state === "pending");
        cn.exposedSales = lift.exposedSales;
        cn.causedUnits = lift.causedUnits;
        cn.liftPoints = Math.round(lift.lift * 100);
        cn.pendingMinor = (mineCredits ?? []).reduce((a, c) => a + c.amountMinor, 0);
        const st = CATEGORY_STUDIES.find((x) => x.brandId === cn.brandId) as CategoryStudy;
        await line(
          "categories",
          `${st.brand}: ${cn.exposedSales} exposed sales → ${cn.causedUnits} caused units (lift +${cn.liftPoints} points) → ${usd(cn.pendingMinor)} credited to ${st.creator.name}, pending: the 30-day hold has not ended, so nothing is paid. A test-arm /try purchase of the ${st.brand} now earns its creator a credit.`,
          { ...cn },
        );
      }
      await snapshot(purifierAfter);
      await numbers("categories", { categories: categoryNumbers });
      await line(
        "categories",
        "No purifier number moved: Winix, Levoit, HouseFresh and AirLab are exactly as they were before this beat.",
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
    const ledgerPaid = paidInLedger(creators);
    const itemsOf = (b: Json) => b.items as Json[];
    const mockBatchTotal = batchesTotal(mock.batches as Json[]);
    check(
      "payouts: ledger paid == PayPal batch totals",
      ledgerPaid === mockBatchTotal && mock.batches.length === payouts.batches.length,
      `ledger ${usd(ledgerPaid)}, PayPal ${usd(mockBatchTotal)} in ${mock.batches.length} batches`,
    );
    const receivers: Record<string, string> = {
      housefresh: "HOUSEFRESH-PP",
      airlab: "AIRLAB-PP",
      crumblab: "CRUMBLAB-PP",
      quietbench: "QUIETBENCH-PP",
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
        brandAddsUp(b),
        `${usd(b.deposited)}`,
      );
    }
    // Brand statements (PayPal Invoicing): the invoice states the ledger, to the cent, and is
    // settled from the deposit, so no money moves twice.
    const stmts = ((await eng("GET", "/invoices")).statements ?? []) as Json[];
    const invoicesMock = new Map<string, Json>(
      ((mock.invoices ?? []) as Json[]).map((x) => [x.id as string, x]),
    );
    const closed = ((returned.brands ?? []) as Json[]).filter(
      (b) => b.spent > 0 || b.returnedNow > 0,
    );
    check(
      "statements: one per brand at cycle close",
      closed.every((b) => stmts.some((x) => x.brandId === b.brandId)),
      `${stmts.length} statements for ${closed.length} closed brands`,
    );
    for (const x of stmts) {
      const atClose = ((returned.brands ?? []) as Json[]).find((b) => b.brandId === x.brandId);
      const inv = invoicesMock.get(x.invoiceId as string);
      const ledgerOk =
        x.creditedMinor - x.voidedMinor === x.paidMinor &&
        x.paidMinor === atClose?.spent &&
        x.returnedMinor === atClose?.returnedNow &&
        x.paidMinor + x.returnedMinor + (atClose?.reserved ?? 0) === x.depositedMinor;
      check(
        `${x.brandId}: statement credited − voided == paid, paid + returned == deposit`,
        ledgerOk,
        `${usd(x.creditedMinor)} − ${usd(x.voidedMinor)} = ${usd(x.paidMinor)}; ${usd(x.paidMinor)} + ${usd(x.returnedMinor)} of ${usd(x.depositedMinor)}`,
      );
      if (x.paidMinor === 0) {
        check(
          `${x.brandId}: nothing paid, no PayPal invoice`,
          x.invoiceId === null && x.status === "NO_CHARGE",
          `${x.status}`,
        );
        continue;
      }
      check(
        `${x.brandId}: PayPal invoice total == ledger paid, marked paid, $0 due`,
        inv?.amount.amountMinor === x.paidMinor &&
          inv?.discount.amountMinor === x.voidedMinor &&
          inv?.paid.amountMinor === x.paidMinor &&
          inv?.status === "MARKED_AS_PAID" &&
          x.status === "MARKED_AS_PAID" &&
          x.invoiceDueMinor === 0,
        `${x.invoiceId} ${inv?.status}: ${usd(inv?.amount.amountMinor ?? 0)} invoiced, ${usd(inv?.paid.amountMinor ?? 0)} recorded vs ledger ${usd(x.paidMinor)}`,
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
    const refundFlags = (credits.reviewFlags as Json[]).filter((f) => !f.hold);
    check(
      "one refund by the seller == one voided credit in the ledger",
      refunded === 1 && (o.refund === "after-payout" ? refundFlags.length === 1 : voided === 1),
      `${refunded} refunded, ${voided} voided, ${refundFlags.length} flagged`,
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
    // The purifier cycle ends with nothing pending but the held credit. The categories beat runs
    // after it and leaves its creators' credits pending on purpose (their holds have not ended).
    const categoryCreators = new Set(CATEGORY_STUDIES.map((x) => x.creator.creatorId));
    const purifierCreators = creators.filter((c) => !categoryCreators.has(c.creatorId));
    check(
      "every credit ends paid or voided, but the one held for review: none left pending or frozen",
      purifierCreators.every((c) => c.totals.frozen === 0 && c.totals.pending === c.totals.held),
      purifierCreators
        .map((c) => `${c.name} pending ${usd(c.totals.pending)} (held ${usd(c.totals.held)})`)
        .join(", "),
    );
    {
      const batchedIds = new Set(
        (payouts.batches as Json[]).flatMap((b) =>
          (b.items as Json[]).flatMap((i) => (i.creditIds as string[] | undefined) ?? []),
        ),
      );
      for (const st of CATEGORY_STUDIES) {
        const cn = categoryNumbers.find((x) => x.brandId === st.brandId);
        const mine = creators
          .filter((c) => c.creatorId === st.creator.creatorId)
          .flatMap((c) => c.credits as Json[]);
        const brand = (deposits.brands as Json[]).find((b) => b.brandId === st.brandId);
        check(
          `${st.brand}: funded, and the test caused units, so a test-arm sale is credited`,
          (cn?.causedUnits ?? 0) > 0 && (brand?.deposited ?? 0) === CARD.deposit,
          `${usd(brand?.deposited ?? 0)} deposited, ${cn?.exposedSales} exposed sales → ${cn?.causedUnits} caused units`,
        );
        check(
          `${st.creator.name}: credits are pending, unpaid and in no PayPal batch`,
          mine.length > 0 &&
            mine.every(
              (x) =>
                x.state === "pending" &&
                !x.frozen &&
                !x.payoutBatchId &&
                !batchedIds.has(x.id) &&
                x.amountMinor > 0,
            ),
          `${mine.length} credits, ${usd(mine.reduce((a, x) => a + x.amountMinor, 0))} pending`,
        );
      }
      const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      check(
        "the new programmes move no purifier number",
        sameJson(purifierBefore, purifierAfter),
        `winix ${purifierAfter.winix?.join(" → ")}, levoit ${purifierAfter.levoit}, ${purifierAfter.openFlags} open flag, ${usd(purifierAfter.paid)} paid`,
      );
    }
    if (guardRecords.length) {
      const batchedIds = new Set(
        (payouts.batches as Json[]).flatMap((b) =>
          (b.items as Json[]).flatMap((i) => (i.creditIds as string[] | undefined) ?? []),
        ),
      );
      const heldCredits = creators.flatMap((c) =>
        (c.credits as Json[]).filter((x) => x.captureId === gd.captureId),
      );
      const selfSale = sales.find((x) => x.id === gd.captureId);
      check(
        "guard: PayPal shows the self-purchase paid from the creator's own PayPal",
        selfSale?.payerId === "HOUSEFRESH-PP" && gd.payerId === "HOUSEFRESH-PP",
        `payer ${selfSale?.payerId}`,
      );
      check(
        "guard: the self-purchase credit is held for review and in no PayPal batch",
        heldCredits.length > 0 &&
          heldCredits.every(
            (x) =>
              x.state === "pending" &&
              x.held &&
              (x.holdReasons as string[]).includes("self_purchase") &&
              !x.payoutBatchId &&
              !batchedIds.has(x.id),
          ) &&
          guardRun?.status === "nothing_due" &&
          heldCredits.every((x) =>
            ((guardRun?.held as Json[] | undefined) ?? []).some((h) => h.creditId === x.id),
          ),
        `${heldCredits.length} credit, ${usd(gd.heldMinor)} held; payout run ${guardRun?.status}`,
      );
      check(
        "guard: the self-purchase moves no study number",
        gd.exposedSales[0] === gd.exposedSales[1] && gd.causedUnits[0] === gd.causedUnits[1],
        `${gd.exposedSales.join(" → ")} exposed sales, ${gd.causedUnits.join(" → ")} caused units`,
      );
    }
    check(
      "every session purchased",
      [...records.values()].every((r) => r.status === "purchased"),
      `${[...records.values()].filter((r) => r.status === "purchased").length}/${records.size}`,
    );
    check(
      "no credit paid inside its hold",
      paidWithoutBatch(hf.credits).length === 0,
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
      sessions: records.size - cohort.length - guardRecords.length - categoryRecords.length,
      purchased: [...records.values()].filter(
        (r) =>
          r.status === "purchased" &&
          !cohort.includes(r) &&
          !guardRecords.includes(r) &&
          !categoryRecords.includes(r),
      ).length,
      exposedSales,
      causedUnits,
      creditedMinor,
      paidMinor,
      returnedMinor,
      levoitCausedUnits: levoitUnits,
      liftPoints,
      coExposure: co,
      guard: gd,
      categories: categoryNumbers,
    },
    checks,
    matchesCard: false,
    records: [...records.values()],
  };
  if (fake) {
    const expectPaid =
      o.refund === "before-payout" ? CARD.creditedMinor - voidedMinor : CARD.creditedMinor;
    const cardOk =
      records.size - cohort.length - guardRecords.length - categoryRecords.length ===
        CARD.sessions &&
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
    const guardOk =
      gd.payerId === GUARD.payerId &&
      gd.heldMinor === GUARD.heldMinor &&
      JSON.stringify(gd.holdReasons) === JSON.stringify(GUARD.holdReasons) &&
      gd.causedUnits[1] === COEXPOSURE.causedUnitsAfter;
    check(
      "guard: held self-purchase matches the pinned demo outputs",
      guardOk,
      `${usd(gd.heldMinor)} held (${gd.holdReasons.join(", ")}); ${gd.causedUnits[1]} caused units`,
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
