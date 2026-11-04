import { createPayPal, type PayPalClient } from "@pact/paypal";
import { Hono } from "hono";
import { isShopId, PRODUCTS, productBySlug, SHOP_IDS, SHOPS } from "./catalogue";
import { CheckoutError, captureOrder, createOrder } from "./checkout";
import { homePage, productPage } from "./pages";
import { simulatedPayPal } from "./simulated-paypal";

export * from "./catalogue";
export { simulatedPayPal } from "./simulated-paypal";

export const PORT = 8802;

type Env = Record<string, string | undefined>;

export interface ShopsOptions {
  env?: Env;
  /** Inject a PayPal client (tests). Otherwise built from env: simulated unless PAYPAL_MODE=sandbox. */
  paypal?: PayPalClient;
}

function buildPayPal(env: Env): PayPalClient {
  if (env.PAYPAL_MODE === "sandbox") {
    return createPayPal({
      env: "sandbox",
      clientId: env.PAYPAL_CLIENT_ID ?? "",
      clientSecret: env.PAYPAL_CLIENT_SECRET ?? "",
    });
  }
  return createPayPal({
    env: "sandbox",
    clientId: "simulated",
    clientSecret: "simulated",
    fetch: simulatedPayPal().fetch,
  });
}

/** Northwind, Lumen and MegaMart: HTML storefronts for humans plus a JSON checkout API for agents. */
export function createShopsApp(opts: ShopsOptions = {}) {
  const env = opts.env ?? (process.env as Env);
  const paypal = opts.paypal ?? buildPayPal(env);
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
    return c.json(await captureOrder(deps, c.req.param("orderId")));
  });

  return app;
}

export const app = createShopsApp();
