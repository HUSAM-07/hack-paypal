/**
 * PayPal Agent Toolkit (`@paypal/agent-toolkit`) bridge.
 *
 * The toolkit's tools (`pay_order`, `get_order`, `create_refund`, …) run unchanged: we hand its
 * `PayPalAPI` our own client object, which is what the toolkit's constructor accepts. The
 * toolkit builds each request and sends it with axios; an adapter installed on the axios
 * instance the toolkit loads routes those requests through our `Transport` (app token, base
 * URL and fetch), so the same tools run against live PayPal, sandbox, or the in-process mock.
 *
 * Each call gets a unique `.invalid` origin that only the adapter understands, so a request
 * that somehow bypasses the adapter fails loudly instead of reaching the network unsigned.
 *
 * `create_order` is not used for agent checkout: its schema has no `payee`, `custom_id`,
 * `items[].upc` or `payment_source` (zod drops them) and it computes amounts in floats. See
 * `cited/spec/AGENT-CHECKOUT.md`, "Which call goes where".
 */

import type { Money } from "@pact/protocol";
import type { z } from "zod";
import { PayPalError, PayPalResponseError, parseErrorBody } from "./errors";
import { assertRequestId, type Transport } from "./http";
import { Order, Refund, toAmount } from "./schemas";

/**
 * The toolkit tools CITED runs. `create_order` is the toolkit's own buyer-approval order (no
 * payee, custom_id, UPC or vault), here only for the sandbox spike and comparisons.
 */
export type ToolkitMethod = "create_order" | "pay_order" | "get_order" | "create_refund";

interface AxiosConfigLike {
  url?: string;
  method?: string;
  data?: unknown;
  headers?: Record<string, unknown> & { toJSON?: () => Record<string, unknown> };
}
type Adapter = ((config: AxiosConfigLike) => Promise<unknown>) & { __citedBridge?: true };
interface AxiosLike {
  defaults: { adapter?: unknown };
  getAdapter?: (a: unknown) => (config: AxiosConfigLike) => Promise<unknown>;
}

interface BridgeCall {
  transport: Transport;
  method: ToolkitMethod;
  /** Last PayPal error body the adapter saw, kept so the issue code survives the toolkit. */
  failure?: { status: number; text: string; debugId: string | undefined };
}

const BRIDGE_HOST = ".agent-toolkit.invalid";
/** Pinned in package.json: the bridge relies on how this version sends requests. */
export const AGENT_TOOLKIT_VERSION = "1.11.0";
/** The toolkit's own User-Agent format, so PayPal sees these calls as toolkit calls. */
const USER_AGENT = `PayPal Agent Toolkit Typescript: cited, Version: ${AGENT_TOOLKIT_VERSION}`;
const calls = new Map<string, BridgeCall>();
let seq = 0;

function headerRecord(h: AxiosConfigLike["headers"]): Record<string, string> {
  const src = h?.toJSON ? h.toJSON() : (h ?? {});
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    // Our transport sets auth; whatever the toolkit added stays out.
    if (v == null || k.toLowerCase() === "authorization") continue;
    out[k] = String(v);
  }
  return out;
}

/** Send one bridged request through the call's transport. Null when `url` is not a bridge origin. */
async function sendBridged(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<Response | null> {
  if (!url.hostname.endsWith(BRIDGE_HOST)) return null;
  const call = calls.get(url.origin);
  if (!call) throw new Error("agent toolkit bridge: stale call");
  const res = await call.transport.raw({
    method,
    path: url.pathname + url.search,
    route: `toolkit:${call.method}`,
    headers,
    body: method === "GET" ? undefined : body,
  });
  if (!res.ok) {
    const text = await res.clone().text();
    call.failure = {
      status: res.status,
      text,
      debugId: res.headers.get("paypal-debug-id") ?? undefined,
    };
  }
  return res;
}

/**
 * Under workerd, axios sends with its fetch adapter, which looks up the global `fetch` per
 * request; which axios build the toolkit got depends on the bundler. This catches the bridge's
 * `.invalid` origins (unroutable by definition) whichever build it is; every other URL passes
 * through untouched.
 */
function installFetchBridge(): void {
  const g = globalThis as { fetch: typeof fetch & { __citedBridge?: true } };
  if (g.fetch.__citedBridge) return;
  const original = g.fetch;
  const bridged = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Look at the URL only: building a Request here would take over a streamed body.
    const href = input instanceof Request ? input.url : String(input);
    if (!href.includes(BRIDGE_HOST)) return original(input, init);
    const url = new URL(href);
    if (!url.hostname.endsWith(BRIDGE_HOST)) return original(input, init);
    const req = new Request(input, init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      if (k !== "authorization") headers[k] = v;
    });
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return (await sendBridged(url, req.method, headers, body)) as Response;
  }) as typeof fetch & { __citedBridge?: true };
  bridged.__citedBridge = true;
  g.fetch = bridged;
}

function bridgeAdapter(fallback: unknown, axios: AxiosLike): Adapter {
  const adapter: Adapter = async (config) => {
    const url = new URL(config.url ?? "");
    const method = (config.method ?? "get").toUpperCase();
    const body =
      config.data === undefined || config.data === null
        ? undefined
        : typeof config.data === "string"
          ? config.data
          : JSON.stringify(config.data);
    const res = await sendBridged(url, method, headerRecord(config.headers), body);
    if (!res) {
      const next = axios.getAdapter?.(fallback);
      if (!next) throw new Error("agent toolkit bridge: no fallback adapter");
      return next(config);
    }
    const text = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    // axios parses `data` with its own transformResponse after the adapter returns.
    const response = {
      data: text,
      status: res.status,
      statusText: res.statusText,
      headers,
      config,
    };
    if (res.ok) return response;
    throw Object.assign(new Error(`Request failed with status code ${res.status}`), {
      isAxiosError: true,
      config,
      response,
    });
  };
  adapter.__citedBridge = true;
  return adapter;
}

