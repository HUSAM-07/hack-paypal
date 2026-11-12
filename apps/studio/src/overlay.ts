/**
 * Private writes for the hosted demo. A visitor's Approve, Release and Void are kept in their own
 * cookie and replayed over the engine's reads, so they see the effect while the shared ledger
 * (the numbers the demo script and every other visitor rely on) never changes. Pure.
 */
import {
  isProgrammeCurrency,
  PROGRAMME_CATEGORIES,
  type ProgrammeCurrency,
  type ProgrammeTerms,
} from "@pact/protocol";
import type { RawEngine, RawReviewFlag, ReviewAction } from "./dashboard";
import { ReviewRejected } from "./dashboard";

export const OVERLAY_COOKIE = "cited_studio_private";
/** One visitor's private changes last this long from their first change. */
export const OVERLAY_TTL_SECONDS = 30 * 60;
/** Caps the cookie: past this many changes the oldest are dropped. */
const MAX_CHANGES = 24;

export type OverlayChange =
  | { kind: "approve"; approvalId: string; brandId: string; amountMinor: number }
  | { kind: "review"; flagId: string; action: ReviewAction }
  // A cookie from before currencies carries no currency: it is a dollar programme.
  | {
      kind: "programme";
      terms: Omit<ProgrammeTerms, "currency"> & { currency?: ProgrammeCurrency };
    };

export interface Overlay {
  /** Unix seconds: when this visitor's private changes are dropped. */
  expiresAt: number;
  changes: OverlayChange[];
}

const ID = /^[A-Za-z0-9_:.-]{1,200}$/;

function isChange(x: unknown): x is OverlayChange {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  if (c.kind === "approve")
    return (
      typeof c.approvalId === "string" &&
      ID.test(c.approvalId) &&
      typeof c.brandId === "string" &&
      ID.test(c.brandId) &&
      Number.isSafeInteger(c.amountMinor) &&
      (c.amountMinor as number) > 0
    );
  if (c.kind === "review")
    return (
      typeof c.flagId === "string" &&
      ID.test(c.flagId) &&
      (c.action === "release" || c.action === "void")
    );
  if (c.kind === "programme") return isTerms(c.terms);
  return false;
}

/** A programme's terms in a cookie are only believed if they still name a catalogue product. */
function isTerms(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const t = x as Record<string, unknown>;
  const product = PROGRAMME_CATEGORIES.flatMap((c) =>
    c.products.map((p) => ({ ...p, category: c.id })),
  ).find((p) => p.upc === t.upc);
  return (
    !!product &&
    t.brandId === product.brandId &&
    t.category === product.category &&
    t.name === product.brand &&
    t.product === product.product &&
    // A cookie from before currencies has none: it is a dollar programme.
    (t.currency === undefined ||
      (typeof t.currency === "string" && isProgrammeCurrency(t.currency))) &&
    Number.isSafeInteger(t.depositMinor) &&
    (t.depositMinor as number) > 0 &&
    Number.isSafeInteger(t.commissionBps) &&
    (t.commissionBps as number) >= 0 &&
    (t.commissionBps as number) <= 10_000
  );
}

const b64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const unb64 = (s: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (ch) => ch.charCodeAt(0)),
  );

/** Encodes the overlay as a cookie value. Unsigned: a forged one only changes its owner's view. */
export function encodeOverlay(o: Overlay): string {
  return b64(JSON.stringify({ e: o.expiresAt, c: o.changes.slice(-MAX_CHANGES) }));
}

/** The visitor's live overlay, or an empty one (missing, malformed or expired cookie). */
export function decodeOverlay(value: string | undefined, nowSec: number): Overlay | null {
  if (!value || value.length > 4000) return null;
  try {
    const raw = JSON.parse(unb64(value)) as { e?: unknown; c?: unknown };
    if (typeof raw.e !== "number" || raw.e <= nowSec || !Array.isArray(raw.c)) return null;
    return { expiresAt: raw.e, changes: raw.c.filter(isChange).slice(-MAX_CHANGES) };
  } catch {
    return null;
  }
}

/** Reads the overlay from a request's Cookie header. */
export function overlayFromRequest(req: Request, nowSec: number): Overlay | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === OVERLAY_COOKIE) return decodeOverlay(v.join("="), nowSec);
  }
  return null;
}

/** Appends a change, starting a new overlay (and its reset clock) when there is none. */
export function withChange(o: Overlay | null, change: OverlayChange, nowSec: number): Overlay {
  const base = o ?? { expiresAt: nowSec + OVERLAY_TTL_SECONDS, changes: [] };
  return { expiresAt: base.expiresAt, changes: [...base.changes, change].slice(-MAX_CHANGES) };
}

