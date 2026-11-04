/**
 * A tiny in-process stand-in for PayPal's Orders v2, used when PAYPAL_MODE=simulated. It speaks the
 * wire format the real client sends, replays on a repeated `PayPal-Request-Id`, and keeps the raw
 * request bodies so tests can assert on `custom_id` and `items[].upc`.
 */
export interface SimulatedPayPal {
  fetch: typeof fetch;
  /** Raw JSON bodies of order-create calls, in order. */
  created: { requestId: string | null; body: any }[];
  orders: Map<string, any>;
}

export function simulatedPayPal(): SimulatedPayPal {
  const orders = new Map<string, any>();
  const created: SimulatedPayPal["created"] = [];
  const replays = new Map<string, { status: number; body: unknown }>();
  let n = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const requestId = headers.get("paypal-request-id");
    const isJson = headers.get("content-type")?.includes("json");
    const body = isJson && typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    if (method === "POST" && url.pathname === "/v1/oauth2/token") {
      return json(200, { access_token: "SIM-token", token_type: "Bearer", expires_in: 32400 });
    }
    const replayKey = requestId ? `${method} ${url.pathname} ${requestId}` : undefined;
    const replay = replayKey ? replays.get(replayKey) : undefined;
    if (replay) return json(replay.status, replay.body);
    const reply = (status: number, out: unknown) => {
      if (replayKey) replays.set(replayKey, { status, body: out });
      return json(status, out);
    };

    if (method === "POST" && url.pathname === "/v2/checkout/orders") {
      const id = `SIM-ORDER-${++n}`;
      const unit = body.purchase_units[0];
      const order = {
        id,
        status: "CREATED",
        intent: body.intent,
        purchase_units: [{ ...unit, reference_id: unit.reference_id ?? "default" }],
        links: [{ rel: "self", href: `https://sim.paypal.test/v2/checkout/orders/${id}` }],
      };
      orders.set(id, order);
      created.push({ requestId, body });
      return reply(201, { id, status: "CREATED", links: order.links });
    }
    const cap = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (method === "POST" && cap) {
      const order = orders.get(cap[1] as string);
      if (!order) return json(404, { name: "RESOURCE_NOT_FOUND", message: "order not found" });
      const unit = order.purchase_units[0];
      order.status = "COMPLETED";
      unit.payments = {
        captures: [
          {
            id: `SIM-CAPTURE-${order.id.slice("SIM-ORDER-".length)}`,
            status: "COMPLETED",
            amount: unit.amount,
            custom_id: unit.custom_id,
            final_capture: true,
          },
        ],
      };
      return reply(201, order);
    }
    const get = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (method === "GET" && get) {
      const order = orders.get(get[1] as string);
      return order
        ? json(200, order)
        : json(404, { name: "RESOURCE_NOT_FOUND", message: "order not found" });
    }
    return json(404, {
      name: "RESOURCE_NOT_FOUND",
      message: `no simulation for ${method} ${url.pathname}`,
    });
  };

  return { fetch: impl as typeof fetch, created, orders };
}
