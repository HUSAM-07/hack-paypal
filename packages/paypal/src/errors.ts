/**
 * PayPal error bodies come in two shapes: the REST one (`name`, `message`, `debug_id`,
 * `details[]`) and the OAuth one (`error`, `error_description`). Both normalize to
 * `PayPalError`. Detail `value` fields are dropped on purpose: PayPal echoes request
 * values there, which can include vault IDs, and errors end up in logs.
 */

export interface PayPalErrorDetail {
  issue: string;
  description?: string;
  field?: string;
  location?: string;
}

export class PayPalError extends Error {
  override readonly name = "PayPalError";
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;
  /** PayPal's error name, e.g. `UNPROCESSABLE_ENTITY`, `RESOURCE_NOT_FOUND`, `invalid_client`. */
  readonly code: string;
  readonly debugId: string | undefined;
  readonly details: readonly PayPalErrorDetail[];
  /** Route template (no ids), e.g. `POST /v2/checkout/orders/:id/capture`. */
  readonly route: string;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    debugId?: string | undefined;
    details?: PayPalErrorDetail[];
    route: string;
    cause?: unknown;
  }) {
    super(
      `${init.route} → ${init.status} ${init.code}: ${init.message}${init.debugId ? ` (debug_id ${init.debugId})` : ""}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.status = init.status;
    this.code = init.code;
    this.debugId = init.debugId;
    this.details = init.details ?? [];
    this.route = init.route;
  }

  get issues(): string[] {
    return this.details.map((d) => d.issue);
  }

  hasIssue(issue: string): boolean {
    return this.details.some((d) => d.issue === issue);
  }

  /** True for failures worth retrying with the same idempotency key. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** The response arrived but didn't match the schema for the fields we use. */
export class PayPalResponseError extends Error {
  override readonly name = "PayPalResponseError";
  constructor(
    readonly route: string,
    readonly status: number,
    readonly issues: string[],
    readonly debugId: string | undefined,
  ) {
    super(`${route} → ${status}: unexpected response shape: ${issues.join("; ")}`);
  }
}

export function parseErrorBody(
  status: number,
  route: string,
  text: string,
  headerDebugId: string | undefined,
): PayPalError {
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const details: PayPalErrorDetail[] = Array.isArray(b.details)
    ? b.details.flatMap((d) => {
        if (!d || typeof d !== "object") return [];
        const r = d as Record<string, unknown>;
        const issue = str(r.issue);
        if (!issue) return [];
        const out: PayPalErrorDetail = { issue };
        const description = str(r.description);
        const field = str(r.field);
        const location = str(r.location);
        if (description) out.description = description;
        if (field) out.field = field;
        if (location) out.location = location;
        return [out];
      })
    : [];
  return new PayPalError({
    status,
    route,
    code: str(b.name) ?? str(b.error) ?? `HTTP_${status}`,
    message: str(b.message) ?? str(b.error_description) ?? "request failed",
    debugId: str(b.debug_id) ?? headerDebugId,
    details,
  });
}
