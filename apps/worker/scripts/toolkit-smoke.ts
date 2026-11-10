/**
 * The PayPal Agent Toolkit inside real workerd: runs agent checkouts and seller refunds against
 * a running pact-worker in simulated mode. The refund route goes only through the toolkit's
 * `create_refund`, and each checkout reads its order back with the toolkit's `get_order`.
 *
 *   npx wrangler dev --port 8790 --var CITED_OPEN_API:1     (in apps/worker)
 *   node apps/worker/scripts/toolkit-smoke.ts [http://localhost:8790]
 *
 * Against a locked worker, set CITED_API_TOKEN in the environment.
 */
const base = process.argv[2] ?? "http://localhost:8790";
const token = process.env.CITED_API_TOKEN;

const call = async (path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json ?? {};
};

const { offers } = (await call("/catalogue/offers")) as {
  offers: { offerId: string; seller: { id: string } }[];
};
for (const [i, offer] of offers.slice(0, 3).entries()) {
  const bought = await call("/catalogue/checkout", {
    offerId: offer.offerId,
    clientRef: `toolkit-smoke-${Date.now()}-${i}`,
  });
  const refund = await call(`/catalogue/sellers/${offer.seller.id}/refunds`, {
    captureId: bought.captureId,
  });
  console.log(
    `${offer.offerId}: order ${bought.orderId} ${bought.status}, custom_id ${bought.customId ? "set" : "none"}; toolkit refund ${refund.refundId} ${refund.status}`,
  );
}
const state = (await call("/catalogue/mock/state")) as {
  failedDeliveries: unknown[];
  captures: { refunded: number }[];
};
const refunded = state.captures.filter((c) => c.refunded > 0).length;
if (state.failedDeliveries.length > 0 || refunded < 3) {
  throw new Error(`unexpected mock state: ${JSON.stringify(state).slice(0, 400)}`);
}
console.log(`✔ toolkit ran in workerd: ${refunded} refunds, no failed webhook deliveries`);

export {};
