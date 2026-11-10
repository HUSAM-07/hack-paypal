import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMockPayPal, createPayPal, type MockPayPal, type PayPalClient } from "@pact/paypal";
import { Hono } from "hono";
import { type Catalogue, createCatalogue, DEV_PASSPORT_KEY } from "./catalogue";
import { CheckoutError, checkout } from "./checkout";
import { searchOffers } from "./offers";
import { createPublicMcp, type PublicMcp } from "./public";
import { isSellerId, sellersFromEnv } from "./sellers";
import { createMcpServer } from "./server";

export * from "./catalogue";
export * from "./checkout";
export * from "./offers";
export * from "./public";
export * from "./sellers";

export const PORT = 8801;

type Env = Record<string, string | undefined>;

export interface CatalogueAppOptions {
  env?: Env;
  /** Inject a PayPal client (tests). Otherwise built from env: simulated unless PAYPAL_MODE=sandbox. */
  paypal?: PayPalClient;
  buyerVaultId?: string;
  /** Simulated only: the mock to use. Default: a fresh one that posts webhooks to ENGINE_URL. */
  mock?: MockPayPal;
}

/** Dev key only in simulated mode; a live deployment must set the secret. */
function passportKey(env: Env): string {
  const key = env.PASSPORT_SIGNING_KEY;
  if (key) return key;
  if ((env.PAYPAL_MODE ?? "simulated") === "simulated") return DEV_PASSPORT_KEY;
  throw new Error("PASSPORT_SIGNING_KEY is required outside simulated mode");
}

function buildPayPal(
  env: Env,
  o: CatalogueAppOptions,
): { paypal: PayPalClient; buyerVaultId: string | undefined; mock?: MockPayPal } {
  if (o.paypal) return { paypal: o.paypal, buyerVaultId: o.buyerVaultId };
  if (env.PAYPAL_MODE === "sandbox") {
    return {
      paypal: createPayPal({
        env: "sandbox",
        clientId: env.PAYPAL_CLIENT_ID ?? "",
        clientSecret: env.PAYPAL_CLIENT_SECRET ?? "",
      }),
      // A real `vault_id`, from the buyer approving the setup token once (see AGENT-CHECKOUT.md).
      buyerVaultId: env.CITED_BUYER_VAULT_ID,
    };
  }
  // Simulated: the shared stateful PayPal mock, so captures and refunds emit the same signed
  // webhooks the engine receives from PayPal.
  let mock = o.mock;
  if (!mock) {
    mock = createMockPayPal({ autoSettlePayouts: true });
    const engine = env.ENGINE_URL?.replace(/\/$/, "");
    if (engine) mock.registerWebhook(`${engine}/webhooks/paypal`);
  }
  const paypal = createPayPal({
    env: "sandbox",
    clientId: "mock-client-id",
    clientSecret: "mock-client-secret",
    fetch: mock.fetch,
  });
  // The buyer linked their PayPal to the agent once; the mock's vault holds that wallet.
  const buyerVaultId = o.buyerVaultId ?? mock.vaultWallet({ email: "buyer@agent.example" }).id;
  return { paypal, buyerVaultId, mock };
}

/**
 * The agent catalogue (our mock of PayPal Store Sync) and the agent platform's checkout:
 * MCP tools `search_product` and `checkout`, plus the sellers' refund action.
 */
