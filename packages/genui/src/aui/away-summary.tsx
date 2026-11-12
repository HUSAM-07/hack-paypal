import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn, useControllable, useIsoLayoutEffect } from "./lib/utils";
import "./away-summary.css";

export type AwayKind = "needs-you" | "failed" | "done";

export type AwayItem = {
  id: string;
  title: string;
  kind: AwayKind;
  /** One line of what happened – "Waiting on: Which queue?" */
  detail?: string;
  /** The button's label; false leaves the row without one. Defaults by kind: Decide, Retry, Open */
  action?: string | false;
};

export type AwaySummaryLabels = {
  title: string;
  /** Singular and row wording: "1 needs you", "needs you: Ingest pipeline" */
  needsYou: string;
  /** Plural wording for the counts: "2 need you". Falls back to needsYou when only that one is overridden */
  needYou: string;
  /** Announced once nothing is waiting any more */
  nothingNeedsYou: string;
  failed: string;
  done: string;
  decide: string;
  retry: string;
  open: string;
  showMore: (n: number) => string;
  showLess: string;
  gotIt: string;
  /** The one row shown when there are no items */
  empty: string;
  /** "since 9:40" for timeStyle="clock" */
  since: (clock: string) => string;
  /** The folded one-liner: "You were away 2h 14m · 8 updates". `when` is empty when no `since` was given */
  divider: (when: string, updates: number, timeStyle: "duration" | "clock") => string;
};

export interface AwaySummaryProps extends HTMLAttributes<HTMLElement> {
  /** When the person left. Leave it out and the summary simply carries no time */
  since?: Date | number | string;
  /** What happened meanwhile. Defaults to DEFAULT_AWAY_ITEMS */
  items?: AwayItem[];
  /** A row's button was pressed. Return a promise and the button shows a spinner until it settles */
  onAction?: (id: string, item: AwayItem) => void | Promise<unknown>;
  /** Got it was pressed */
  onDismiss?: () => void;
  /** Folded down to the one-line divider */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** The rows past `limit` are showing */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Rows before Show N more */
  limit?: number;
  timeStyle?: "duration" | "clock";
  /** Now – defaults to the clock, updated every half minute */
  now?: Date | number;
  labels?: Partial<AwaySummaryLabels>;
}

const plural = (n: number) => (n === 1 ? "" : "s");

const defaultLabels: AwaySummaryLabels = {
  title: "While you were away",
  needsYou: "needs you",
  needYou: "need you",
  nothingNeedsYou: "Nothing needs you",
  failed: "failed",
  done: "done",
  decide: "Decide",
  retry: "Retry",
  open: "Open",
  showMore: (n) => `Show ${n} more`,
  showLess: "Show less",
  gotIt: "Got it",
  empty: "Nothing happened while you were away",
  since: (clock) => `since ${clock}`,
  divider: (when, n, style) =>
    `${style === "clock" ? "Away" : "You were away"}${when ? ` ${when}` : ""} · ${n} update${plural(n)}`,
};

/** What a bare `<AwaySummary />` shows: two questions, one failure and five finished tasks. */
export const DEFAULT_AWAY_ITEMS: AwayItem[] = [
  {
    id: "ingest",
    title: "Ingest pipeline",
    kind: "needs-you",
    detail: "Waiting on: Which queue – Kafka or SQS?",
  },
  {
    id: "report",
    title: "Weekly report",
    kind: "needs-you",
    detail: "Waiting on: Send it to Dana or the whole team?",
  },
  {
    id: "billing",
    title: "Billing sync",
    kind: "failed",
    detail: "Failed: rate limit on Stripe after 1,284 invoices",
  },
  { id: "auth", title: "Auth refactor", kind: "done", detail: "Opened PR 482 · on staging" },
  { id: "usage", title: "Usage page", kind: "done", detail: "Shipped to Northwind" },
  { id: "docs", title: "Evalkit docs", kind: "done", detail: "Published 14 pages" },
  { id: "load", title: "Load test", kind: "done", detail: "Passed at 20k events a minute" },
  { id: "flaky", title: "Flaky tests", kind: "done", detail: "Quarantined 3 tests in checkout" },
];

const KINDS = ["needs-you", "failed", "done"] as const;
const rank: Record<AwayKind, number> = { "needs-you": 0, failed: 1, done: 2 };
/** The fold's own transition, after which the card stops clipping its shadow and focus rings */
const FOLD_MS = 320;

function toMs(v: Date | number | string): number {
  return v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime();
}

