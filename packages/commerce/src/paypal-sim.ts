/**
 * `PAYPAL_MODE=simulated` for the shop's money path.
 *
 * `@pact/paypal`'s mock covers CAPTURE-intent orders only (it answers AUTHORIZE with
 * `INTENT_NOT_SUPPORTED`) and has no vault or authorization routes. The shop needs exactly
 * those: vault a wallet once, then `intent: AUTHORIZE` against the vault id, hold through the
 * cooling-off window, then capture or void. This `fetch` handles those routes in memory and
 * hands everything else (OAuth tokens…) to the base mock, so the unchanged typed client talks
 * to it as it would to the sandbox. Mutating calls replay on a repeated `PayPal-Request-Id`.
 *
 * Gap to close upstream: the routes below belong in `packages/paypal/src/mock/paypal-mock.ts`.
 */
import { createMockPayPal, createPayPal, type MockPayPal, type PayPalClient } from "@pact/paypal";

type Json = Record<string, unknown>;

export interface SimAuthorization {
  id: string;
  orderId: string;
  status: "CREATED" | "CAPTURED" | "VOIDED";
  amount: { currency_code: string; value: string };
  customId?: string;
  payee: Json;
  captureId?: string;
  createTime: string;
  updateTime: string;
  expirationTime: string;
}

export interface SimSetupToken {
  id: string;
  status: "PAYER_ACTION_REQUIRED" | "APPROVED" | "VAULTED";
  email?: string;
  payerId?: string;
  vaultId?: string;
}

export interface ShopPayPalSim {
  paypal: PayPalClient;
  fetch: typeof fetch;
  base: MockPayPal;
  /** The buyer approves the wallet link on PayPal (the redirect step). */
  approveSetupToken(id: string, buyer?: { email?: string; payerId?: string }): void;
  /** Register a vaulted wallet directly (tests that skip the connect flow). */
  vaultWallet(w?: { id?: string; email?: string }): { id: string; customerId: string };
  authorization(id: string): Readonly<SimAuthorization> | undefined;
  /** Every order the sim saw, with its first purchase unit as sent. */
  orders(): { id: string; intent: string; unit: Json; vaultId?: string }[];
  /** Fail the next call of a kind with this PayPal issue (e.g. INSTRUMENT_DECLINED). */
  failNext(kind: "authorize" | "capture" | "void", issue: string): void;
  /** How many times each route actually executed (replays don't count). */
  calls(): Record<string, number>;
  /**
   * The simulator's PayPal-side records as JSON, and back. A host whose memory doesn't outlive
   * a request (a hibernating Durable Object) persists this between calls so an authorization made
   * now can still be captured or voided later, as it could at the real PayPal.
   */
  snapshot(): ShopPayPalSimSnapshot;
  restore(snapshot: ShopPayPalSimSnapshot): void;
}

export interface ShopPayPalSimSnapshot {
  seq: number;
  auths: SimAuthorization[];
  orders: { id: string; intent: string; unit: Json; vaultId?: string; authId: string }[];
  setupTokens: SimSetupToken[];
  vault: [string, { customerId: string; email: string; payerId: string }][];
  replays: [string, { status: number; body: string }][];
}

/** Thrown by a sim route that doesn't own this request: the base mock answers it. */
class Pass extends Error {}

class SimFail extends Error {
  constructor(
    readonly status: number,
    readonly issue: string,
    message: string,
  ) {
    super(message);
  }
}

