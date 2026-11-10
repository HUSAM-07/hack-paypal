import {
  type AgentOutcome,
  type CheckoutResult,
  type Endpoints,
  FakeAgent,
  LlmAgent,
  reportSession,
  rngFor,
  type SearchArgs,
  type SearchResult,
  ShopperSession,
} from "@cited/agents";
import { LIVE_CATEGORY, type Money, UPC_LEVOIT_CORE300 } from "@pact/protocol";
import { type PairArm, passportInArm } from "./arms";
import { type LiveAgentChoice, type LiveProviderEnv, liveAgentChoice } from "./provider";
import { type JoinedSale, liveVerdict, type ProgrammeFacts, type Verdict } from "./verdict";

/** One line of the live stream. Every string in it may come from a model or a third party. */
export type LiveEvent =
  | { type: "start"; runId: string; agent: string; scripted: boolean }
  | { type: "thought"; text: string }
  | { type: "search"; query: string; sellerId: string | null }
  | {
      type: "results";
      arm: string | null;
      creatorsSeen: string[];
      offers: { offerId: string; seller: string; product: string; priceMinor: number }[];
      content: { kind: string; creatorId: string; summary: string }[];
    }
  | { type: "checkout"; offerId: string }
  | {
      type: "paid";
      orderId: string;
      captureId: string | null;
      seller: string;
      product: string;
      upc: string;
      total: Money;
      passportChars: number;
    }
  | { type: "joined"; arm: string | null; unattributedReason: string | null }
  | {
      type: "verdict";
      verdict: Verdict;
      reason: string | null;
      creatorNames: Record<string, string>;
    }
  | { type: "error"; message: string }
  | { type: "done" };

export interface LiveRunDeps {
  env: LiveProviderEnv;
  endpoints: Endpoints & { engineUrl: string };
  db: D1Database;
  emit: (e: LiveEvent) => Promise<void> | void;
  runId: string;
  request: string;
  /** Whole-run deadline (ms). */
  timeoutMs?: number;
  /** For tests: skip the gateway/Anthropic choice. */
  choice?: LiveAgentChoice;
  /** How long to wait for the capture webhook to land in D1. */
  joinWaitMs?: number;
  /**
   * The side-by-side on /try fixes each lane's arm instead of drawing it. The real catalogue
   * always draws at random; this only picks which drawn session the lane shops in.
   */
  arm?: PairArm;
  /** Shared by the two lanes of one side-by-side. */
  pairId?: string;
}

export interface LiveRunRecord {
  runId: string;
  source: "live";
  request: string;
  /** Set when /try's side-by-side fixed this run's arm. */
  forcedArm?: PairArm;
  pairId?: string;
  agent: string;
  scripted: boolean;
  sessionId: string | null;
  arm: string | null;
  creatorsSeen: string[];
  storesViewed: string[];
  seller: string | null;
  orderId: string | null;
  captureId: string | null;
  total: Money | null;
  reason: string | null;
  verdict: Verdict | null;
  status: "purchased" | "no_purchase" | "error";
  error?: string;
}

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A ShopperSession that narrates each tool call as it happens. */
class NarratedSession extends ShopperSession {
  constructor(
    ep: Endpoints,
    ref: string,
    private readonly say: LiveRunDeps["emit"],
    onPassport: () => Promise<void>,
  ) {
    super(ep, ref, { onPassport });
  }

  override async search(args: SearchArgs): Promise<SearchResult> {
    await this.say({
      type: "search",
      query: cap(args.query, 120),
      sellerId: args.sellerId ?? null,
    });
    const r = await super.search(args);
    const body = this.passportBody();
    await this.say({
      type: "results",
      arm: body?.arm ?? null,
      creatorsSeen: body?.creatorsSeen ?? [],
      offers: r.offers.map((o) => ({
        offerId: o.offerId,
        seller: o.seller.name,
        product: `${o.brand} ${o.name}`,
        priceMinor: o.price.amountMinor,
      })),
      content: r.creatorContent.map((c) => ({
        kind: c.kind,
        creatorId: c.creatorId,
        summary: cap(c.summary, 280),
      })),
    });
    return r;
  }

  override async checkout(offerId: string): Promise<CheckoutResult> {
    await this.say({ type: "checkout", offerId: cap(offerId, 64) });
    const r = await super.checkout(offerId);
    const offer = this.lastSearch?.offers.find((o) => o.offerId === r.offerId);
    await this.say({
      type: "paid",
      orderId: r.orderId,
      captureId: r.captureId,
      seller: r.seller.name,
      product: offer ? `${offer.brand} ${offer.name}` : r.upc,
      upc: r.upc,
      total: r.total,
      passportChars: r.customId?.length ?? 0,
    });
    return r;
  }
}

type Row = Record<string, unknown>;

/** The webhook join runs inside the demo object; wait briefly for its row to land. */
async function joinedSale(
  db: D1Database,
  captureId: string,
  orderId: string,
  waitMs: number,
): Promise<JoinedSale | null> {
  const until = Date.now() + waitMs;
  for (;;) {
    const r = await db
      // Both ids: a row with this capture id but another order is someone else's sale.
      .prepare("SELECT * FROM sales WHERE capture_id = ? AND order_id = ? ORDER BY upc LIMIT 1")
      .bind(captureId, orderId)
      .first<Row>();
    if (r) {
      return {
        upc: r.upc as string,
        amount: { amountMinor: r.amount_minor as number, currency: r.currency as string },
        arm: (r.arm as JoinedSale["arm"]) ?? null,
        creatorsSeen: JSON.parse((r.creators_seen as string) ?? "[]") as string[],
        capturedAt: r.captured_at as string,
        unattributedReason: (r.unattributed_reason as string) ?? null,
      };
    }
    if (Date.now() >= until) return null;
    await new Promise((res) => setTimeout(res, 250));
  }
}