function formatAway(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Keeps a row where it first appeared; new rows slot in by kind (needs you, failed, done). */
function useStableOrder(items: AwayItem[]): AwayItem[] {
  const order = useRef<string[]>([]);
  return useMemo(() => {
    const byId = new Map(items.map((it) => [it.id, it]));
    const kept = order.current.filter((id) => byId.has(id));
    const fresh = items.filter((it) => !kept.includes(it.id));
    for (const it of fresh) {
      let at = kept.length;
      for (let i = 0; i < kept.length; i++) {
        if (rank[byId.get(kept[i] as string)!.kind] > rank[it.kind]) {
          at = i;
          break;
        }
      }
      kept.splice(at, 0, it.id);
    }
    order.current = kept;
    return kept.map((id) => byId.get(id)!);
  }, [items]);
}

function Mark({ kind }: { kind: AwayKind }) {
  if (kind === "done")
    return (
      <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="var(--aui-awc-done)" />
        <path
          className="aui-awc__tick"
          d="M4.3 7.2 6.1 9 9.7 5.2"
          pathLength={1}
          fill="none"
          stroke="var(--aui-awc-on)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (kind === "failed")
    return (
      <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="var(--aui-awc-failed)" />
        <path d="M7 4v3.4" stroke="var(--aui-awc-on)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="9.8" r="0.85" fill="var(--aui-awc-on)" />
      </svg>
    );
  return (
    <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
      <circle className="aui-awc__halo" cx="7" cy="7" r="5.25" fill="var(--aui-awc-needs)" />
      <circle cx="7" cy="7" r="5.25" fill="none" stroke="var(--aui-awc-needs)" strokeWidth="1.5" />
      <circle cx="7" cy="7" r="2.25" fill="var(--aui-awc-needs)" />
    </svg>
  );
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg
      className="aui-awc__chev"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={up ? { transform: "rotate(180deg)" } : undefined}
    >
      <path
        d="M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export const AwaySummary = forwardRef<HTMLElement, AwaySummaryProps>(function AwaySummary(
  {
    since,
    items = DEFAULT_AWAY_ITEMS,
    onAction,
    onDismiss,
    collapsed: collapsedProp,
    defaultCollapsed = false,
    onCollapsedChange,
    expanded: expandedProp,
    defaultExpanded = false,
    onExpandedChange,
    limit = 5,
    timeStyle = "duration",
    now: nowProp,
    labels: labelsProp,
    className,
    ...rest
  },
  ref,
) {
  const L: AwaySummaryLabels = {
    ...defaultLabels,
    // a translated "needs you" should not be paired with the English plural
    ...(labelsProp?.needsYou && !labelsProp.needYou ? { needYou: labelsProp.needsYou } : null),
    ...labelsProp,
  };
  const [collapsed, setCollapsed] = useControllable(
    collapsedProp,
    defaultCollapsed,
    onCollapsedChange,
  );
  const [expanded, setExpanded] = useControllable(expandedProp, defaultExpanded, onExpandedChange);
  const [working, setWorking] = useState<Set<string>>(() => new Set());
  const [announce, setAnnounce] = useState("");
  const [settled, setSettled] = useState(true);
  const [tick, setTick] = useState(() => Date.now());
  const uid = useId();
  const cardId = `${uid}-card`;
  const extraId = `${uid}-more`;

  useEffect(() => {
    if (nowProp !== undefined || since === undefined) return;
    const t = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, [nowProp, since]);

  const now = nowProp !== undefined ? toMs(nowProp) : tick;
  const when =
    since === undefined
      ? ""
      : timeStyle === "clock"
        ? L.since(formatClock(toMs(since)))
        : formatAway(now - toMs(since));

  const rows = useStableOrder(items);
  const counts = useMemo(() => {
    const c = { "needs-you": 0, failed: 0, done: 0 } as Record<AwayKind, number>;
    for (const it of items) c[it.kind]++;
    return c;
  }, [items]);
  const total = items.length;
  const needs = counts["needs-you"];

  const kindWord = (k: AwayKind) =>
    k === "done" ? L.done : k === "failed" ? L.failed : L.needsYou;
  const countWord = (k: AwayKind, n: number) =>
    `${n} ${k === "needs-you" ? (n === 1 ? L.needsYou : L.needYou) : kindWord(k)}`;
  const shownKinds = KINDS.filter((k) => counts[k] > 0);

  const shown = rows.slice(0, limit);
  const extra = rows.slice(limit);

  // ---- every row that changed kind is announced, then what is still waiting
  const prevKinds = useRef<Map<string, AwayKind> | null>(null);
  useEffect(() => {
    const prev = prevKinds.current;
    prevKinds.current = new Map(items.map((it) => [it.id, it.kind]));
    if (!prev) return;
    const changed = items.filter((it) => prev.has(it.id) && prev.get(it.id) !== it.kind);
    if (!changed.length) return;
    setAnnounce(
      `${changed.map((it) => `${it.title}: ${kindWord(it.kind)}.`).join(" ")} ${needs === 0 ? L.nothingNeedsYou : countWord("needs-you", needs)}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ---- focus bookkeeping
  const cardRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLButtonElement>(null);
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusedAction = useRef<string | null>(null);
  const pendingFocus = useRef<"divider" | "card" | null>(null);
  const firstNewId = useRef<string | null>(null);

  const fold = useCallback(
    (next: boolean, focus: boolean) => {
      if (focus) pendingFocus.current = next ? "divider" : "card";
      setCollapsed(next);
    },
    [setCollapsed],
  );

  // folded from outside while focus was inside the card → move to the divider
  const wasCollapsed = useRef(collapsed);
  useIsoLayoutEffect(() => {
    const changed = wasCollapsed.current !== collapsed;
    if (collapsed && changed && cardRef.current?.contains(document.activeElement)) {
      pendingFocus.current = "divider";
    }
    wasCollapsed.current = collapsed;
    if (pendingFocus.current === "divider") {
      pendingFocus.current = null;
      dividerRef.current?.focus();
    } else if (pendingFocus.current === "card") {
      pendingFocus.current = null;
      // the first thing you can act on – never a row tucked away behind "Show more"
      const targets = cardRef.current?.querySelectorAll<HTMLButtonElement>(
        ".aui-awc__act, .aui-awc__more, .aui-awc__got",
      );
      Array.from(targets ?? [])
        .find((el) => !el.closest("[inert]"))
        ?.focus();
    }
    if (!changed) return;
    // clip while the fold moves, then let the shadow and focus rings out again
    setSettled(false);
    const t = setTimeout(() => setSettled(true), FOLD_MS + 20);
    return () => clearTimeout(t);
  }, [collapsed]);

  // a row lost its button while it had focus → next action
  useIsoLayoutEffect(() => {
    const id = focusedAction.current;
    if (!id || collapsed) return;
    if (actionRefs.current.get(id)) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const idx = rows.findIndex((r) => r.id === id);
    const after = rows.slice(idx + 1).concat(rows.slice(0, Math.max(0, idx)));
    for (const r of after) {
      const el = actionRefs.current.get(r.id);
      if (el) {
        el.focus();
        return;
      }
    }
    cardRef.current?.querySelector<HTMLButtonElement>(".aui-awc__more, .aui-awc__got")?.focus();
  });

  // Show more → focus the first new row's action
  useEffect(() => {
    if (!expanded || !firstNewId.current) return;
    const el = actionRefs.current.get(firstNewId.current);
    firstNewId.current = null;
    el?.focus();
  }, [expanded]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = (item: AwayItem) => {
    if (working.has(item.id)) return;
    const res = onAction?.(item.id, item);
    if (res && typeof (res as Promise<unknown>).then === "function") {
      setWorking((s) => new Set(s).add(item.id));
      const settle = () => {
        if (!alive.current) return;
        setWorking((s) => {
          const n = new Set(s);
          n.delete(item.id);
          return n;
        });
      };
      (res as Promise<unknown>).then(settle, settle);
    }
  };

  const onCardKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      fold(true, true);
    }
  };

  const renderRow = (it: AwayItem) => {
    const label =
      it.action === false
        ? null
        : (it.action ??
          (it.kind === "needs-you" ? L.decide : it.kind === "failed" ? L.retry : L.open));
    const busy = working.has(it.id);
    return (
      <li
        key={it.id}
        className="aui-awc__row"
        data-kind={it.kind}
        data-detail={it.detail ? "" : undefined}
      >
        <span className="aui-awc__mark" key={it.kind}>
          <Mark kind={it.kind} />
          <span className="aui-sr-only">{kindWord(it.kind)}: </span>
        </span>
        <span className="aui-awc__text">
          <span className="aui-awc__name" title={it.title} dir="auto">
            {it.title}
          </span>
          {it.detail && (
            <span className="aui-awc__detail" key={it.detail} title={it.detail} dir="auto">
              {it.detail}
            </span>
          )}
        </span>
        {label ? (
          <button
            type="button"
            ref={(el) => {
              if (el) actionRefs.current.set(it.id, el);
              else actionRefs.current.delete(it.id);
            }}
            className="aui-awc__act"
            data-kind={it.kind}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            aria-label={`${label}: ${it.title}`}
            onFocus={() => {
              focusedAction.current = it.id;
            }}
            onBlur={() => {
              focusedAction.current = null;
            }}
            onClick={() => run(it)}
          >
            <span className="aui-awc__act-label">{label}</span>
            {busy && <span className="aui-awc__spin" aria-hidden="true" />}
          </button>
        ) : (
          <span />
        )}
      </li>
    );
  };

  return (
    <section
      ref={ref}
      aria-label={L.title}
      {...rest}
      className={cn("aui-root aui-awc", className)}
      data-collapsed={collapsed ? "" : undefined}
    >
      <span className="aui-sr-only" role="status" aria-live="polite">
        {announce}
      </span>

      <div
        className="aui-awc__fold"
        data-open={collapsed ? "" : undefined}
        data-settled={collapsed && settled ? "" : undefined}
      >
        <div className="aui-awc__fold-in" inert={!collapsed}>
          <div className="aui-awc__divider">
            <span className="aui-awc__rule" aria-hidden="true" />
            <button
              ref={dividerRef}
              type="button"
              className="aui-awc__divider-btn"
              aria-expanded={false}
              aria-controls={cardId}
              onClick={() => fold(false, true)}
            >
              {needs > 0 && (
                <span className="aui-awc__dot" data-kind="needs-you" aria-hidden="true" />
              )}
              <span className="aui-awc__divider-text" title={L.divider(when, total, timeStyle)}>
                {L.divider(when, total, timeStyle)}
              </span>
              {needs > 0 && <span className="aui-sr-only">, {countWord("needs-you", needs)}</span>}
              <Chevron />
            </button>
            <span className="aui-awc__rule" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div
        className="aui-awc__fold"
        data-open={collapsed ? undefined : ""}
        data-settled={!collapsed && settled ? "" : undefined}
      >
        <div className="aui-awc__fold-in" inert={collapsed}>
          <div className="aui-awc__card" id={cardId} ref={cardRef} onKeyDown={onCardKey}>
            <header className="aui-awc__head">
              <h3 className="aui-awc__title">
                {L.title}
                {when && (
                  <span className="aui-awc__when">
                    <span aria-hidden="true"> · </span>
                    <span className="aui-sr-only">, </span>
                    {when}
                  </span>
                )}
              </h3>
              {shownKinds.length > 0 && (
                <p className="aui-awc__counts">
                  <span className="aui-sr-only">
                    {shownKinds.map((k) => countWord(k, counts[k])).join(", ")}
                  </span>
                  {shownKinds.map((k, i) => (
                    <span className="aui-awc__count" key={k} aria-hidden="true">
                      {i > 0 && <span className="aui-awc__sep">·</span>}
                      <span className="aui-awc__dot" data-kind={k} />
                      <span className="aui-awc__n" key={countWord(k, counts[k])}>
                        {countWord(k, counts[k])}
                      </span>
                    </span>
                  ))}
                </p>
              )}
            </header>

            <div className="aui-awc__rows">
              {total === 0 ? (
                <p className="aui-awc__empty">{L.empty}</p>
              ) : (
                <ul className="aui-awc__list">{shown.map(renderRow)}</ul>
              )}
              {extra.length > 0 && (
                <div className="aui-awc__extra" data-open={expanded ? "" : undefined} id={extraId}>
                  <div className="aui-awc__extra-in" inert={!expanded}>
                    <ul className="aui-awc__list">{extra.map(renderRow)}</ul>
                  </div>
                </div>
              )}
            </div>

            <footer className="aui-awc__foot">
              {extra.length > 0 && (
                <button
                  type="button"
                  className="aui-awc__more"
                  aria-expanded={expanded}
                  aria-controls={extraId}
                  onClick={() => {
                    if (!expanded)
                      firstNewId.current = extra.find((r) => r.action !== false)?.id ?? null;
                    setExpanded(!expanded);
                  }}
                >
                  {expanded ? L.showLess : L.showMore(extra.length)}
                  <Chevron up={expanded} />
                </button>
              )}
              <button
                type="button"
                className="aui-awc__got"
                aria-expanded={true}
                aria-controls={cardId}
                onClick={() => {
                  onDismiss?.();
                  fold(true, true);
                }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M5 14L8.5 17.5L19 6.5"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
                {L.gotIt}
              </button>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
});
AwaySummary.displayName = "AwaySummary";
