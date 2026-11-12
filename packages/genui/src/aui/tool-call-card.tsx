import {
  Children,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { IconCheck, IconChevronDown, IconCopy, IconRefresh } from "./lib/icons";
import { cn, useControllable } from "./lib/utils";
import "./tool-call-card.css";

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Tool name as the agent calls it, shown in mono */
  name?: string;
  status?: ToolCallStatus;
  /** Short human summary next to the name */
  summary?: ReactNode;
  /** Icon on the left – a 16px stroke SVG fits best */
  icon?: ReactNode;
  args?: unknown;
  result?: unknown;
  error?: string;
  /** Start time in ms since epoch – the live timer counts from here */
  startedAt?: number;
  /** Final duration in ms */
  duration?: number;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Opens the card when the call fails and closes it on the next run, unless someone toggled it by hand */
  openOnError?: boolean;
  onRetry?: () => void;
  /** Height in px after which arguments and result are capped */
  maxCodeHeight?: number;
}

export interface ToolCallGroupProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  label?: string;
  runningLabel?: string;
  /** Total in ms */
  duration?: number;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Solid red circle with a white "!" – the failed mark */
const FailIcon = ({ size = 14, className }: { size?: number; className?: string }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} className={className} aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="currentColor" />
    <path d="M8 4.6v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="8" cy="11.1" r="0.95" fill="#fff" />
  </svg>
);

export const WrenchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6a6 6 0 0 1-7.4 1.3l-6.3 6.3a2.1 2.1 0 0 1-3-3l6.3-6.3A6 6 0 0 1 12 3.5l1.4 1.3a4 4 0 0 0 1.3 1.5z" />
  </svg>
);

export function formatSeconds(ms: number) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

