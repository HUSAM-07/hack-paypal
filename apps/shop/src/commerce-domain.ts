/**
 * The real product domain: `@shop/commerce` behind the App Server's `ShopDomain` seam.
 *
 * Builds `CommerceDeps` from the agent's env (Exa, PayPal sandbox or the shop simulator,
 * Browser Run and KV when bound) and adapts commerce's tools, actions and scheduled tasks to the
 * harness: tool contexts become `ShopContext`s, approval answers are handed back to the tool, and
 * commerce's per-task schedules map onto Agents SDK schedule ids.
 */
import { createPayPalFromEnv, type KeyValueStore, type PayPalModeEnv } from "@pact/paypal";
import type { ApprovalKind } from "@shop/agent-protocol";
import {
  type BrowserRunClient,
  type CommerceDeps,
  createBrowserRunRestClient,
  createExaClient,
  createShopDomain,
  createShopPayPalSim,
  type ExaClient,
  initialPrivateState,
  type PrivateState,
  paypalSellerSource,
  randomIds,
  type ScheduledTask,
  type ScheduleOutcome,
  type ShopContext,
  ShopError,
  type ShopState,
  ShopState as ShopStateSchema,
  systemClock,
  type ToolName,
} from "@shop/commerce";
import { type AnyTool, type ApprovalSpec, defineTool, type ToolContext } from "@shop/harness";
import { defineAction, defineShopDomain, type ShopAction, type ShopDomainContext } from "./domain";

export interface CommerceEnv extends PayPalModeEnv {
  EXA_API_KEY?: string;
  /** Browser Run over REST (optional): account id + an API token with Browser Rendering access. */
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_RUN_TOKEN?: string;
  SHOP_CACHE?: KVNamespace;
  SHOP_COOLING_OFF_MINUTES?: string;
  /** Public origin, for PayPal's wallet return/cancel links (e.g. https://caaash.shipwith.si). */
  SHOP_PUBLIC_ORIGIN?: string;
}

/** Private storage = commerce's private state + the schedule id behind each commerce task. */
interface Stored {
  commerce: PrivateState;
  schedules: Record<string, string>;
}

const taskKey = (t: ScheduledTask) => (t.kind === "watch" ? `w:${t.watchId}` : `c:${t.orderId}`);

const unconfiguredExa: ExaClient = {
  search: () => Promise.reject(new ShopError("upstream", "Web search isn't configured.")),
  contents: () => Promise.reject(new ShopError("upstream", "Web search isn't configured.")),
};

function kvStore(ns: KVNamespace): KeyValueStore {
  return {
    get: (k) => ns.get(k),
    put: (k, v, { ttlSeconds }) => ns.put(k, v, { expirationTtl: Math.max(60, ttlSeconds) }),
    delete: (k) => ns.delete(k),
  };
}

/** Browser Run `/json`, when a token is configured. */
function browserRunFrom(env: CommerceEnv): BrowserRunClient | undefined {
  if (env.CF_ACCOUNT_ID && env.CF_BROWSER_RUN_TOKEN) {
    return createBrowserRunRestClient({
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_BROWSER_RUN_TOKEN,
    });
  }
  return undefined;
}

const SYSTEM_PROMPT = `You help one person shop. Be brief: the widgets show the details, so your text adds judgement, not a recap.
- Start product questions with search_products. Offers from PayPal sellers are buyable with the user's PayPal wallet; web offers are watch-only (they get a "buy at merchant" link).
- Never state a price, total or stock level that didn't come from a tool result in this conversation.
- Purchases and auto-buy rules always go to the user as an approval card; don't ask "should I buy it?" in text, call the tool and let the card ask.
- For "tell me when it drops" use create_watch; add autoBuy only when the user asked to buy automatically and the offer is buyable.
- Purchases are authorized first and captured after a cooling-off window the user can undo; say so after a purchase.
- If a tool fails, say what failed in one line and offer the next step.`;

