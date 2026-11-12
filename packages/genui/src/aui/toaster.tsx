import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn, useIsoLayoutEffect } from "./lib/utils";
import "./toaster.css";

/* =====================================================================
 * store – toast() can be called from anywhere
 * ===================================================================== */

export type ToastId = string;
export type ToastType = "default" | "success" | "error" | "info" | "loading";
export type ToastAction = {
  label: ReactNode;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
};
export type ToastOptions = {
  id?: ToastId;
  description?: ReactNode;
  action?: ToastAction;
  duration?: number;
  icon?: ReactNode;
  toaster?: string;
  onDismiss?: (id: ToastId) => void;
};
type ToastData = ToastOptions & {
  id: ToastId;
  type: ToastType;
  title: ReactNode;
  version: number;
  removing?: boolean;
};

type Message = ReactNode | { title: ReactNode; description?: ReactNode };
type PromiseMessages<T> = {
  loading: Message;
  success: Message | ((value: T) => Message);
  error: Message | ((error: unknown) => Message);
};

let toasts: ToastData[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
let counter = 0;
/** how long a closed toast stays mounted for its exit */
const EXIT_MS = 420;

function upsert(type: ToastType, title: ReactNode, opts: ToastOptions = {}): ToastId {
  const id = opts.id ?? `toast-${++counter}`;
  const existing = toasts.find((t) => t.id === id);
  if (existing && !existing.removing) {
    toasts = toasts.map((t) =>
      t.id === id ? { ...t, ...opts, type, title, id, version: t.version + 1 } : t,
    );
  } else {
    toasts = [{ ...opts, id, type, title, version: 0 }, ...toasts.filter((t) => t.id !== id)];
  }
  emit();
  return id;
}

function dismiss(id?: ToastId) {
  const targets = toasts.filter((t) => (id === undefined || t.id === id) && !t.removing);
  if (!targets.length) return;
  toasts = toasts.map((t) => (targets.includes(t) ? { ...t, removing: true } : t));
  emit();
  targets.forEach((t) => t.onDismiss?.(t.id));
  setTimeout(() => {
    // only drop the closed ones – a new toast may reuse the id meanwhile
    toasts = toasts.filter((t) => !(t.removing && targets.some((x) => x.id === t.id)));
    emit();
  }, EXIT_MS);
}

const split = (m: Message): { title: ReactNode; description?: ReactNode } =>
  m && typeof m === "object" && "title" in (m as object)
    ? (m as { title: ReactNode; description?: ReactNode })
    : { title: m as ReactNode };

type ToastFn = ((title: ReactNode, opts?: ToastOptions) => ToastId) & {
  success: (title: ReactNode, opts?: ToastOptions) => ToastId;
  error: (title: ReactNode, opts?: ToastOptions) => ToastId;
  info: (title: ReactNode, opts?: ToastOptions) => ToastId;
  loading: (title: ReactNode, opts?: ToastOptions) => ToastId;
  promise: <T>(
    p: Promise<T> | (() => Promise<T>),
    messages: PromiseMessages<T>,
    opts?: ToastOptions,
  ) => Promise<T>;
  dismiss: (id?: ToastId) => void;
};

export const toast: ToastFn = Object.assign(
  (title: ReactNode, opts?: ToastOptions) => upsert("default", title, opts),
  {
    success: (title: ReactNode, opts?: ToastOptions) => upsert("success", title, opts),
    error: (title: ReactNode, opts?: ToastOptions) => upsert("error", title, opts),
    info: (title: ReactNode, opts?: ToastOptions) => upsert("info", title, opts),
    loading: (title: ReactNode, opts?: ToastOptions) =>
      upsert("loading", title, { duration: Infinity, ...opts }),
    promise: <T,>(
      p: Promise<T> | (() => Promise<T>),
      messages: PromiseMessages<T>,
      opts: ToastOptions = {},
    ) => {
      const l = split(messages.loading);
      const id = upsert("loading", l.title, {
        ...opts,
        description: l.description,
        duration: Infinity,
      });
      const promise = typeof p === "function" ? p() : p;
      promise.then(
        (v) => {
          const m = split(
            typeof messages.success === "function"
              ? (messages.success as (v: T) => Message)(v)
              : messages.success,
          );
          upsert("success", m.title, { ...opts, id, description: m.description });
        },
        (e) => {
          const m = split(
            typeof messages.error === "function"
              ? (messages.error as (e: unknown) => Message)(e)
              : messages.error,
          );
          upsert("error", m.title, { ...opts, id, description: m.description });
        },
      );
      return promise;
    },
    dismiss,
  },
);

/* =====================================================================
 * Toaster
 * ===================================================================== */

export type ToasterPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface ToasterProps extends Omit<HTMLAttributes<HTMLElement>, "id"> {
  position?: ToasterPosition;
  /** Positions the stack inside the nearest positioned ancestor instead of the viewport */
  inline?: boolean;
  /** Only shows toasts sent with { toaster: id } */
  id?: string;
  duration?: number;
  visibleToasts?: number;
  /** Always shows the stack fanned out instead of on hover and focus */
  expand?: boolean;
  offset?: number;
  gap?: number;
  hotkey?: string | null;
  hairline?: boolean;
  closeButton?: boolean;
  label?: string;
  /** Label of each toast's close button */
  closeLabel?: string;
  /** Fires when the stack fans out or collapses (hover, focus, F8) */
  onExpandedChange?: (expanded: boolean) => void;
}

const PEEK = 10;

/** Status icon: a spinner arc that closes into a ring while a check / cross / i draws in. */
function StatusIcon({ type }: { type: ToastType }) {
  return (
    <svg viewBox="0 0 24 24" className="aui-ts__status" data-type={type} aria-hidden="true">
      <g className="aui-ts__spin">
        <circle cx="12" cy="12" r="9.25" className="aui-ts__ring" pathLength={1} />
      </g>
      <path
        d="M8.3 12.4l2.5 2.5 4.9-5.3"
        className="aui-ts__mark aui-ts__mark--check"
        pathLength={1}
      />
      <path d="M9.5 9.5l5 5" className="aui-ts__mark aui-ts__mark--x1" pathLength={1} />
      <path d="M14.5 9.5l-5 5" className="aui-ts__mark aui-ts__mark--x2" pathLength={1} />
      <path d="M12 11.2v4.6M12 8.2h.01" className="aui-ts__info" />
    </svg>
  );
}

type Slot = { y: number; s: number; h: number | undefined; z: number };

type ItemProps = {
  t: ToastData;
  slot: Slot;
  front: boolean;
  behind: boolean;
  /** waiting for room: mounted, but not shown and not reachable */
  waiting: boolean;
  expanded: boolean;
  paused: boolean;
  duration: number;
  hairline: boolean;
  closeButton: boolean;
  closeLabel: string;
  fromTop: boolean;
  onHeight: (id: string, h: number) => void;
  onEscape: (id: string) => void;
};

type Copy = { v: number; title: ReactNode; description?: ReactNode };

function ToastItem({
  t,
  slot,
  front,
  behind,
  waiting,
  expanded,
  paused,
  duration,
  hairline,
  closeButton,
  closeLabel,
  fromTop,
  onHeight,
  onEscape,
}: ItemProps) {
  const ref = useRef<HTMLLIElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [swipe, setSwipe] = useState<{
    x: number;
    y: number;
    dragging: boolean;
    out?: "left" | "right" | "down" | "up";
  }>({
    x: 0,
    y: 0,
    dragging: false,
  });
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const life = t.type === "loading" ? Infinity : (t.duration ?? duration);
  const remaining = useRef(life);

  // an update keeps the old text around for a moment, so the two crossfade
  const [copy, setCopy] = useState<Copy>({
    v: t.version,
    title: t.title,
    description: t.description,
  });
  const [ghost, setGhost] = useState<Copy | null>(null);
  if (copy.v !== t.version) {
    setGhost(copy);
    setCopy({ v: t.version, title: t.title, description: t.description });
  }
  useEffect(() => {
    if (!ghost) return;
    const id = setTimeout(() => setGhost(null), 240);
    return () => clearTimeout(id);
  }, [ghost]);

  // lift in on the next frame
  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // measure the content's own height (the card itself is stretched to the slot)
  useIsoLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => onHeight(t.id, el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [t.id, onHeight]);

  // toasts that are closing or waiting for room are out of reach
  const off = waiting || !!t.removing;
  useEffect(() => {
    ref.current?.toggleAttribute("inert", off);
  }, [off]);

  // restart the timer when the toast is updated
  useEffect(() => {
    remaining.current = life;
  }, [t.version, life]);

  // the timer: runs only while shown and not paused
  const hold = paused || waiting;
  useEffect(() => {
    if (hold || t.removing || !Number.isFinite(remaining.current)) return;
    const began = performance.now();
    const id = setTimeout(() => dismiss(t.id), Math.max(0, remaining.current));
    return () => {
      clearTimeout(id);
      remaining.current -= performance.now() - began;
    };
  }, [hold, t.removing, t.id, t.version, life]);

  /* swipe to dismiss */
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSwipe({ x: 0, y: 0, dragging: true });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    const awayY = fromTop ? Math.min(0, dy) : Math.max(0, dy); // toward the edge it came from
    const backY = fromTop ? Math.max(0, dy) : Math.min(0, dy);
    setSwipe({ x: dx, y: awayY + backY * 0.15, dragging: true });
  };
  const onPointerUp = () => {
    if (!start.current) return;
    const dt = Math.max(1, performance.now() - start.current.t);
    const { x, y: sy } = swipe;
    start.current = null;
    const vx = Math.abs(x) / dt;
    const vy = Math.abs(sy) / dt;
    if (Math.abs(x) > 60 || (vx > 0.5 && Math.abs(x) > 8)) {
      setSwipe({ x, y: 0, dragging: false, out: x > 0 ? "right" : "left" });
      dismiss(t.id);
    } else if (Math.abs(sy) > 40 || (vy > 0.5 && Math.abs(sy) > 8)) {
      setSwipe({ x: 0, y: sy, dragging: false, out: fromTop ? "up" : "down" });
      dismiss(t.id);
    } else setSwipe({ x: 0, y: 0, dragging: false });
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onEscape(t.id);
    }
  };

  const dir = fromTop ? 1 : -1;
  const swipeT =
    swipe.out === "left"
      ? "translateX(-110%)"
      : swipe.out === "right"
        ? "translateX(110%)"
        : swipe.out
          ? `translateY(${dir * -60}px)`
          : `translate(${swipe.x}px, ${swipe.y}px)`;

  // enter from the edge, rest in the slot, leave a few pixels toward the edge
  const transform = t.removing
    ? `translateY(${dir * (slot.y - 10)}px) scale(0.96)`
    : mounted
      ? `translateY(${dir * slot.y}px) scale(${slot.s})`
      : `translateY(${dir * -100}%) scale(1)`;
  const style: CSSProperties = {
    transform,
    opacity: t.removing || !mounted || waiting ? 0 : 1,
    zIndex: slot.z,
    height: slot.h || undefined,
  };

  const actionLabel = t.action?.label;
  return (
    <li
      ref={ref}
      className="aui-ts__toast"
      tabIndex={0}
      data-type={t.type}
      data-toast-id={t.id}
      data-front={front ? "" : undefined}
      data-behind={behind ? "" : undefined}
      data-removing={t.removing ? "" : undefined}
      data-expanded={expanded ? "" : undefined}
      aria-hidden={off ? true : undefined}
      style={style}
      onKeyDown={onKeyDown}
    >
      <div
        className="aui-ts__swipe"
        data-dragging={swipe.dragging ? "" : undefined}
        data-out={swipe.out}
        style={{
          transform: swipeT,
          opacity: swipe.dragging ? Math.max(0.3, 1 - Math.abs(swipe.x) / 280) : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="aui-ts__card">
          <div className="aui-ts__content" ref={contentRef} data-action={t.action ? "" : undefined}>
            {(t.icon || t.type !== "default") && (
              <span className="aui-ts__icon" data-type={t.icon ? "custom" : t.type}>
                {t.icon ?? <StatusIcon type={t.type} />}
              </span>
            )}
            <div className="aui-ts__text">
              <div
                className="aui-ts__copy"
                key={t.version}
                data-swap={t.version > 0 ? "" : undefined}
              >
                <div className="aui-ts__title" dir="auto">
                  {t.title}
                </div>
                {t.description && (
                  <div className="aui-ts__desc" dir="auto">
                    {t.description}
                  </div>
                )}
              </div>
              {ghost && (
                <div
                  className="aui-ts__copy aui-ts__copy--ghost"
                  key={`ghost-${ghost.v}`}
                  aria-hidden="true"
                >
                  <div className="aui-ts__title">{ghost.title}</div>
                  {ghost.description && <div className="aui-ts__desc">{ghost.description}</div>}
                </div>
              )}
            </div>
            {t.action && (
              <button
                type="button"
                className="aui-ts__action"
                title={typeof actionLabel === "string" ? actionLabel : undefined}
                onClick={(e) => {
                  t.action!.onClick(e);
                  if (!e.defaultPrevented) dismiss(t.id);
                }}
              >
                <span className="aui-ts__action-label" dir="auto">
                  {actionLabel}
                </span>
              </button>
            )}
          </div>
          {hairline && Number.isFinite(life) && (
            <span
              key={`timer-${t.version}`}
              className="aui-ts__timer"
              aria-hidden="true"
              style={{
                animationDuration: `${life}ms`,
                animationPlayState: hold || t.removing ? "paused" : "running",
              }}
            />
          )}
        </div>
        {closeButton && (
          <button
            type="button"
            className="aui-ts__close"
            aria-label={closeLabel}
            onClick={() => dismiss(t.id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7.5 7.5l9 9M16.5 7.5l-9 9" />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
}

export const Toaster = forwardRef<HTMLElement, ToasterProps>(function Toaster(
  {
    position = "bottom-right",
    inline = false,
    id,
    duration = 4000,
    visibleToasts = 3,
    expand = false,
    offset,
    gap = 10,
    hotkey = "F8",
    hairline = true,
    closeButton = true,
    label = "Notifications",
    closeLabel = "Dismiss notification",
    onExpandedChange,
    className,
    style,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onPointerDown,
    ...rest
  },
  forwardedRef,
) {
  const all = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
  const mine = all.filter((t) => t.toaster === id);
  const live = mine.filter((t) => !t.removing);
  const shown = live.slice(0, Math.max(1, visibleToasts));

  const [heights, setHeights] = useState<Record<string, number>>({});
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [hidden, setHidden] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const lastSlot = useRef<Record<string, Slot>>({});

  const setRefs = useCallback(
    (el: HTMLElement | null) => {
      sectionRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  const onHeight = useCallback((tid: string, h: number) => {
    setHeights((hs) => (hs[tid] === h ? hs : { ...hs, [tid]: h }));
  }, []);

  // forget the heights of toasts that are gone
  useEffect(() => {
    setHeights((hs) => {
      const ids = Object.keys(hs).filter((k) => all.some((t) => t.id === k));
      return ids.length === Object.keys(hs).length
        ? hs
        : (Object.fromEntries(ids.map((k) => [k, hs[k] ?? 0])) as Record<string, number>);
    });
  }, [all]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // hotkey moves focus to the newest toast
  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== hotkey && e.code !== hotkey) return;
      const first = listRef.current?.querySelector<HTMLElement>(
        ".aui-ts__toast:not([data-removing]):not([inert])",
      );
      if (!first) return;
      e.preventDefault();
      if (!sectionRef.current?.contains(document.activeElement))
        returnFocus.current = document.activeElement as HTMLElement;
      first.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  // once the stack is empty, focus goes back where it was
  useEffect(() => {
    if (!live.length && returnFocus.current) {
      returnFocus.current.focus?.();
      returnFocus.current = null;
    }
  }, [live.length]);

  const onEscape = (tid: string) => {
    const idx = shown.findIndex((t) => t.id === tid);
    const next = shown[idx + 1] ?? shown[idx - 1];
    dismiss(tid);
    if (next) {
      requestAnimationFrame(() =>
        [...(listRef.current?.querySelectorAll<HTMLElement>(".aui-ts__toast") ?? [])]
          .find((el) => el.dataset.toastId === next.id)
          ?.focus(),
      );
    } else if (returnFocus.current) {
      returnFocus.current.focus?.();
      returnFocus.current = null;
    }
  };

  const expanded = expand || ((hover || focusIn) && live.length > 0);
  const paused = hover || focusIn || hidden;
  const fromTop = position.startsWith("top");
  const off = offset ?? (inline ? 20 : 24);
  const frontH = shown[0] ? (heights[shown[0].id] ?? 0) : 0;

  const expandedRef = useRef(expanded);
  useEffect(() => {
    if (expandedRef.current === expanded) return;
    expandedRef.current = expanded;
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  // slots: collapsed toasts tuck behind the newest one, expanded ones sit in a list
  const last = Math.max(0, shown.length - 1);
  let acc = 0;
  let n = 0;
  let listH = 0;
  const kept: Record<string, Slot> = {};
  const slots = mine.map((t): Slot => {
    if (t.removing)
      return (kept[t.id] = lastSlot.current[t.id] ?? {
        y: 0,
        s: 1,
        h: undefined,
        z: live.length + 1,
      });
    const i = n++;
    const h = heights[t.id] ?? 0;
    const tuck = Math.min(i, last);
    const slot: Slot = expanded
      ? { y: acc + i * gap, s: 1, h: h || undefined, z: live.length - i }
      : { y: tuck * PEEK, s: 1 - tuck * 0.05, h: frontH || undefined, z: live.length - i };
    acc += h;
    if (i < shown.length) listH = expanded ? acc + i * gap : frontH + tuck * PEEK;
    kept[t.id] = slot;
    return slot;
  });
  lastSlot.current = kept;

  // live regions: the latest change
  const latest = live[0];
  const politeText = latest && latest.type !== "error" ? latest : null;
  const alertText = latest && latest.type === "error" ? latest : null;

  const [v, h] = position.split("-") as ["top" | "bottom", "left" | "center" | "right"];
  const sectionStyle = { "--_off": `${off}px`, ...style } as CSSProperties;

  let liveIndex = 0;
  return (
    <section
      aria-label={`${label}${hotkey ? ` (${hotkey})` : ""}`}
      tabIndex={-1}
      {...rest}
      ref={setRefs}
      className={cn("aui-root aui-ts", className)}
      data-inline={inline ? "" : undefined}
      data-v={v}
      data-h={h}
      data-empty={!mine.length ? "" : undefined}
      data-expanded={expanded ? "" : undefined}
      style={sectionStyle}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        setHover(true);
      }}
      onMouseLeave={(e) => {
        onMouseLeave?.(e);
        setHover(false);
      }}
      onFocus={(e) => {
        onFocus?.(e);
        setFocusIn(true);
      }}
      onBlur={(e) => {
        onBlur?.(e);
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusIn(false);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        // touch: tap the stack to fan it out
        if (e.pointerType === "touch") setHover(true);
      }}
    >
      <ol ref={listRef} className="aui-ts__list" style={{ height: listH }}>
        {mine.map((t, k) => {
          const i = t.removing ? -1 : liveIndex++;
          const waiting = i >= shown.length;
          return (
            <ToastItem
              key={t.id}
              t={t}
              slot={slots[k] as Slot}
              front={i === 0}
              behind={!expanded && i > 0}
              waiting={waiting}
              expanded={expanded}
              paused={paused}
              duration={duration}
              hairline={hairline}
              closeButton={closeButton}
              closeLabel={closeLabel}
              fromTop={fromTop}
              onHeight={onHeight}
              onEscape={onEscape}
            />
          );
        })}
      </ol>
      <div className="aui-sr-only" role="status" aria-live="polite">
        {politeText && (
          <>
            {politeText.title} {politeText.description}
          </>
        )}
      </div>
      <div className="aui-sr-only" role="alert">
        {alertText && (
          <>
            {alertText.title} {alertText.description}
          </>
        )}
      </div>
    </section>
  );
});
Toaster.displayName = "Toaster";
