import {
  type FocusEvent,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { IconShield } from "./lib/icons";
import {
  cn,
  useControllable,
  useInterval,
  useIsoLayoutEffect,
  useReducedMotion,
} from "./lib/utils";
import "./approval-card.css";

export type ApprovalStatus = "pending" | "approved" | "denied";
export type ApprovalRisk = "low" | "medium" | "high";
export type ApprovalDetail = { label: ReactNode; value: ReactNode };

export interface ApprovalCardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "onChange" | "defaultValue"> {
  /** The action, e.g. "Send campaign email" – also the card's accessible name */
  title?: string;
  /** One line of context below the title; truncates */
  description?: ReactNode;
  /** Tinted badge in the header; leave out to hide it */
  risk?: ApprovalRisk;
  /** Icon in the 32px header tile */
  icon?: ReactNode;
  /** Key-value rows in the preview panel */
  details?: ApprovalDetail[];
  /** Custom content above the details */
  preview?: ReactNode;
  children?: ReactNode;
  /** Controlled status; setting it back to "pending" starts a fresh request */
  status?: ApprovalStatus;
  defaultStatus?: ApprovalStatus;
  onStatusChange?: (status: ApprovalStatus) => void;
  /** Controlled "Always allow" checkbox */
  always?: boolean;
  defaultAlways?: boolean;
  onAlwaysChange?: (always: boolean) => void;
  /** Show the card as processing (spinner on Approve, everything locked) – e.g. while your own code runs the action */
  busy?: boolean;
  onApprove?: (info: { always: boolean }) => void | Promise<unknown>;
  onDeny?: (info: { reason: "user" | "timeout" }) => void;
  onEdit?: () => void;
  /** Seconds until the request expires */
  expiresIn?: number;
  onExpire?: () => void;
  allowAlways?: boolean;
  alwaysLabel?: ReactNode;
  approveLabel?: ReactNode;
  denyLabel?: ReactNode;
  editLabel?: ReactNode;
  shortcuts?: boolean;
  /** Approve stays visible but inert (e.g. until a wallet is connected). Deny still works. */
  approveDisabled?: boolean;
  /** Small label on the gray tray above the card */
  label?: ReactNode;
  actions?: "card" | "tray";
}

function ago(t: number | null, now: number) {
  if (t === null) return "just now";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const textOf = (n: ReactNode) => (typeof n === "string" ? n : undefined);

const Spinner = () => (
  <svg className="aui-apc__spinner" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" />
  </svg>
);

export const ApprovalCard = forwardRef<HTMLDivElement, ApprovalCardProps>(function ApprovalCard(
  {
    title = "Approve this action",
    description,
    risk,
    icon,
    details,
    preview,
    children,
    status: statusProp,
    defaultStatus = "pending",
    onStatusChange,
    always: alwaysProp,
    defaultAlways = false,
    onAlwaysChange,
    busy: busyProp = false,
    onApprove,
    onDeny,
    onEdit,
    expiresIn,
    onExpire,
    allowAlways = true,
    alwaysLabel = "Always allow this action",
    approveLabel = "Approve",
    denyLabel = "Deny",
    editLabel = "Edit",
    shortcuts = true,
    approveDisabled = false,
    label,
    actions = "card",
    className,
    onKeyDown,
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const uid = useId();
  const reduced = useReducedMotion();
  const [status, setStatus] = useControllable(statusProp, defaultStatus, onStatusChange);
  const [always, setAlways] = useControllable(alwaysProp, defaultAlways, onAlwaysChange);
  const [working, setWorking] = useState(false);
  const busy = busyProp || working;
  const [left, setLeft] = useState(expiresIn ?? 0);
  const [paused, setPaused] = useState(false);
  const [expired, setExpired] = useState(false);
  const [resolvedAt, setResolvedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [announce, setAnnounce] = useState("");
  const [isMac, setIsMac] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [returning, setReturning] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => rootRef.current!);
  const rowRef = useRef<HTMLDivElement>(null);
  const focusRow = useRef(false);
  const prevH = useRef<number | null>(null);
  const prevStatus = useRef(status);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  // a fresh request whenever status goes back to pending
  const lastStatus = useRef(status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = status;
    if (status === "pending" && was !== "pending") {
      setWorking(false);
      setExpired(false);
      setLeft(expiresIn ?? 0);
      setResolvedAt(null);
    }
    if (status !== "pending" && was === "pending" && resolvedAt === null) setResolvedAt(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // the height glides between the request and the resolved row
  useIsoLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const from = prevH.current;
    const changed = prevStatus.current !== status;
    const wasPending = prevStatus.current === "pending";
    prevStatus.current = status;
    const to = el.offsetHeight;
    prevH.current = to;
    if (!changed || reduced) return;
    if (status !== "pending") setExiting(true);
    else if (!wasPending) setReturning(true);
    if (from === null || from === to) return;
    el.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 520,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
  });
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => (prevH.current = el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => setExiting(false), 300);
    return () => clearTimeout(t);
  }, [exiting]);
  useEffect(() => {
    if (!returning) return;
    const t = setTimeout(() => setReturning(false), 520);
    return () => clearTimeout(t);
  }, [returning]);

  useEffect(() => {
    if (focusRow.current && status !== "pending") {
      focusRow.current = false;
      rowRef.current?.focus();
    }
  }, [status]);

  const pending = status === "pending";
  useInterval(() => setNow(Date.now()), pending ? null : 30000);

  const resolve = (next: ApprovalStatus, word: string) => {
    if (rootRef.current?.contains(rootRef.current.ownerDocument.activeElement))
      focusRow.current = true;
    setAnnounce(`${word}: ${title}`);
    setResolvedAt(Date.now());
    setStatus(next);
  };

  const approve = async () => {
    if (!pending || busy || approveDisabled) return;
    const r = onApprove?.({ always });
    if (r && typeof (r as Promise<unknown>).then === "function") {
      setWorking(true);
      try {
        await r;
        setWorking(false);
        resolve("approved", "Approved");
      } catch {
        setWorking(false);
      }
      return;
    }
    resolve("approved", "Approved");
  };
  const deny = (reason: "user" | "timeout" = "user") => {
    if (!pending || (busy && reason === "user")) return;
    if (reason === "timeout") {
      setExpired(true);
      onExpire?.();
    }
    onDeny?.({ reason });
    resolve("denied", reason === "timeout" ? "Expired" : "Denied");
  };

  useInterval(
    () => {
      setLeft((s) => {
        const n = s - 1;
        if (n <= 0) queueMicrotask(() => deny("timeout"));
        return Math.max(0, n);
      });
    },
    pending && expiresIn && !paused && !busy && left > 0 ? 1000 : null,
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || !pending) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      approve();
    } else if (e.key === "Escape") {
      e.preventDefault();
      deny("user");
    }
  };

  const body = preview ?? children;
  const titleId = `${uid}-title`;
  const descId = description ? `${uid}-desc` : undefined;
  const timerId = expiresIn ? `${uid}-timer` : undefined;

  const buttons = (
    <div className="aui-apc__buttons">
      {onEdit && (
        <button
          type="button"
          className="aui-apc__btn"
          data-tone="ghost"
          onClick={onEdit}
          aria-disabled={busy || undefined}
        >
          {editLabel}
        </button>
      )}
      <button
        type="button"
        className="aui-apc__btn"
        data-tone="ghost"
        aria-keyshortcuts="Escape"
        aria-disabled={busy || undefined}
        onClick={() => deny("user")}
      >
        {denyLabel}
        {shortcuts && (
          <kbd className="aui-apc__kbd" aria-hidden="true">
            Esc
          </kbd>
        )}
      </button>
      <button
        type="button"
        className="aui-apc__btn"
        data-tone="primary"
        data-busy={busy ? "" : undefined}
        aria-keyshortcuts="Meta+Enter Control+Enter"
        aria-disabled={busy || approveDisabled || undefined}
        onClick={approve}
      >
        {approveLabel}
        {busy ? (
          <Spinner />
        ) : (
          shortcuts && (
            <kbd className="aui-apc__kbd" aria-hidden="true">
              {isMac ? "⌘" : "Ctrl"}↵
            </kbd>
          )
        )}
      </button>
    </div>
  );

  const countdown = expiresIn ? (
    <span
      className="aui-apc__timer aui-tnum"
      data-warn={left <= 10 ? "" : undefined}
      aria-hidden="true"
    >
      Expires in {clock(left)}
    </span>
  ) : null;

  const checkbox = allowAlways ? (
    <label className="aui-apc__always">
      <span className="aui-apc__box">
        <input
          type="checkbox"
          checked={always}
          disabled={busy}
          onChange={(e) => setAlways(e.target.checked)}
        />
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 8.3 6.8 11 12 5.2" />
        </svg>
      </span>
      <span className="aui-apc__always-label">{alwaysLabel}</span>
    </label>
  ) : null;

  const request = (ghost?: boolean) => (
    <div
      className={cn("aui-apc__pending", ghost && "aui-apc__ghost")}
      data-returning={!ghost && returning ? "" : undefined}
      aria-hidden={ghost || undefined}
      inert={ghost || undefined}
    >
      {label && <div className="aui-apc__label">{label}</div>}
      <div className="aui-apc__card">
        <div className="aui-apc__head">
          <span className="aui-apc__tile" aria-hidden="true">
            {icon ?? <IconShield size={16} />}
          </span>
          <div className="aui-apc__heading">
            <h3
              className="aui-apc__title aui-truncate"
              id={ghost ? undefined : titleId}
              dir="auto"
              title={title}
            >
              {title}
            </h3>
            {description && (
              <p
                className="aui-apc__desc aui-truncate"
                id={ghost ? undefined : descId}
                dir="auto"
                title={textOf(description)}
              >
                {description}
              </p>
            )}
          </div>
          {risk && (
            <span className="aui-apc__risk" data-risk={risk}>
              <span className="aui-apc__risk-dot" aria-hidden="true" />
              {risk.charAt(0).toUpperCase() + risk.slice(1)}
              <span className="aui-apc__risk-word"> risk</span>
            </span>
          )}
        </div>
        {(body || details?.length) && (
          <div className="aui-apc__preview">
            {body && <div className="aui-apc__custom">{body}</div>}
            {!!details?.length && (
              <dl className="aui-apc__details">
                {details.map((d, i) => (
                  <div className="aui-apc__detail" key={i}>
                    <dt dir="auto" title={textOf(d.label)}>
                      {d.label}
                    </dt>
                    <dd className="aui-truncate" dir="auto">
                      {d.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
        {actions === "card" ? (
          <div className="aui-apc__foot">
            {checkbox}
            <div className="aui-apc__actions">
              {countdown}
              {buttons}
            </div>
          </div>
        ) : (
          checkbox
        )}
      </div>
      {actions === "tray" && (
        <div className="aui-apc__tray">
          {countdown}
          <span className="aui-apc__spacer" />
          {buttons}
        </div>
      )}
      {expiresIn && !ghost ? (
        <span className="aui-sr-only" id={timerId}>
          Expires in {left} seconds unless approved. The countdown pauses while you are in the card.
        </span>
      ) : null}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cn("aui-root aui-apc", className)}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={[descId, timerId].filter(Boolean).join(" ") || undefined}
      aria-busy={busy || undefined}
      data-status={status}
      data-actions={actions}
      data-label={label ? "" : undefined}
      {...rest}
      onKeyDown={handleKeyDown}
      onPointerEnter={(e: PointerEvent<HTMLDivElement>) => {
        onPointerEnter?.(e);
        setPaused(true);
      }}
      onPointerLeave={(e: PointerEvent<HTMLDivElement>) => {
        onPointerLeave?.(e);
        setPaused(false);
      }}
      onFocus={(e: FocusEvent<HTMLDivElement>) => {
        onFocus?.(e);
        setPaused(true);
      }}
      onBlur={(e: FocusEvent<HTMLDivElement>) => {
        onBlur?.(e);
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false);
      }}
    >
      {pending ? (
        request()
      ) : (
        <div className="aui-apc__card aui-apc__resolved" ref={rowRef} tabIndex={-1}>
          <span className="aui-apc__mark" data-status={status} aria-hidden="true">
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {status === "approved" ? (
                <path d="M4.2 8.4 6.9 11 11.8 5.6" pathLength={1} />
              ) : (
                <path d="M5.2 5.2 10.8 10.8M10.8 5.2 5.2 10.8" pathLength={1} />
              )}
            </svg>
          </span>
          <span className="aui-apc__row-title aui-truncate" id={titleId}>
            {title}
          </span>
          <span className="aui-apc__row-status">
            {status === "approved" ? "Approved" : expired ? "Expired" : "Denied"}
            {status === "approved" && always ? " · always" : ""}
            <span className="aui-apc__row-time"> · {ago(resolvedAt, now)}</span>
          </span>
        </div>
      )}
      {exiting && !pending && request(true)}
      <span className="aui-sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
});
ApprovalCard.displayName = "ApprovalCard";