/** The funded brand for a SKU, and the lift its programme has measured (from the engine). */
async function programmeFor(deps: LiveRunDeps, upc: string): Promise<ProgrammeFacts> {
  const b = await deps.db
    .prepare("SELECT brand_id, name FROM brands WHERE upc = ? ORDER BY brand_id LIMIT 1")
    .bind(upc)
    .first<{ brand_id: string; name: string }>();
  if (!b) return { brand: null, causedUnits: 0 };
  const f = deps.endpoints.engineFetch ?? fetch;
  const res = await f(`${deps.endpoints.engineUrl}/api/lift/${encodeURIComponent(b.brand_id)}`);
  const lift = res.ok ? ((await res.json()) as { causedUnits?: number }) : {};
  return { brand: { brandId: b.brand_id, name: b.name }, causedUnits: lift.causedUnits ?? 0 };
}

async function creatorNames(db: D1Database, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const r = await db
      .prepare("SELECT name FROM creators WHERE creator_id = ?")
      .bind(id)
      .first<{ name: string }>();
    out[id] = r?.name ?? id;
  }
  return out;
}

/**
 * One live shopping session: a real model (or the labelled scripted agent) searches the
 * catalogue, gets its arm by the normal schedule, pays a seller through PayPal, and the engine
 * joins the capture. The session is reported under LIVE_CATEGORY, so it never moves the
 * programme's lift, ledger or journeys; the verdict applies the ledger's rules to this one sale.
 */
export async function runLive(deps: LiveRunDeps): Promise<LiveRunRecord> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), deps.timeoutMs ?? 75_000);
  const choice = deps.choice ?? liveAgentChoice(deps.env, abort.signal);
  const scripted = choice.kind === "scripted";
  const emit = async (e: LiveEvent) => {
    try {
      await deps.emit(e);
    } catch {
      // The viewer left; the run still finishes and is recorded.
    }
  };
  await emit({ type: "start", runId: deps.runId, agent: choice.label, scripted });

  const session: NarratedSession = new NarratedSession(deps.endpoints, deps.runId, emit, () =>
    reportSession(deps.endpoints, session, choice.model, LIVE_CATEGORY),
  );
  // Scripted and held out, the stand-in takes the Levoit, so the scripted pair still contrasts
  // with the test lane, which reads the test and takes the Winix.
  const agent =
    choice.kind === "scripted"
      ? new FakeAgent(deps.arm === "none" ? { baselineUpc: UPC_LEVOIT_CORE300 } : {})
      : new LlmAgent(choice.llm, choice.model);

  let outcome: AgentOutcome = { reason: null, steps: 0 };
  let error: string | undefined;
  const deadline = new Promise<never>((_, rej) =>
    abort.signal.addEventListener("abort", () => rej(new Error("the run hit its time limit"))),
  );
  try {
    if (deps.arm) {
      const prefix = deps.runId.replace(/[^A-Za-z0-9]/g, "").slice(-14);
      session.passport = await Promise.race([
        passportInArm(deps.endpoints, deps.arm, prefix),
        deadline,
      ]);
    }
    outcome = await Promise.race([
      agent.run({
        request: deps.request,
        session,
        rand: rngFor(deps.runId),
        onThought: (t) => void emit({ type: "thought", text: cap(t, 600) }),
      }),
      deadline,
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
    await session.close();
  }

  const body = session.passportBody();
  const bought = session.purchase;
  let verdict: Verdict | null = null;
  if (bought?.captureId) {
    const sale = await joinedSale(
      deps.db,
      bought.captureId,
      bought.orderId,
      deps.joinWaitMs ?? 4000,
    );
    await emit({
      type: "joined",
      arm: sale?.arm ?? null,
      unattributedReason: sale ? sale.unattributedReason : "capture_not_received",
    });
    verdict = liveVerdict(
      sale,
      sale ? await programmeFor(deps, sale.upc) : { brand: null, causedUnits: 0 },
    );
    await emit({
      type: "verdict",
      verdict,
      reason: outcome.reason ? cap(outcome.reason, 400) : null,
      creatorNames: await creatorNames(
        deps.db,
        verdict.credits.map((c) => c.creatorId),
      ),
    });
  }
  // Model and gateway errors stay server-side; the viewer gets a plain sentence.
  if (error) {
    console.error("live run failed", deps.runId, error.slice(0, 200));
    await emit({
      type: "error",
      message: bought
        ? "The agent paid, then stopped early."
        : /could not fix/.test(error)
          ? "The catalogue didn't give this lane the arm it needs."
          : /time limit/.test(error)
            ? "The agent ran out of time before buying anything."
            : "The agent stopped with an error before buying anything.",
    });
  } else if (!bought) {
    await emit({ type: "error", message: "The agent finished without buying anything." });
  }
  await emit({ type: "done" });

  return {
    runId: deps.runId,
    source: "live",
    request: deps.request,
    ...(deps.arm ? { forcedArm: deps.arm } : {}),
    ...(deps.pairId ? { pairId: deps.pairId } : {}),
    agent: choice.label,
    scripted,
    sessionId: body?.sessionId ?? null,
    arm: body?.arm ?? null,
    creatorsSeen: body?.creatorsSeen ?? [],
    storesViewed: body?.storesViewed ?? [],
    seller: bought?.seller.id ?? null,
    orderId: bought?.orderId ?? null,
    captureId: bought?.captureId ?? null,
    total: bought?.total ?? null,
    reason: outcome.reason,
    verdict,
    status: bought ? "purchased" : error ? "error" : "no_purchase",
    ...(error ? { error: error.slice(0, 300) } : {}),
  };
}
