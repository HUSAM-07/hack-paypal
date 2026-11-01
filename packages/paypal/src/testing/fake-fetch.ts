/** A scripted `fetch` for unit tests: replies are keyed by `METHOD /path` and consumed in order. */
import { createPayPal, type PayPalClient } from "../client";
import type { PayPalConfig } from "../http";
import { tokenResponse } from "./fixtures";

export interface Recorded {
  method: string;
  url: URL;
  key: string;
  headers: Headers;
  rawBody: string | undefined;
  /** Parsed JSON body, or the form params as an object for form posts. */
  body: unknown;
}

export interface ReplySpec {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Simulate a network failure. */
  throws?: Error;
}

export type Reply = ReplySpec | ((req: Recorded) => ReplySpec);

export function fakeFetch() {
  const calls: Recorded[] = [];
  const queues = new Map<string, Reply[]>();

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const key = `${method} ${url.pathname}`;
    const headers = new Headers(init?.headers);
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    let body: unknown;
    if (rawBody !== undefined) {
      body = headers.get("content-type")?.includes("json")
        ? JSON.parse(rawBody)
        : Object.fromEntries(new URLSearchParams(rawBody));
    }
    const req: Recorded = { method, url, key, headers, rawBody, body };
    calls.push(req);

    const q = queues.get(key);
    let reply: Reply | undefined;
    if (q && q.length > 0) reply = q.length > 1 ? q.shift() : q[0];
    else if (key === "POST /v1/oauth2/token") reply = { body: tokenResponse };
    else
      reply = { status: 404, body: { name: "RESOURCE_NOT_FOUND", message: `no fake for ${key}` } };
    const spec = typeof reply === "function" ? reply(req) : (reply as ReplySpec);
    if (spec.throws) throw spec.throws;
    const status = spec.status ?? 200;
    const text =
      spec.body === undefined
        ? ""
        : typeof spec.body === "string"
          ? spec.body
          : JSON.stringify(spec.body);
    return new Response(status === 204 ? null : text, {
      status,
      headers: { "content-type": "application/json", ...spec.headers },
    });
  };

  return {
    fetch: impl as typeof fetch,
    calls,
    /** Queue replies for a key; the last one repeats. */
    on(key: string, ...replies: Reply[]) {
      queues.set(key, replies);
      return this;
    },
    to(key: string): Recorded[] {
      return calls.filter((c) => c.key === key);
    },
    last(key: string): Recorded {
      const hit = calls.filter((c) => c.key === key).at(-1);
      if (!hit) throw new Error(`no call to ${key}`);
      return hit;
    },
  };
}

export type FakeFetch = ReturnType<typeof fakeFetch>;

export function testClient(fake: FakeFetch, extra: Partial<PayPalConfig> = {}): PayPalClient {
  return createPayPal({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    env: "sandbox",
    fetch: fake.fetch,
    sleep: async () => {},
    ...extra,
  });
}