export function createCatalogueApp(opts: CatalogueAppOptions = {}) {
  const env = opts.env ?? (process.env as Env);
  const mode = env.PAYPAL_MODE ?? "simulated";
  const sellers = sellersFromEnv(env);
  const catalogue = createCatalogue({
    seed: env.CATALOGUE_SEED ?? "cited-demo",
    passportKey: passportKey(env),
    allowSessionId: mode === "simulated",
    sellers,
  });
  const { paypal, buyerVaultId, mock } = buildPayPal(env, opts);
  const deps = { paypal, buyerVaultId };
  const app = new Hono();

  app.onError((e, c) => {
    if (e instanceof CheckoutError) {
      return c.json({ error: { code: e.code, message: e.message } }, e.status);
    }
    console.error(e);
    return c.json({ error: { code: "internal", message: "unexpected error" } }, 500);
  });

  app.get("/health", (c) =>
    c.json({
      ok: true,
      app: "catalogue-mcp",
      paypalMode: mode,
      buyerLinked: Boolean(buyerVaultId),
      modelProvider: env.MODEL_PROVIDER ?? "fake",
    }),
  );

  /** Streamable HTTP MCP endpoint. Stateless: the passport, not a transport session, carries state. */
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await createMcpServer(catalogue, deps).connect(transport);
    const res = await transport.handleRequest(c.req.raw);
    // The checkout's webhooks reach the engine before the agent hears back.
    await mock?.flush();
    return res;
  });

  /** The same offers as `search_product`, for people (no session, no creator content). */
  app.get("/offers", (c) =>
    c.json({ offers: searchOffers(c.req.query("q") ?? "purifier", catalogue.offers) }),
  );

  /** The same checkout as the MCP tool, for scripts. */
  app.post("/checkout", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.offerId !== "string") {
      throw new CheckoutError(400, "bad_request", "body must be JSON with a string `offerId`");
    }
    const out = await checkout(
      { catalogue, ...deps },
      {
        offerId: body.offerId,
        ...(typeof body.passport === "string" ? { passport: body.passport } : {}),
        ...(typeof body.quantity === "number" ? { quantity: body.quantity } : {}),
        ...(typeof body.clientRef === "string" ? { clientRef: body.clientRef } : {}),
      },
    );
    await mock?.flush();
    return c.json(out, 201);
  });

  /**
   * A seller refunds a sale through PayPal (`captures/{id}/refund`): the buyer returned it.
   * Full refund unless `amountMinor` is given. PayPal's PAYMENT.CAPTURE.REFUNDED webhook then
   * voids the pending credit in the engine.
   */
  app.post("/sellers/:sellerId/refunds", async (c) => {
    const sellerId = c.req.param("sellerId");
    if (!isSellerId(sellerId)) return c.json({ error: { code: "unknown_seller" } }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      captureId?: unknown;
      amountMinor?: unknown;
    };
    if (typeof body.captureId !== "string") {
      return c.json({ error: { code: "bad_request", message: "captureId is required" } }, 400);
    }
    const captureId = body.captureId;
    const held = mock?.state.captures.get(captureId);
    if (mock) {
      const payee = sellers[sellerId].payee;
      if (!held) return c.json({ error: { code: "unknown_capture", message: captureId } }, 404);
      if (JSON.stringify(held.payee) !== JSON.stringify(payee)) {
        return c.json({ error: { code: "not_your_sale", message: captureId } }, 403);
      }
    }
    const amount =
      typeof body.amountMinor === "number"
        ? { amountMinor: body.amountMinor, currency: held?.amount.currency ?? "USD" }
        : undefined;
    // The PayPal Agent Toolkit's `create_refund` tool, through our client's auth and fetch.
    const refund = await paypal.agentToolkit.createRefund(captureId, amount ? { amount } : {}, {
      requestId: `cited-refund-${captureId}-${amount?.amountMinor ?? "full"}`,
    });
    await mock?.flush();
    return c.json({ refundId: refund.id, status: refund.status, sellerId, captureId });
  });

  /**
   * Simulated only: what a buyer and PayPal do in the Resolution Center. A buyer opens a
   * dispute on a sale (`CUSTOMER.DISPUTE.CREATED`), then PayPal decides it
   * (`CUSTOMER.DISPUTE.RESOLVED`); both reach the engine as signed webhooks.
   */
  app.post("/mock/disputes", async (c) => {
    if (!mock) return c.json({ error: { code: "not_available", message: "simulated only" } }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { captureId?: unknown };
    if (typeof body.captureId !== "string" || !mock.state.captures.has(body.captureId)) {
      return c.json({ error: { code: "unknown_capture", message: "captureId is required" } }, 404);
    }
    const d = mock.openDispute(body.captureId);
    await mock.flush();
    return c.json(
      { disputeId: d.dispute_id, captureId: d.captureId, status: d.status, amount: d.amount },
      201,
    );
  });

  app.post("/mock/disputes/:disputeId/resolve", async (c) => {
    if (!mock) return c.json({ error: { code: "not_available", message: "simulated only" } }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { favour?: unknown };
    if (body.favour !== "seller" && body.favour !== "buyer") {
      return c.json({ error: { code: "bad_request", message: "favour: seller | buyer" } }, 400);
    }
    const id = c.req.param("disputeId");
    if (!mock.state.disputes.has(id)) return c.json({ error: { code: "unknown_dispute" } }, 404);
    const d = mock.resolveDispute(
      id,
      body.favour === "seller" ? "RESOLVED_SELLER_FAVOUR" : "RESOLVED_BUYER_FAVOUR",
    );
    await mock.flush();
    return c.json({
      disputeId: d.dispute_id,
      captureId: d.captureId,
      status: d.status,
      outcome: d.outcome,
    });
  });

  /** Simulated only: the sales PayPal holds, to check the engine's ledger against. */
  app.get("/mock/state", (c) => {
    if (!mock) return c.json({ error: { code: "not_available", message: "simulated only" } }, 404);
    return c.json({
      captures: [...mock.state.captures.values()].map((x) => ({
        id: x.id,
        orderId: x.orderId,
        amount: x.amount,
        refunded: x.refunded,
        payee: x.payee,
        customId: x.customId ?? null,
        vaulted: Boolean(mock.state.orders.get(x.orderId)?.vaultId),
      })),
      disputes: [...mock.state.disputes.values()].map((d) => ({
        id: d.dispute_id,
        captureId: d.captureId,
        status: d.status,
        outcome: d.outcome ?? null,
      })),
      webhooksDelivered: mock.events.length,
      failedDeliveries: mock.failedDeliveries,
    });
  });

  /** Demo clock control, simulated mode only: jump forward to show the day-7 holdout switch. */
  app.post("/demo/advance-days", async (c) => {
    if (mode !== "simulated") return c.json({ error: "not available" }, 404);
    const { days } = await c.req.json<{ days?: number }>();
    if (typeof days !== "number" || !Number.isFinite(days) || days < 0) {
      return c.json({ error: "days must be a non-negative number" }, 400);
    }
    catalogue.clock.advanceDays(days);
    return c.json({ now: catalogue.clock.now().toISOString() });
  });

  // Not routed here: the worker mounts it at /mcp behind its per-IP rate limit.
  const publicMcp = createPublicMcp({
    catalogue,
    ...deps,
    ...(mock ? { flush: () => mock.flush() } : {}),
  });

  const extras: CatalogueAppExtras = { catalogue, mock, publicMcp };
  return Object.assign(app, extras);
}

export interface CatalogueAppExtras {
  catalogue: Catalogue;
  /** Simulated only: the PayPal the agents pay through. */
  mock: MockPayPal | undefined;
  /** The public, stateful MCP server (one shopping session per MCP session). */
  publicMcp: PublicMcp;
}
export type CatalogueApp = ReturnType<typeof createCatalogueApp>;
