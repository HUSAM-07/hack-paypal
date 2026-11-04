import {
  createPayPal,
  createPayPalFromEnv,
  type MockPayPal,
  type PayPalClient,
} from "@pact/paypal";
import { Hono } from "hono";
import { isShopId, PRODUCTS, productBySlug, SHOP_IDS, SHOPS } from "./catalogue";
import { CheckoutError, captureOrder, createOrder } from "./checkout";
import { homePage, productPage } from "./pages";

export * from "./catalogue";
export { simulatedPayPal } from "./simulated-paypal";

export const PORT = 8802;

type Env = Record<string, string | undefined>;

export interface ShopsOptions {
  env?: Env;
  /** Inject a PayPal client (tests). Otherwise built from env: simulated unless PAYPAL_MODE=sandbox. */
  paypal?: PayPalClient;
  /** Simulated only: where the PayPal mock delivers webhooks (the engine). Default: env ENGINE_URL. */
  engineUrl?: string;
  /** Simulated only: the mock to use (tests, in-process demos). */
  mock?: MockPayPal;
}

function buildPayPal(env: Env, o: ShopsOptions): { paypal: PayPalClient; mock?: MockPayPal } {
  if (env.PAYPAL_MODE === "sandbox") {
    return {
      paypal: createPayPal({
        env: "sandbox",
        clientId: env.PAYPAL_CLIENT_ID ?? "",
        clientSecret: env.PAYPAL_CLIENT_SECRET ?? "",
      }),
    };
  }
  // Simulated: the shared stateful PayPal mock, so captures, refunds and disputes emit the same
  // signed webhooks the engine receives from PayPal.
  if (o.mock) {
    const paypal = createPayPal({
      env: "sandbox",
      clientId: "mock-client-id",
      clientSecret: "mock-client-secret",
      fetch: o.mock.fetch,
    });
    return { paypal, mock: o.mock };
  }
  const sim = createPayPalFromEnv({ PAYPAL_MODE: "simulated" });
  const engine = o.engineUrl ?? env.ENGINE_URL;
  if (sim.mock && engine) sim.mock.registerWebhook(`${engine.replace(/\/$/, "")}/webhooks/paypal`);
  return { paypal: sim.paypal, ...(sim.mock ? { mock: sim.mock } : {}) };
}

/** Northwind, Lumen and MegaMart: HTML storefronts for humans plus a JSON checkout API for agents. */
export function createShopsApp(opts: ShopsOptions = {}) {
  const env = opts.env ?? (process.env as Env);
  const built = opts.paypal ? { paypal: opts.paypal } : buildPayPal(env, opts);
  const { paypal } = built;
  const mock = "mock" in built ? built.mock : undefined;
  const deps = { paypal, passportSecret: env.PASSPORT_SECRET };
  const sandbox = env.PAYPAL_MODE === "sandbox";
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      app: "shops",
      paypalMode: env.PAYPAL_MODE ?? "simulated",
      modelProvider: env.MODEL_PROVIDER ?? "fake",
    }),
  );

  app.get("/", (c) =>
    c.html(
      `<!doctype html><title>CITED shops</title><ul>${SHOP_IDS.map((id) => `<li><a href="/${id}">${SHOPS[id].name}</a></li>`).join("")}</ul>`,
    ),
  );

  app.onError((e, c) => {
    if (e instanceof CheckoutError) {
      return c.json({ error: { code: e.code, message: e.message } }, e.status);
    }
    console.error(e);
    return c.json({ error: { code: "internal", message: "unexpected error" } }, 500);
  });

  const shopFor = (id: string) => (isShopId(id) ? SHOPS[id] : undefined);

  app.get("/:shop", (c) => {
    const shop = shopFor(c.req.param("shop"));
    return shop ? c.html(homePage(shop)) : c.notFound();
  });

  app.get("/:shop/p/:slug", (c) => {
    const shop = shopFor(c.req.param("shop"));
    const product = productBySlug(c.req.param("slug"));
    if (!shop || !product) return c.notFound();
    return c.html(
      productPage(shop, product, {
        paypalClientId: sandbox ? env.PAYPAL_CLIENT_ID : undefined,
      }),
    );
  });

  /** Offers for the catalogue and agents: one price per shop. */
  app.get("/:shop/api/products", (c) => {
    const shop = shopFor(c.req.param("shop"));
    if (!shop) return c.notFound();
    return c.json({
      shopId: shop.id,
      products: PRODUCTS.map((p) => ({ ...p, price: shop.prices[p.upc] })),
    });
  });

  app.post("/:shop/api/orders", async (c) => {
    const shop = shopFor(c.req.param("shop"));
    if (!shop) return c.notFound();
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.upc !== "string") {
      throw new CheckoutError(400, "bad_request", "body must be JSON with a string `upc`");
    }
    const order = await createOrder(deps, shop.id, {
      upc: body.upc,
      ...(typeof body.quantity === "number" ? { quantity: body.quantity } : {}),
      ...(typeof body.passport === "string" ? { passport: body.passport } : {}),
      ...(typeof body.clientRef === "string" ? { clientRef: body.clientRef } : {}),
    });
    return c.json(order, 201);
  });

  /**
   * Capture. In simulated mode the order is treated as approved; in sandbox the buyer (or the
   * agent's sandbox payer) must have approved it at PayPal first.
   */
  app.post("/:shop/api/orders/:orderId/capture", async (c) => {
    if (!shopFor(c.req.param("shop"))) return c.notFound();
    const orderId = c.req.param("orderId");
    // Simulated: the buyer approves at PayPal (webhook), then the shop captures (webhook).
    mock?.approveOrder(orderId);
    const out = await captureOrder(deps, orderId);
    await mock?.flush();
    return c.json(out);
  });

  /** Simulated only: the captures the shops' PayPal mock holds, to check the engine's ledger against. */
  app.get("/mock/state", (c) => {
    if (!mock) return c.json({ error: { code: "not_available", message: "simulated only" } }, 404);
    return c.json({
      captures: [...mock.state.captures.values()].map((x) => ({
        id: x.id,
        orderId: x.orderId,
        amount: x.amount,
        refunded: x.refunded,
        customId: x.customId ?? null,
      })),
      webhooksDelivered: mock.events.length,
      failedDeliveries: mock.failedDeliveries,
    });
  });

  /**
   * Simulated only: a buyer returns an order. Full refund unless `amountMinor` is given. The mock
   * emits PAYMENT.CAPTURE.REFUNDED to the engine, which voids the pending credit.
   */
  app.post("/mock/captures/:captureId/refund", async (c) => {
    if (!mock) return c.json({ error: { code: "not_available", message: "simulated only" } }, 404);
    const captureId = c.req.param("captureId");
    const body = (await c.req.json().catch(() => ({}))) as { amountMinor?: number };
    const capture = mock.state.captures.get(captureId);
    if (!capture) return c.json({ error: { code: "unknown_capture", message: captureId } }, 404);
    const amount =
      typeof body.amountMinor === "number"
        ? { amountMinor: body.amountMinor, currency: capture.amount.currency }
        : undefined;
    const refund = await paypal.captures.refund(captureId, amount ? { amount } : {}, {
      requestId: `cited-refund-${captureId}-${amount?.amountMinor ?? "full"}`,
    });
    await mock.flush();
    return c.json({ refundId: refund.id, status: refund.status });
  });

  return app;
}

export const app = createShopsApp();