/** A finished duration: "700ms" under a second, otherwise like `formatSeconds` ("1.5s", "2m 05s"). The live timer keeps `formatSeconds`. */
export function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)}ms` : formatSeconds(ms);
}

/** Live milliseconds since `from` while `running`; keeps the last value once it stops. */
function useLiveMs(running: boolean, from?: number) {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [frozen, setFrozen] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const s = from ?? Date.now();
    setStart(s);
    setFrozen(null);
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => {
      clearInterval(id);
      setFrozen(Date.now() - s);
    };
  }, [running, from]);
  return running && start !== null ? Math.max(0, now - start) : frozen;
}

/* ---------- JSON highlighting ---------- */
function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}
const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of json.matchAll(TOKEN)) {
    if (m.index! > last) out.push(json.slice(last, m.index));
    if (m[1]) {
      out.push(
        <span key={i++} className={m[2] ? "aui-tcc__t-key" : "aui-tcc__t-str"}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3])
      out.push(
        <span key={i++} className="aui-tcc__t-lit">
          {m[3]}
        </span>,
      );
    else
      out.push(
        <span key={i++} className="aui-tcc__t-num">
          {m[4]}
        </span>,
      );
    last = m.index! + m[0].length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

function CodeBlock({ label, value, max }: { label: string; value: unknown; max: number }) {
  const parsed = parseMaybe(value);
  const isText = typeof parsed === "string";
  const text = isText ? (parsed as string) : JSON.stringify(parsed, null, 2);
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);
  const [tall, setTall] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    const check = () => setTall(el.scrollHeight > max + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, max]);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* ignore */
    }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="aui-tcc__section">
      <div className="aui-tcc__section-head">
        <span className="aui-tcc__label">{label}</span>
        <button
          type="button"
          className="aui-tcc__copy"
          data-copied={copied ? "" : undefined}
          aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
          onClick={copy}
        >
          <span className="aui-tcc__copy-icon" aria-hidden="true">
            <IconCopy size={14} />
          </span>
          <span className="aui-tcc__copy-done" aria-hidden="true">
            <IconCheck size={14} />
          </span>
        </button>
      </div>
      <pre
        ref={preRef}
        className="aui-tcc__code"
        data-text={isText ? "" : undefined}
        data-capped={tall && !all ? "" : undefined}
        style={{ maxHeight: all ? undefined : max }}
      >
        <code>{isText ? text : highlight(text)}</code>
      </pre>
      {tall && (
        <button
          type="button"
          className="aui-tcc__more"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
        >
          {all ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

function StatusMark({ status, ms }: { status: ToolCallStatus; ms: number | null }) {
  return (
    <span className="aui-tcc__status" data-status={status} key={status}>
      {status === "running" && (
        <span className="aui-ring-spinner aui-tcc__spin" aria-hidden="true" />
      )}
      {status === "success" && (
        <svg className="aui-tcc__ok" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" className="aui-tcc__ok-bg" />
          <path d="M5 8.3l2 1.9 4-4.2" pathLength={1} className="aui-tcc__ok-mark" />
        </svg>
      )}
      {status === "error" && <FailIcon size={14} />}
      <span className="aui-tcc__time aui-tnum">
        {status === "error"
          ? "Failed"
          : ms === null
            ? ""
            : status === "running"
              ? formatSeconds(ms)
              : formatDuration(ms)}
      </span>
    </span>
  );
}

export const ToolCallCard = forwardRef<HTMLDivElement, ToolCallCardProps>(function ToolCallCard(
  {
    name = "tool_call",
    status = "success",
    summary,
    icon,
    args,
    result,
    error,
    startedAt,
    duration,
    defaultOpen = false,
    open,
    onOpenChange,
    openOnError = true,
    onRetry,
    maxCodeHeight = 220,
    className,
    style,
    ...rest
  },
  ref,
) {
  const uid = useId();
  const [isOpen, setOpen] = useControllable(open, defaultOpen, onOpenChange);
  const touched = useRef(false);
  const live = useLiveMs(status === "running", startedAt);
  const ms = status === "running" ? live : (duration ?? live);

  useEffect(() => {
    if (open !== undefined || !openOnError || touched.current) return;
    if (status === "error") setOpen(true);
    else if (status === "running") setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const announce =
    status === "running"
      ? `${name} running`
      : status === "success"
        ? `${name} finished`
        : `${name} failed${error ? `: ${error}` : ""}`;

  return (
    <div
      ref={ref}
      className={cn("aui-root aui-tcc", className)}
      data-status={status}
      data-open={isOpen ? "" : undefined}
      style={style}
      {...rest}
    >
      <span className="aui-sr-only" role="status" aria-live="polite">
        {announce}
      </span>
      <button
        type="button"
        className="aui-tcc__head"
        aria-expanded={isOpen}
        aria-controls={`${uid}-body`}
        onClick={() => {
          touched.current = true;
          setOpen(!isOpen);
        }}
      >
        <span className="aui-tcc__icon">{icon ?? <WrenchIcon />}</span>
        <span className="aui-tcc__main">
          <code className="aui-tcc__name">{name}</code>
          {summary && <span className="aui-tcc__summary">{summary}</span>}
        </span>
        <StatusMark status={status} ms={ms} />
        <IconChevronDown size={16} className="aui-tcc__chev" />
      </button>
      <div className="aui-tcc__body" id={`${uid}-body`} inert={!isOpen}>
        <div className="aui-tcc__clip">
          <div className="aui-tcc__sections">
            {status === "error" && (
              <div className="aui-tcc__error">
                <FailIcon size={16} className="aui-tcc__error-icon" />
                <p className="aui-tcc__error-text">{error ?? "The call failed."}</p>
                {onRetry && (
                  <button type="button" className="aui-tcc__retry" onClick={onRetry}>
                    <IconRefresh size={14} />
                    Retry
                  </button>
                )}
              </div>
            )}
            {args !== undefined && <CodeBlock label="Arguments" value={args} max={maxCodeHeight} />}
            {result !== undefined ? (
              <CodeBlock label="Result" value={result} max={maxCodeHeight} />
            ) : (
              status === "running" && (
                <div className="aui-tcc__section">
                  <div className="aui-tcc__section-head">
                    <span className="aui-tcc__label">Result</span>
                  </div>
                  <p className="aui-tcc__wait">
                    <span className="aui-shimmer">Waiting for result…</span>
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
ToolCallCard.displayName = "ToolCallCard";

export const ToolCallGroup = forwardRef<HTMLDivElement, ToolCallGroupProps>(function ToolCallGroup(
  {
    children,
    label,
    runningLabel = "Using tools…",
    duration,
    defaultOpen = false,
    open,
    onOpenChange,
    className,
    style,
    ...rest
  },
  ref,
) {
  const uid = useId();
  const [isOpen, setOpen] = useControllable(open, defaultOpen, onOpenChange);
  const cards = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<ToolCallCardProps>[];
  const running = cards.some((c) => c.props.status === "running");
  const failed = cards.filter((c) => c.props.status === "error").length;
  // the group timer runs from the first call until nothing runs any more
  const startRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  if (running && startRef.current === null) startRef.current = Date.now();
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  const sum = cards.reduce((n, c) => n + (c.props.duration ?? 0), 0);
  const measured = startRef.current !== null ? Math.max(0, now - startRef.current) : null;
  // wall-clock time from the first call to the last result when we saw it run, else the cards' own durations
  const total = duration ?? measured ?? (sum || null);
  const doneLabel = label ?? `Used ${cards.length} ${cards.length === 1 ? "tool" : "tools"}`;
  const title = running ? runningLabel : doneLabel;

  return (
    <div
      ref={ref}
      className={cn("aui-root aui-tcg", className)}
      data-open={isOpen ? "" : undefined}
      style={style}
      {...rest}
    >
      <span className="aui-sr-only" role="status" aria-live="polite">
        {running ? runningLabel : `${doneLabel}${failed ? `, ${failed} failed` : ""}`}
      </span>
      <button
        type="button"
        className="aui-tcg__head"
        aria-expanded={isOpen}
        aria-controls={`${uid}-list`}
        onClick={() => setOpen(!isOpen)}
      >
        <span className="aui-tcg__stack" aria-hidden="true">
          {cards.map((c, i) => (
            <span key={c.key ?? i} className="aui-tcg__tile">
              {c.props.icon ?? <WrenchIcon />}
            </span>
          ))}
        </span>
        <span className="aui-tcg__title" key={running ? "run" : "done"}>
          <span className={cn("aui-tcg__label", running && "aui-shimmer")}>{title}</span>
          {failed > 0 && !running && <span className="aui-tcg__failed">· {failed} failed</span>}
          {total !== null && total > 0 && (
            <span className="aui-tcg__time aui-tnum">
              · {running ? formatSeconds(total) : formatDuration(total)}
            </span>
          )}
        </span>
        <IconChevronDown size={16} className="aui-tcg__chev" />
      </button>
      <div className="aui-tcc__body" id={`${uid}-list`} inert={!isOpen}>
        <div className="aui-tcc__clip">
          <div className="aui-tcg__list">{children}</div>
        </div>
      </div>
    </div>
  );
});
ToolCallGroup.displayName = "ToolCallGroup";
