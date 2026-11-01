/**
 * Transport: app-token management, headers, bounded retries, error normalization.
 *
 * Logging is opt-in through `onRequest`, which only ever sees the route *template*
 * (`/v3/vault/payment-tokens/:id`), never the concrete path, body, or token, so vault
 * IDs and credentials can't leak through it.
 */
import type { z } from "zod";
import { PayPalError, PayPalResponseError, parseErrorBody } from "./errors";
import { AccessToken } from "./schemas";
import { type KeyValueStore, memoryStore } from "./store";

export type PayPalEnv = "sandbox" | "live";

export const API_BASE: Record<PayPalEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export interface RequestLog {
  method: string;
  route: string;
  status: number;
  attempt: number;
  durationMs: number;
  debugId?: string | undefined;
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  env: PayPalEnv;
  fetch?: typeof fetch;
  /** Token cache. Back it with KV or DO storage in the worker; defaults to in-memory. */
  cache?: KeyValueStore;
  /** Retries after the first attempt, for idempotent calls only. Default 2. */
  maxRetries?: number;
  /** Refresh the app token this long before it expires. Default 300s. */
  tokenMarginSeconds?: number;
  /** BN code sent as `PayPal-Partner-Attribution-Id`, if any. */
  partnerAttributionId?: string;
  onRequest?: (log: RequestLog) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Options every call accepts. */
export interface CallOptions {
  /**
   * Sandbox negative testing: sent as `PayPal-Mock-Response: {"mock_application_codes": …}`.
   * Ignored (and refused) on live.
   */
  mock?: string;
  /** `PayPal-Client-Metadata-Id` (fraud-net correlation id). */
  clientMetadataId?: string;
  signal?: AbortSignal;
}

/** Every mutating call takes a caller-chosen, deterministic idempotency key. */
export interface MutatingOptions extends CallOptions {
  requestId: string;
}

export type Auth =
  | { kind: "app" }
  | { kind: "basic" }
  | { kind: "bearer"; token: string }
  | { kind: "none" };

export interface RequestSpec<S extends z.ZodType> {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Template used for logs and errors, e.g. `/v2/checkout/orders/:id`. */
  route: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  form?: URLSearchParams;
  schema: S;
  /** Empty 2xx bodies (204) resolve to `null` instead of failing schema parsing. */
  allowEmpty?: boolean;
  /** Safe to repeat: GETs, DELETEs, and POSTs carrying a `PayPal-Request-Id`. */
  idempotent: boolean;
  auth?: Auth;
  options?: CallOptions & { requestId?: string };
}

const REQUEST_ID_MAX = 108;
const MAX_BACKOFF_MS = 8_000;

export function assertRequestId(id: string): void {
  if (typeof id !== "string" || id.length === 0 || id.length > REQUEST_ID_MAX) {
    throw new TypeError(`PayPal-Request-Id must be 1..${REQUEST_ID_MAX} chars`);
  }
}

export class Transport {
  readonly env: PayPalEnv;
  readonly base: string;
  readonly clientId: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: KeyValueStore;
  private readonly maxRetries: number;
  private readonly marginMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly onRequest: ((log: RequestLog) => void) | undefined;
  private readonly partnerAttributionId: string | undefined;
  private inflightToken: Promise<string> | null = null;

  constructor(cfg: PayPalConfig) {
    if (!cfg.clientId || !cfg.clientSecret)
      throw new TypeError("PayPal clientId/clientSecret required");
    this.env = cfg.env;
    this.base = API_BASE[cfg.env];
    this.clientId = cfg.clientId;
    this.secret = cfg.clientSecret;
    // Bind: Workers' global fetch throws "Illegal invocation" when called as a method.
    this.fetchImpl = cfg.fetch ?? ((input, init) => fetch(input, init));
    this.now = cfg.now ?? Date.now;
    this.cache = cfg.cache ?? memoryStore(this.now);
    this.maxRetries = cfg.maxRetries ?? 2;
    this.marginMs = (cfg.tokenMarginSeconds ?? 300) * 1000;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onRequest = cfg.onRequest;
    this.partnerAttributionId = cfg.partnerAttributionId;
  }

  private get tokenKey(): string {
    return `paypal:app-token:${this.env}:${this.clientId}`;
  }

  basicAuth(): string {
    return `Basic ${btoa(`${this.clientId}:${this.secret}`)}`;
  }

  /** App access token, cached until `expires_in - margin`. Concurrent callers share one fetch. */
  async appToken(): Promise<string> {
    const cached = await this.cache.get(this.tokenKey);
    if (cached) {
      const { token, expiresAt } = JSON.parse(cached) as { token: string; expiresAt: number };
      if (expiresAt - this.marginMs > this.now()) return token;
    }
    this.inflightToken ??= this.fetchAppToken().finally(() => {
      this.inflightToken = null;
    });
    return this.inflightToken;
  }

  async invalidateAppToken(): Promise<void> {
    await this.cache.delete(this.tokenKey);
  }

  private async fetchAppToken(): Promise<string> {
    const res = await this.request({
      method: "POST",
      route: "/v1/oauth2/token",
      path: "/v1/oauth2/token",
      form: new URLSearchParams({ grant_type: "client_credentials" }),
      schema: AccessToken,
      idempotent: true,
      auth: { kind: "basic" },
    });
    const expiresAt = this.now() + res.expires_in * 1000;
    const ttlSeconds = Math.max(1, Math.floor(res.expires_in - this.marginMs / 1000));
    await this.cache.put(this.tokenKey, JSON.stringify({ token: res.access_token, expiresAt }), {
      ttlSeconds,
    });
    return res.access_token;
  }

  async request<S extends z.ZodType>(
    spec: RequestSpec<S> & { allowEmpty: true },
  ): Promise<z.output<S> | null>;
  async request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.output<S>>;
  async request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.output<S> | null> {
    const opts = spec.options ?? {};
    if (opts.requestId !== undefined) assertRequestId(opts.requestId);
    if (opts.mock !== undefined && this.env === "live") {
      throw new TypeError("PayPal-Mock-Response is sandbox-only");
    }
    const auth = spec.auth ?? { kind: "app" };
    let url = this.base + spec.path;
    if (spec.query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(spec.query)) if (v !== undefined) q.set(k, String(v));
      const qs = q.toString();
      if (qs) url += `?${qs}`;
    }

    let refreshedToken = false;
    for (let attempt = 1; ; attempt++) {
      const headers = new Headers({ Accept: "application/json" });
      if (auth.kind === "app") headers.set("Authorization", `Bearer ${await this.appToken()}`);
      else if (auth.kind === "basic") headers.set("Authorization", this.basicAuth());
      else if (auth.kind === "bearer") headers.set("Authorization", `Bearer ${auth.token}`);
      let body: string | undefined;
      if (spec.form) {
        headers.set("Content-Type", "application/x-www-form-urlencoded");
        body = spec.form.toString();
      } else if (spec.json !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(spec.json);
      }
      if (spec.method !== "GET") headers.set("Prefer", "return=representation");
      if (opts.requestId) headers.set("PayPal-Request-Id", opts.requestId);
      if (opts.mock) {
        headers.set("PayPal-Mock-Response", JSON.stringify({ mock_application_codes: opts.mock }));
      }
      if (opts.clientMetadataId) headers.set("PayPal-Client-Metadata-Id", opts.clientMetadataId);
      if (this.partnerAttributionId) {
        headers.set("PayPal-Partner-Attribution-Id", this.partnerAttributionId);
      }

      const started = this.now();
      let res: Response;
      try {
        const init: RequestInit = { method: spec.method, headers };
        if (body !== undefined) init.body = body;
        if (opts.signal) init.signal = opts.signal;
        res = await this.fetchImpl(url, init);
      } catch (cause) {
        this.log(spec, 0, attempt, started, undefined);
        if (opts.signal?.aborted) throw cause;
        const err = new PayPalError({
          status: 0,
          code: "NETWORK_ERROR",
          message: cause instanceof Error ? cause.message : "fetch failed",
          route: `${spec.method} ${spec.route}`,
          cause,
        });
        if (spec.idempotent && attempt <= this.maxRetries) {
          await this.sleep(this.backoff(attempt, null));
          continue;
        }
        throw err;
      }

      const debugId = res.headers.get("paypal-debug-id") ?? undefined;
      this.log(spec, res.status, attempt, started, debugId);
      const text = await res.text();

      if (res.ok) {
        if (!text.trim()) {
          if (spec.allowEmpty) return null;
          throw new PayPalResponseError(
            `${spec.method} ${spec.route}`,
            res.status,
            ["empty body"],
            debugId,
          );
        }
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new PayPalResponseError(
            `${spec.method} ${spec.route}`,
            res.status,
            ["invalid JSON"],
            debugId,
          );
        }
        const parsed = spec.schema.safeParse(data);
        if (!parsed.success) {
          throw new PayPalResponseError(
            `${spec.method} ${spec.route}`,
            res.status,
            parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
            debugId,
          );
        }
        return parsed.data;
      }

      // A revoked/rotated app token: drop it and retry once, whatever the method.
      if (res.status === 401 && auth.kind === "app" && !refreshedToken) {
        refreshedToken = true;
        await this.invalidateAppToken();
        continue;
      }

      const err = parseErrorBody(res.status, `${spec.method} ${spec.route}`, text, debugId);
      if (spec.idempotent && err.retryable && attempt <= this.maxRetries) {
        await this.sleep(this.backoff(attempt, res.headers.get("retry-after")));
        continue;
      }
      throw err;
    }
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    const base = 250 * 2 ** (attempt - 1);
    return Math.min(base + Math.floor(Math.random() * base), MAX_BACKOFF_MS);
  }

  private log(
    spec: RequestSpec<z.ZodType>,
    status: number,
    attempt: number,
    started: number,
    debugId: string | undefined,
  ): void {
    this.onRequest?.({
      method: spec.method,
      route: spec.route,
      status,
      attempt,
      durationMs: this.now() - started,
      debugId,
    });
  }
}