export function createShopPayPalSim(opts: { now?: () => number } = {}): ShopPayPalSim {
  const now = opts.now ?? Date.now;
  const base = createMockPayPal({ now });
  const auths = new Map<string, SimAuthorization>();
  const orders = new Map<
    string,
    { id: string; intent: string; unit: Json; vaultId?: string; authId: string }
  >();
  const setupTokens = new Map<string, SimSetupToken>();
  const vault = new Map<string, { customerId: string; email: string; payerId: string }>();
  const replays = new Map<string, { status: number; body: string }>();
  const failures = new Map<string, string>();
  const counts: Record<string, number> = {};
  let seq = 0;
  const nextId = (prefix: string, len = 17) => {
    seq += 1;
    return `${prefix}${String(seq).padStart(len - prefix.length, "0")}`;
  };
  const iso = () => new Date(now()).toISOString();

  const authJson = (a: SimAuthorization): Json => ({
    id: a.id,
    status: a.status,
    amount: a.amount,
    ...(a.customId ? { custom_id: a.customId } : {}),
    expiration_time: a.expirationTime,
    create_time: a.createTime,
    update_time: a.updateTime,
    links: [],
  });

  const orderJson = (o: {
    id: string;
    intent: string;
    unit: Json;
    authId: string;
    vaultId?: string;
  }): Json => {
    const a = auths.get(o.authId) as SimAuthorization;
    return {
      id: o.id,
      intent: o.intent,
      status: "COMPLETED",
      ...(o.vaultId
        ? {
            payment_source: {
              paypal: { attributes: { vault: { id: o.vaultId, status: "VAULTED" } } },
            },
          }
        : {}),
      purchase_units: [{ ...o.unit, payments: { authorizations: [authJson(a)] } }],
      links: [],
    };
  };

  function maybeFail(kind: string) {
    const issue = failures.get(kind);
    if (issue) {
      failures.delete(kind);
      throw new SimFail(422, issue, `Simulated ${kind} failure.`);
    }
  }

  function vaultWallet(w: { id?: string; email?: string } = {}) {
    const id = w.id ?? nextId("VT-SHOP-", 20);
    const known = vault.get(id);
    if (known) return { id, customerId: known.customerId };
    const customerId = nextId("CUST-", 12);
    vault.set(id, {
      customerId,
      email: w.email ?? "buyer@example.com",
      payerId: nextId("PAYER", 13),
    });
    return { id, customerId };
  }

  type Handler = (m: RegExpMatchArray, body: Json) => { status: number; body: Json | null };
  const routes: { method: string; re: RegExp; kind: string; run: Handler }[] = [
    {
      method: "POST",
      re: /^\/v2\/checkout\/orders$/,
      kind: "orders.create",
      run: (_m, b) => {
        if (b.intent !== "AUTHORIZE") throw new Pass();
        maybeFail("authorize");
        const unit = ((b.purchase_units as Json[] | undefined) ?? [])[0];
        const vaultId = ((b.payment_source as Json | undefined)?.paypal as Json | undefined)
          ?.vault_id;
        if (!unit)
          throw new SimFail(422, "MISSING_REQUIRED_PARAMETER", "purchase_units is required.");
        if (typeof vaultId !== "string" || !vault.has(vaultId)) {
          throw new SimFail(
            422,
            "INVALID_PAYMENT_TOKEN",
            "The vault_id is not a vaulted PayPal wallet.",
          );
        }
        const payee = unit.payee as Json | undefined;
        if (
          !payee ||
          (typeof payee.merchant_id !== "string" && typeof payee.email_address !== "string")
        ) {
          throw new SimFail(422, "PAYEE_ACCOUNT_INVALID", "A marketplace order needs a payee.");
        }
        if (typeof unit.custom_id === "string" && unit.custom_id.length > 127) {
          throw new SimFail(422, "FIELD_SIZE_EXCEEDED", "custom_id exceeds 127 characters.");
        }
        const t = iso();
        const a: SimAuthorization = {
          id: nextId("AUTH"),
          orderId: "",
          status: "CREATED",
          amount: unit.amount as SimAuthorization["amount"],
          payee,
          createTime: t,
          updateTime: t,
          // PayPal holds a vaulted authorization for 29 days (honor period 3).
          expirationTime: new Date(now() + 29 * 86_400_000).toISOString(),
          ...(typeof unit.custom_id === "string" ? { customId: unit.custom_id } : {}),
        };
        const o = { id: nextId("5O"), intent: "AUTHORIZE", unit, vaultId, authId: a.id };
        a.orderId = o.id;
        auths.set(a.id, a);
        orders.set(o.id, o);
        return { status: 201, body: orderJson(o) };
      },
    },
    {
      method: "GET",
      re: /^\/v2\/checkout\/orders\/([^/]+)$/,
      kind: "orders.get",
      run: (m) => {
        const o = orders.get(m[1] as string);
        if (!o) throw new Pass();
        return { status: 200, body: orderJson(o) };
      },
    },
    {
      method: "GET",
      re: /^\/v2\/payments\/authorizations\/([^/]+)$/,
      kind: "authorizations.get",
      run: (m) => {
        const a = auths.get(m[1] as string);
        if (!a) throw new SimFail(404, "INVALID_RESOURCE_ID", "Authorization not found.");
        return { status: 200, body: authJson(a) };
      },
    },
    {
      method: "POST",
      re: /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/,
      kind: "authorizations.capture",
      run: (m, b) => {
        const a = auths.get(m[1] as string);
        if (!a) throw new SimFail(404, "INVALID_RESOURCE_ID", "Authorization not found.");
        if (a.status === "VOIDED")
          throw new SimFail(422, "AUTHORIZATION_VOIDED", "Authorization was voided.");
        if (a.status === "CAPTURED") {
          throw new SimFail(
            422,
            "AUTHORIZATION_ALREADY_CAPTURED",
            "Authorization already captured.",
          );
        }
        maybeFail("capture");
        a.status = "CAPTURED";
        a.captureId = nextId("3C");
        a.updateTime = iso();
        return {
          status: 201,
          body: {
            id: a.captureId,
            status: "COMPLETED",
            amount: (b.amount as Json | undefined) ?? a.amount,
            final_capture: true,
            ...(a.customId ? { custom_id: a.customId } : {}),
            create_time: a.updateTime,
            update_time: a.updateTime,
            links: [],
          },
        };
      },
    },
    {
      method: "POST",
      re: /^\/v2\/payments\/authorizations\/([^/]+)\/void$/,
      kind: "authorizations.void",
      run: (m) => {
        const a = auths.get(m[1] as string);
        if (!a) throw new SimFail(404, "INVALID_RESOURCE_ID", "Authorization not found.");
        if (a.status === "CAPTURED") {
          throw new SimFail(422, "PREVIOUSLY_CAPTURED", "Authorization was already captured.");
        }
        if (a.status === "VOIDED") throw new SimFail(422, "PREVIOUSLY_VOIDED", "Already voided.");
        maybeFail("void");
        a.status = "VOIDED";
        a.updateTime = iso();
        return { status: 200, body: authJson(a) };
      },
    },
    {
      method: "POST",
      re: /^\/v3\/vault\/setup-tokens$/,
      kind: "vault.setupTokens.create",
      run: () => {
        const id = nextId("ST-", 17);
        setupTokens.set(id, { id, status: "PAYER_ACTION_REQUIRED" });
        return {
          status: 201,
          body: {
            id,
            status: "PAYER_ACTION_REQUIRED",
            links: [
              {
                rel: "approve",
                href: `https://www.sandbox.paypal.com/agreements/approve?approval_session_id=${id}`,
                method: "GET",
              },
            ],
          },
        };
      },
    },
    {
      method: "POST",
      re: /^\/v3\/vault\/payment-tokens$/,
      kind: "vault.paymentTokens.create",
      run: (_m, b) => {
        const tokenId = ((b.payment_source as Json | undefined)?.token as Json | undefined)?.id;
        const st = typeof tokenId === "string" ? setupTokens.get(tokenId) : undefined;
        if (!st) throw new SimFail(404, "INVALID_RESOURCE_ID", "Setup token not found.");
        if (st.status === "PAYER_ACTION_REQUIRED") {
          throw new SimFail(422, "SETUP_TOKEN_NOT_APPROVED", "The buyer hasn't approved this yet.");
        }
        const w = vaultWallet({
          ...(st.vaultId ? { id: st.vaultId } : {}),
          ...(st.email ? { email: st.email } : {}),
        });
        st.status = "VAULTED";
        st.vaultId = w.id;
        const v = vault.get(w.id) as { customerId: string; email: string; payerId: string };
        return {
          status: 201,
          body: {
            id: w.id,
            customer: { id: v.customerId },
            payment_source: { paypal: { email_address: v.email, payer_id: v.payerId } },
            links: [],
          },
        };
      },
    },
  ];

  const simFetch: typeof fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    const url = new URL(req.url);
    const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) return base.fetch(input as RequestInfo, init);
    const text = req.method === "GET" ? "" : await req.clone().text();
    let body: Json = {};
    try {
      body = text ? (JSON.parse(text) as Json) : {};
    } catch {
      body = {};
    }
    const requestId = req.headers.get("PayPal-Request-Id");
    const replayKey = requestId ? `${req.method} ${url.pathname} ${requestId}` : undefined;
    const replay = replayKey ? replays.get(replayKey) : undefined;
    if (replay) {
      return new Response(replay.body, {
        status: replay.status,
        headers: { "content-type": "application/json" },
      });
    }
    let status: number;
    let out: string;
    try {
      const res = route.run(url.pathname.match(route.re) as RegExpMatchArray, body);
      counts[route.kind] = (counts[route.kind] ?? 0) + 1;
      status = res.status;
      out = res.body === null ? "" : JSON.stringify(res.body);
    } catch (e) {
      if (e instanceof Pass)
        return base.fetch(
          new Request(req.url, {
            method: req.method,
            headers: req.headers,
            ...(text ? { body: text } : {}),
          }),
        );
      if (!(e instanceof SimFail)) throw e;
      status = e.status;
      out = JSON.stringify({
        name: e.status === 404 ? "RESOURCE_NOT_FOUND" : "UNPROCESSABLE_ENTITY",
        message: e.message,
        debug_id: "sim-debug",
        details: [{ issue: e.issue, description: e.message }],
      });
    }
    // PayPal replays a repeated request id with the original answer, errors included.
    if (replayKey && req.method !== "GET") replays.set(replayKey, { status, body: out });
    return new Response(out || null, { status, headers: { "content-type": "application/json" } });
  };

  const paypal = createPayPal({
    clientId: "shop-sim-client",
    clientSecret: "shop-sim-secret",
    env: "sandbox",
    fetch: simFetch,
    maxRetries: 0,
  });

  return {
    paypal,
    fetch: simFetch,
    base,
    approveSetupToken(id, buyer = {}) {
      const st = setupTokens.get(id);
      if (!st) throw new Error(`unknown setup token ${id}`);
      if (st.status === "PAYER_ACTION_REQUIRED") st.status = "APPROVED";
      if (buyer.email) st.email = buyer.email;
      if (buyer.payerId) st.payerId = buyer.payerId;
    },
    vaultWallet,
    snapshot: () => ({
      seq,
      auths: [...auths.values()],
      orders: [...orders.values()],
      setupTokens: [...setupTokens.values()],
      vault: [...vault.entries()],
      replays: [...replays.entries()].slice(-200),
    }),
    restore(snap) {
      seq = Math.max(seq, snap.seq);
      for (const a of snap.auths) auths.set(a.id, { ...a });
      for (const o of snap.orders) orders.set(o.id, { ...o });
      for (const t of snap.setupTokens) setupTokens.set(t.id, { ...t });
      for (const [k, v] of snap.vault) vault.set(k, { ...v });
      for (const [k, v] of snap.replays) replays.set(k, { ...v });
    },
    authorization: (id) => auths.get(id),
    orders: () =>
      [...orders.values()].map((o) => ({
        id: o.id,
        intent: o.intent,
        unit: o.unit,
        ...(o.vaultId ? { vaultId: o.vaultId } : {}),
      })),
    failNext(kind, issue) {
      failures.set(kind, issue);
    },
    calls: () => ({ ...counts }),
  };
}