export const commerceDomain = defineShopDomain<ShopState>((ctx) => {
  const env = ctx.env as CommerceEnv;
  const mode = (env.PAYPAL_MODE ?? "simulated").toLowerCase();
  const sim = mode === "sandbox" || mode === "live" ? undefined : createShopPayPalSim();

  const readStored = (): Stored => {
    const raw = ctx.getPrivate() as Partial<Stored> | undefined;
    return {
      commerce: raw?.commerce ?? initialPrivateState(),
      schedules: raw?.schedules ?? {},
    };
  };
  const writeStored = (s: Stored) => ctx.setPrivate(s);

  // The simulator lives in this Durable Object's memory; re-register a wallet vaulted before an
  // eviction so purchases keep working against it.
  const vaulted = readStored().commerce.wallet;
  if (sim && vaulted) {
    sim.vaultWallet({
      id: vaulted.vaultId,
      ...(vaulted.payerEmail ? { email: vaulted.payerEmail } : {}),
    });
  }

  const origin = env.SHOP_PUBLIC_ORIGIN ?? "http://localhost:8790";
  const browserRun = browserRunFrom(env);
  const deps: CommerceDeps = {
    exa: env.EXA_API_KEY ? createExaClient({ apiKey: env.EXA_API_KEY }) : unconfiguredExa,
    fetch: (input, init) => fetch(input, init),
    paypal: sim ? sim.paypal : createPayPalFromEnv(env).paypal,
    sellers: paypalSellerSource(),
    clock: systemClock,
    ids: randomIds,
    ...(browserRun ? { browserRun } : {}),
    ...(env.SHOP_CACHE ? { kv: kvStore(env.SHOP_CACHE) } : {}),
    config: {
      walletReturnUrl: `${origin}/shop?wallet=approved`,
      walletCancelUrl: `${origin}/shop?wallet=cancelled`,
      brandName: "CITED Shop",
    },
  };

  const coolingOff = Number(env.SHOP_COOLING_OFF_MINUTES);
  const shop = createShopDomain(deps, {
    ...(Number.isFinite(coolingOff) && coolingOff >= 0 ? { coolingOffMinutes: coolingOff } : {}),
  });

  function shopContext(threadId?: string, approval?: ToolContext["approval"]): ShopContext {
    return {
      userId: ctx.userId,
      ...(threadId ? { threadId } : {}),
      getState: () => ctx.getState(),
      setState: (next) => {
        ctx.updateState(() => next);
      },
      getPrivate: () => readStored().commerce,
      setPrivate: (next) => writeStored({ ...readStored(), commerce: next }),
      schedule: async (at, task) => {
        const key = taskKey(task);
        const stored = readStored();
        const prev = stored.schedules[key];
        if (prev) await ctx.cancelSchedule(prev);
        const id = await ctx.schedule(new Date(at), task);
        const latest = readStored();
        writeStored({ ...latest, schedules: { ...latest.schedules, [key]: id } });
      },
      unschedule: async (task) => {
        const key = taskKey(task);
        const stored = readStored();
        const id = stored.schedules[key];
        if (!id) return;
        await ctx.cancelSchedule(id);
        const { [key]: _gone, ...rest } = stored.schedules;
        writeStored({ ...stored, schedules: rest });
      },
      ...(approval
        ? {
            approval: {
              decision: "approved" as const,
              ...(approval.stepUpVerified === undefined
                ? {}
                : { stepUpVerified: approval.stepUpVerified }),
              ...(approval.details === undefined ? {} : { details: approval.details }),
            },
          }
        : {}),
    };
  }

  const tools: AnyTool[] = (Object.keys(shop.tools) as ToolName[]).map((name) => {
    const t = shop.tools[name] as unknown as {
      name: string;
      description: string;
      args: AnyTool["args"];
      result: AnyTool["result"];
      needsApproval?: (
        args: unknown,
        c: ShopContext,
      ) => Promise<
        | false
        | {
            kind: ApprovalKind;
            title: string;
            summary: string;
            amount?: ApprovalSpec["amount"];
            details: unknown;
            stepUp: boolean;
          }
      >;
      summarize: (args: unknown) => string;
      run: (args: unknown, c: ShopContext) => Promise<unknown>;
    };
    return defineTool({
      name: t.name,
      description: t.description,
      args: t.args,
      result: t.result,
      summarize: (a) => t.summarize(a),
      ...(t.needsApproval
        ? {
            needsApproval: async (a: unknown, tc: ToolContext): Promise<ApprovalSpec | false> => {
              const spec = await t.needsApproval?.(a, shopContext(tc.threadId));
              if (!spec) return false;
              return {
                kind: spec.kind,
                title: spec.title,
                summary: spec.summary,
                details: spec.details,
                stepUp: spec.stepUp,
                ...(spec.amount ? { amount: spec.amount } : {}),
              };
            },
          }
        : {}),
      run: (a, tc) => t.run(a, shopContext(tc.threadId, tc.approval)) as never,
      ...(name === "search_products" ? { toModel: compactSearch } : {}),
    }) as AnyTool;
  });

  const actions: Record<string, ShopAction> = {};
  for (const [name, a] of Object.entries(shop.actions)) {
    const action = a as unknown as {
      args: ShopAction["args"];
      run: (args: unknown, c: ShopContext) => Promise<unknown>;
    };
    actions[name] = defineAction({
      args: action.args,
      run: async (args) => {
        const result = await action.run(args, shopContext());
        // The simulator stands in for the buyer approving the wallet link on PayPal's site.
        if (sim && name === "wallet.startConnect") {
          const id = (result as { setupTokenId?: string }).setupTokenId;
          if (id) sim.approveSetupToken(id, { email: "buyer@example.com" });
        }
        return result;
      },
    });
  }

  async function onSchedule(payload: unknown) {
    const task = payload as ScheduledTask;
    if (!task || (task.kind !== "watch" && task.kind !== "capture")) return;
    const stored = readStored();
    const { [taskKey(task)]: _fired, ...rest } = stored.schedules;
    writeStored({ ...stored, schedules: rest });
    const outcome = await shop.onSchedule(task, shopContext());
    announce(outcome);
  }

  /** Background events reach the user as inbox entries (no turn is running). */
  function announce(outcome: ScheduleOutcome) {
    if (outcome.kind === "watchChecked") {
      const { watch, decision, order } = outcome;
      const title = watch.offer.title.slice(0, 80);
      if (order) {
        ctx.notify({
          level: "actionRequired",
          title: `Bought: ${title}`,
          body: "Authorized on your PayPal wallet. You can undo it until the cooling-off window ends.",
        });
      } else if (decision.kind === "notify") {
        ctx.notify({
          level: "success",
          title: `Price hit: ${title}`,
          body: "It reached your target price.",
        });
      } else if (decision.kind === "needsReview") {
        ctx.notify({
          level: "warning",
          title: `Check this: ${title}`,
          body: decision.reason.slice(0, 300),
        });
      }
    } else if (outcome.kind === "checkoutAdvanced" && outcome.order?.status === "captured") {
      ctx.notify({ level: "success", title: `Paid: ${outcome.order.offer.title.slice(0, 80)}` });
    }
  }

  return {
    initialState: shop.initialState(),
    stateSchema: ShopStateSchema,
    tools,
    actions,
    onSchedule,
    systemPrompt: SYSTEM_PROMPT,
    fakeRules: FAKE_RULES,
    capabilities: [
      "autoBuy",
      "watches",
      ...(env.EXA_API_KEY ? ["webSearch"] : []),
      ...(browserRun ? ["browserRun"] : []),
      sim ? "paypalSimulated" : "paypalSandbox",
    ],
  };
});