export function overlayCookie(o: Overlay, nowSec: number, path = "/studio"): string {
  const maxAge = Math.max(0, o.expiresAt - nowSec);
  return `${OVERLAY_COOKIE}=${encodeOverlay(o)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

/**
 * Checks a review against the (already overlaid) data the way the engine does, so a private
 * decision is refused exactly when a shared one would be.
 */
export function checkReview(raw: RawEngine, flagId: string): RawReviewFlag {
  const flag = (raw.reviewFlags ?? []).find((f) => f.id === flagId);
  if (!flag) throw new ReviewRejected(404, "unknown_flag");
  if (!flag.hold) throw new ReviewRejected(409, "not_a_hold");
  if (flag.status !== "open") throw new ReviewRejected(409, `already_${flag.status}`);
  if (flag.credit?.state !== "pending")
    throw new ReviewRejected(409, `credit_${flag.credit?.state ?? "missing"}`);
  return flag;
}

function approve(raw: RawEngine, c: Extract<OverlayChange, { kind: "approve" }>): RawEngine {
  return {
    ...raw,
    deposits: raw.deposits.map((d) => {
      const key = `private-approval-${c.approvalId}`;
      if (d.brandId !== c.brandId || d.deposits.some((x) => x.id === key)) return d;
      return {
        ...d,
        deposited: d.deposited + c.amountMinor,
        available: d.available + c.amountMinor,
        deposits: [
          ...d.deposits,
          {
            id: key,
            kind: "topup",
            amountMinor: c.amountMinor,
            returnedMinor: 0,
            status: "captured",
            createdAt: raw.now,
          },
        ],
      };
    }),
  };
}

/** A programme the visitor started: empty, funded, and only in their view. */
function programme(raw: RawEngine, c: Extract<OverlayChange, { kind: "programme" }>): RawEngine {
  const t = c.terms;
  if (raw.lift.some((b) => b.brandId === t.brandId || b.upc === t.upc)) return raw;
  return {
    ...raw,
    lift: [
      ...raw.lift,
      {
        brandId: t.brandId,
        name: t.name,
        category: t.category,
        upc: t.upc,
        currency: t.currency ?? "USD",
        commissionBps: t.commissionBps,
        arms: {
          test: { sessions: 0, purchases: 0 },
          placebo: { sessions: 0, purchases: 0 },
          none: { sessions: 0, purchases: 0 },
        },
        lift: null,
        lowerBound: null,
        attributableFraction: 0,
        exposedSales: 0,
        causedUnits: 0,
      },
    ],
    deposits: [
      ...raw.deposits,
      {
        brandId: t.brandId,
        name: t.name,
        currency: t.currency ?? "USD",
        deposited: t.depositMinor,
        reserved: 0,
        spent: 0,
        returned: 0,
        available: t.depositMinor,
        deposits: [
          {
            id: `private-programme-${t.brandId}`,
            kind: "initial",
            amountMinor: t.depositMinor,
            returnedMinor: 0,
            // No createdAt: "day N" in the batch labels counts from the first real deposit.
            status: "captured",
          },
        ],
      },
    ],
  };
}

function review(raw: RawEngine, c: Extract<OverlayChange, { kind: "review" }>): RawEngine {
  let flag: RawReviewFlag;
  try {
    flag = checkReview(raw, c.flagId);
  } catch {
    return raw; // stale: the shared ledger moved on (e.g. a reseed); skip it
  }
  const voided = c.action === "void";
  const flags = (raw.reviewFlags ?? []).map((f) => {
    // A void closes every open hold on the credit, as the engine does; release only this one.
    const hit = voided ? f.creditId === flag.creditId && f.hold && f.status === "open" : f === flag;
    if (!hit) return f;
    return {
      ...f,
      status: voided ? "voided" : "released",
      resolvedAt: raw.now,
      credit: f.credit && voided ? { ...f.credit, state: "voided" } : f.credit,
    };
  });
  const stillHeld = flags.some(
    (f) => f.creditId === flag.creditId && f.hold && f.status === "open",
  );
  const creators = raw.creators.map((cr) => {
    const credit = cr.credits.find((x) => x.id === flag.creditId);
    if (!credit) return cr;
    const amt = credit.amountMinor;
    const wasHeld = credit.held === true;
    const nowHeld = !voided && stillHeld;
    const heldDelta = (wasHeld ? amt : 0) - (nowHeld ? amt : 0);
    return {
      ...cr,
      totals: {
        ...cr.totals,
        pending: cr.totals.pending - (voided ? amt : 0),
        voided: cr.totals.voided + (voided ? amt : 0),
        ...(cr.totals.held === undefined ? {} : { held: cr.totals.held - heldDelta }),
      },
      credits: cr.credits.map((x) =>
        x.id !== credit.id
          ? x
          : voided
            ? { ...x, state: "voided", voidReason: "review", held: false, holdReasons: [] }
            : {
                ...x,
                held: nowHeld,
                holdReasons: (x.holdReasons ?? []).filter((r) => r !== flag.reason),
              },
      ),
    };
  });
  if (!voided) return { ...raw, reviewFlags: flags, creators };
  const amt = flag.credit?.amountMinor ?? 0;
  const owner = flag.credit?.creatorId;
  const journeys = raw.journeys.map((j) => {
    if (!j.shapley.some((s) => s.captureId === flag.captureId)) return j;
    return {
      ...j,
      commission: {
        ...j.commission,
        pending: j.commission.pending - amt,
        voided: j.commission.voided + amt,
      },
      shapley: j.shapley.map((s) =>
        s.captureId !== flag.captureId
          ? s
          : {
              ...s,
              shares: s.shares.map((x) =>
                x.creatorId === owner && x.state === "pending" ? { ...x, state: "voided" } : x,
              ),
            },
      ),
    };
  });
  return { ...raw, reviewFlags: flags, creators, journeys };
}

/** The engine's data as this visitor sees it: the shared ledger plus their private changes. */
export function applyOverlay(raw: RawEngine, o: Overlay | null): RawEngine {
  if (!o) return raw;
  let out = raw;
  for (const c of o.changes)
    out =
      c.kind === "approve"
        ? approve(out, c)
        : c.kind === "programme"
          ? programme(out, c)
          : review(out, c);
  return out;
}
