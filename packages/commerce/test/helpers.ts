import { memoryStore } from "@pact/paypal";
import type { BrowserRunClient } from "../src/browser-run";
import type { ApprovalAnswer, PrivateState, ScheduledTask, ShopContext } from "../src/context";
import type { ShopState } from "../src/contract";
import { type CommerceDeps, manualClock, sequentialIds } from "../src/deps";
import type { ShopDomain } from "../src/domain";
import type { ExaClient, ExaContentsRequest, ExaSearchRequest } from "../src/exa";
import { createShopPayPalSim } from "../src/paypal-sim";
import { paypalSellerSource } from "../src/sellers";

export const T0 = "2026-11-01T09:00:00.000Z";

/** An Exa stand-in that records every request and answers from fixtures. */
export function fakeExa(
  answers: {
    search?: (req: ExaSearchRequest) => unknown;
    contents?: (req: ExaContentsRequest) => unknown;
  } = {},
) {
  const calls: { path: "/search" | "/contents"; body: unknown }[] = [];
  const client: ExaClient = {
    async search(req) {
      calls.push({ path: "/search", body: req });
      return { results: [], ...((answers.search?.(req) as object | undefined) ?? {}) } as never;
    },
    async contents(req) {
      calls.push({ path: "/contents", body: req });
      return {
        results: [],
        statuses: [],
        ...((answers.contents?.(req) as object | undefined) ?? {}),
      } as never;
    },
  };
  return { client, calls };
}

/** A fetch that serves fixed pages by URL; anything else is a 404. */
export function pageFetch(pages: Record<string, string | (() => string)>) {
  const seen: string[] = [];
  const f: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    const page = pages[url];
    if (page === undefined) return new Response("not found", { status: 404 });
    return new Response(typeof page === "function" ? page() : page, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  return { fetch: f, seen };
}

export function makeDeps(
  over: { exa?: ExaClient; fetch?: typeof fetch; browserRun?: BrowserRunClient; kv?: boolean } = {},
) {
  const clock = manualClock(T0);
  const sim = createShopPayPalSim({ now: () => clock.now().getTime() });
  const sellers = paypalSellerSource();
  const deps: CommerceDeps = {
    exa: over.exa ?? fakeExa().client,
    fetch: over.fetch ?? pageFetch({}).fetch,
    paypal: sim.paypal,
    sellers,
    clock,
    ids: sequentialIds(),
    config: {
      walletReturnUrl: "https://shop.example/wallet/return",
      walletCancelUrl: "https://shop.example/wallet/cancel",
    },
    ...(over.browserRun ? { browserRun: over.browserRun } : {}),
    ...(over.kv ? { kv: memoryStore(() => clock.now().getTime()) } : {}),
  };
  return { deps, clock, sim, sellers };
}

const taskKey = (t: ScheduledTask) =>
  t.kind === "watch" ? `watch:${t.watchId}` : `capture:${t.orderId}`;

/** An in-memory `ShopContext`, the way the Durable Object would hold it. */
export function memoryCtx(domain: ShopDomain, userId = "user_1") {
  let state: ShopState = domain.initialState();
  let priv: PrivateState = domain.initialPrivateState();
  const scheduled = new Map<string, { at: string; task: ScheduledTask }>();
  const ctx: ShopContext = {
    userId,
    threadId: "thr_1",
    getState: () => state,
    setState: (s) => {
      state = s;
    },
    getPrivate: () => priv,
    setPrivate: (p) => {
      priv = p;
    },
    schedule: (at, task) => {
      scheduled.set(taskKey(task), { at, task });
    },
    unschedule: (task) => {
      scheduled.delete(taskKey(task));
    },
  };
  return {
    ctx,
    scheduled,
    get state() {
      return state;
    },
    get priv() {
      return priv;
    },
    approved(extra: Partial<ApprovalAnswer> = {}): ShopContext {
      return { ...ctx, approval: { decision: "approved", ...extra } };
    },
  };
}