/** What the model sees of a search: enough to reason and refer to offers by id, nothing more. */
function compactSearch(result: unknown) {
  const r = result as { offers: ShopState["watches"][number]["offer"][] };
  return {
    offers: r.offers.slice(0, 12).map((o) => ({
      id: o.id,
      title: o.title,
      merchant: o.merchant.name,
      price: o.price,
      buyable: o.buyable,
      inStock: o.inStock,
    })),
  };
}

const USD = (dollars: number) => ({ amountMinor: dollars * 100, currency: "USD" });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/** Offline script (`SHOP_MODEL_PROVIDER=fake`): exercises every widget on the seeded PayPal sellers. */
const FAKE_RULES = [
  {
    match: /\b(auto-?buy|buy it (if|when)|watch|alert|tell me when|drops?)\b/i,
    tool: "create_watch",
    input: () => ({
      offerId: "pp_sony_xm6",
      targetPrice: USD(280),
      everyMinutes: 60,
      autoBuy: { maxUnitPrice: USD(280), maxTotal: USD(300), quantity: 1, expiresAt: inDays(30) },
    }),
    reasoning: "Setting up a price watch with an auto-buy rule.",
  },
  {
    match: /\bcompare\b/i,
    tool: "compare_offers",
    input: { offerIds: ["pp_sony_xm6", "pp_bose_qcu"] },
    reasoning: "Comparing the two headphones side by side.",
  },
  {
    match: /\b(my )?orders?\b/i,
    tool: "list_orders",
    input: {},
  },
  {
    match: /\bmy watch(es|list)\b/i,
    tool: "list_watches",
    input: {},
  },
  {
    match: /\bbuy\b/i,
    tool: "buy_offer",
    input: { offerId: "pp_sony_xm6", quantity: 1 },
    reasoning: "The user wants to buy the Sony headphones.",
  },
  {
    match: /\b(find|search|look|show|need|want|headphones?|earbuds?)\b/i,
    tool: "search_products",
    input: (text: string) => ({
      query: text.slice(0, 300),
      objective:
        "Product pages and retailer listings for this product with current prices; rank official stores and major retailers first; exclude forums and reviews without prices.",
    }),
    reasoning: "Searching PayPal sellers and the web.",
  },
] as const;