type ToolkitModule = typeof import("@paypal/agent-toolkit/mcp");
let loaded: Promise<ToolkitModule> | null = null;

/** Load the toolkit once and put the bridge on the axios instance it uses. */
function loadToolkit(): Promise<ToolkitModule> {
  loaded ??= (async () => {
    // The toolkit calls `require("axios")`. In Node that is the CommonJS Node build, which
    // sends with node:http, so the bridge goes on that instance as its adapter (`#toolkit-axios`
    // resolves to the same file). Under workerd every axios build sends with the global fetch,
    // whichever one the bundler picked, so the fetch bridge catches it. A miss fails loudly at
    // the `.invalid` origin.
    const [mod, ax] = await Promise.all([
      import("@paypal/agent-toolkit/mcp"),
      import("#toolkit-axios"),
    ]);
    installFetchBridge();
    const axios = ((ax as { default?: AxiosLike }).default ?? ax) as AxiosLike;
    const current = axios.defaults.adapter as Adapter | undefined;
    if (!current?.__citedBridge) axios.defaults.adapter = bridgeAdapter(current, axios);
    return mod;
  })().catch((e: unknown) => {
    loaded = null; // let the next call retry the import
    throw e;
  });
  return loaded;
}

function failureError(call: BridgeCall, message: string): PayPalError {
  const route = `toolkit ${call.method}`;
  if (call.failure) {
    return parseErrorBody(call.failure.status, route, call.failure.text, call.failure.debugId);
  }
  return new PayPalError({ status: 0, code: "TOOLKIT_ERROR", message, route });
}

/**
 * Run one Agent Toolkit tool through `transport`. Mutating tools take a deterministic
 * `PayPal-Request-Id` (rule 6), which the toolkit sends through our client's headers.
 */
export async function runToolkit(
  transport: Transport,
  method: ToolkitMethod,
  arg: Record<string, unknown>,
  requestId?: string,
): Promise<unknown> {
  if (requestId !== undefined) assertRequestId(requestId);
  const { PayPalAPI } = await loadToolkit();
  const origin = `https://call-${++seq}${BRIDGE_HOST}`;
  const call: BridgeCall = { transport, method };
  calls.set(origin, call);
  try {
    const client = {
      getBaseUrl: () => origin,
      getHeaders: async () => ({
        "Content-Type": "application/json",
        Prefer: "return=representation",
        "User-Agent": USER_AGENT,
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      }),
    };
    // The toolkit's own client type is a class; ours satisfies what its tools call.
    const api = new PayPalAPI(client as never, { sandbox: transport.env === "sandbox" });
    const raw = await api.run(method, arg);
    let out: unknown;
    try {
      out = JSON.parse(raw);
    } catch {
      throw failureError(call, "toolkit returned non-JSON");
    }
    const o = out as { ok?: boolean; error?: { message?: string }; message?: string } | null;
    if (call.failure || o?.ok === false || o?.error) {
      throw failureError(call, o?.error?.message ?? o?.message ?? "toolkit call failed");
    }
    return out;
  } finally {
    calls.delete(origin);
  }
}

function parsed<S extends z.ZodType>(schema: S, method: string, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new PayPalResponseError(
      `toolkit ${method}`,
      200,
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      undefined,
    );
  }
  return r.data;
}

/** The toolkit tools, typed with our response schemas. */
export function agentToolkitApi(t: Transport) {
  return {
    /** Any toolkit tool, untyped output. Prefer the typed methods below. */
    run: (method: ToolkitMethod, arg: Record<string, unknown>, opts?: { requestId?: string }) =>
      runToolkit(t, method, arg, opts?.requestId),
    /** Toolkit `pay_order`: `POST /v2/checkout/orders/{id}/capture`. */
    async payOrder(orderId: string, opts: { requestId: string }): Promise<Order> {
      const out = (await runToolkit(t, "pay_order", { id: orderId }, opts.requestId)) as {
        status?: string;
        response?: unknown;
      };
      if (out?.status !== "success") {
        throw new PayPalError({
          status: 0,
          code: "TOOLKIT_ERROR",
          message: "pay_order did not succeed",
          route: "toolkit pay_order",
        });
      }
      return parsed(Order, "pay_order", out.response);
    },
    /** Toolkit `get_order`: `GET /v2/checkout/orders/{id}`. */
    async getOrder(orderId: string): Promise<Order> {
      return parsed(Order, "get_order", await runToolkit(t, "get_order", { id: orderId }));
    },
    /** Toolkit `create_refund`: `POST /v2/payments/captures/{id}/refund`. Full refund unless `amount`. */
    async createRefund(
      captureId: string,
      input: { amount?: Money; note_to_payer?: string },
      opts: { requestId: string },
    ): Promise<Refund> {
      const arg: Record<string, unknown> = { capture_id: captureId };
      if (input.amount) arg.amount = toAmount(input.amount);
      if (input.note_to_payer) arg.note_to_payer = input.note_to_payer;
      return parsed(
        Refund,
        "create_refund",
        await runToolkit(t, "create_refund", arg, opts.requestId),
      );
    },
  };
}
