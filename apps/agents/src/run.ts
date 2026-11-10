import type { AgentOutcome, ShopperAgent } from "./agent";
import { FakeAgent, type FakeAgentOptions } from "./fake-agent";
import { LlmAgent, type LlmConfig, llmConfigFromEnv } from "./llm-agent";
import { rngFor } from "./rng";
import { ShopperSession } from "./session";
import { type Endpoints, MODEL_FAMILIES, type ModelFamily, type RunRecord } from "./types";

export const DEFAULT_REQUEST = "Small bedroom purifier, light sleeper, around $100, just buy it";

export interface RunOptions {
  endpoints: Endpoints;
  seed: string;
  runIndex: number;
  family: ModelFamily;
  request?: string;
  /** Default: MODEL_PROVIDER env, else "fake". */
  provider?: "fake" | "openai-compatible";
  llm?: LlmConfig;
  fake?: FakeAgentOptions;
  /** Start the catalogue session co-exposed to a second creator. */
  coExposed?: boolean;
  /** Demo only: fixed catalogue session id. */
  sessionId?: string;
  /** Product category reported to the engine. */
  category?: string;
}

export function providerFromEnv(
  env: Record<string, string | undefined>,
): "fake" | "openai-compatible" {
  return (env.MODEL_PROVIDER ?? "fake") === "fake" ? "fake" : "openai-compatible";
}

function buildAgent(o: RunOptions): {
  agent: ShopperAgent;
  model: string;
  provider: RunRecord["provider"];
} {
  const provider = o.provider ?? providerFromEnv(process.env);
  if (provider === "fake") {
    return { agent: new FakeAgent(o.fake), model: `fake-${o.family}`, provider };
  }
  const cfg = o.llm ?? llmConfigFromEnv(process.env);
  const model = cfg.models[o.family];
  return { agent: new LlmAgent(cfg, model), model, provider };
}

/**
 * Tell the engine this session exists and which arm it got (the catalogue's job in production:
 * lift needs the sessions that bought nothing too). Safe to repeat: the engine upserts.
 */
export async function reportSession(
  ep: Endpoints,
  session: ShopperSession,
  model: string,
  category: string,
): Promise<void> {
  const body = session.passportBody();
  if (!ep.engineUrl || !body) return;
  const f = ep.engineFetch ?? fetch;
  const res = await f(`${ep.engineUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: body.sessionId,
      model,
      arm: body.arm,
      category,
      creatorsSeen: body.creatorsSeen,
      storesViewed: body.storesViewed,
    }),
  });
  if (!res.ok) throw new Error(`engine rejected session ${body.sessionId}: ${res.status}`);
}

/** One shopping session, start to finish, as one structured record. Never throws. */
export async function runSession(o: RunOptions): Promise<RunRecord> {
  const request = o.request ?? DEFAULT_REQUEST;
  const key = `${o.seed}:${o.runIndex}`;
  const { agent, model, provider } = buildAgent(o);
  const session: ShopperSession = new ShopperSession(o.endpoints, key, {
    coExposed: o.coExposed ?? false,
    ...(o.sessionId ? { sessionId: o.sessionId } : {}),
    onPassport: () => reportSession(o.endpoints, session, model, o.category ?? "purifier"),
  });

  let outcome: AgentOutcome = { reason: null, steps: 0 };
  let error: string | undefined;
  try {
    outcome = await agent.run({ request, session, rand: rngFor(key) });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    await session.close();
  }

  const body = session.passportBody();
  const bought = session.purchase;
  const offer = session.lastSearch?.offers.find((o) => o.offerId === bought?.offerId);
  return {
    sessionId: body?.sessionId ?? null,
    runIndex: o.runIndex,
    seed: o.seed,
    request,
    family: o.family,
    model,
    provider,
    arm: body?.arm ?? null,
    creatorsSeen: body?.creatorsSeen ?? [],
    storesViewed: body?.storesViewed ?? [],
    searches: session.searches,
    product: bought
      ? { upc: bought.upc, name: offer ? `${offer.brand} ${offer.name}` : bought.upc }
      : null,
    seller: bought?.seller.id ?? null,
    sellerName: bought?.seller.name ?? null,
    orderId: bought?.orderId ?? null,
    captureId: bought?.captureId ?? null,
    total: bought?.total ?? null,
    paidWith: bought ? "vaulted_paypal" : null,
    passportAttached: session.checkedOutWithPassport,
    reason: outcome.reason,
    status: error ? "error" : bought ? "purchased" : "no_purchase",
    ...(error ? { error } : {}),
  };
}

/** Family for session i: rotates through all three so a run covers every model. */
export function familyFor(i: number, family: ModelFamily | "mix"): ModelFamily {
  return family === "mix" ? (MODEL_FAMILIES[i % MODEL_FAMILIES.length] as ModelFamily) : family;
}

export async function runMany(
  o: Omit<RunOptions, "runIndex" | "family"> & { n: number; family: ModelFamily | "mix" },
  onRecord?: (r: RunRecord) => void,
): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for (let i = 0; i < o.n; i++) {
    const { n: _n, ...rest } = o;
    const r = await runSession({ ...rest, runIndex: i, family: familyFor(i, o.family) });
    out.push(r);
    onRecord?.(r);
  }
  return out;
}
