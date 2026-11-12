import { forwardRef, type HTMLAttributes, useEffect, useMemo, useRef, useState } from "react";
import { cn, useControllable, useIsoLayoutEffect, useReducedMotion } from "./lib/utils";
import "./thinking-loader.css";

export type ThinkingLoaderProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** Labels to walk through, one after another */
  phases?: string[];
  /** Time per phase in ms */
  interval?: number;
  /** Controlled index into phases – the loader shows this phase and asks for the next one through onPhaseChange */
  phase?: number;
  /** Phase to start on when the phase isn't controlled */
  defaultPhase?: number;
  /** Called with the next index each time the timer moves on */
  onPhaseChange?: (index: number) => void;
  /** Start over after the last phase instead of holding it */
  loop?: boolean;
  /** Spinner turns into a check and the label into doneLabel; back to false starts over */
  done?: boolean;
  doneLabel?: string | ((seconds: number) => string);
  size?: "sm" | "md";
  variant?: "pill" | "plain";
};

export const DEFAULT_PHASES: string[] = [
  "Thinking",
  "Searching the web",
  "Reading sources",
  "Writing response",
];
const defaultDone = (s: number) => `Thought for ${s}s`;
/** the old label is gone this long after a change (its roll-out takes 320ms) */
const OUT_MS = 340;

type Roll = { key: number; out: string | null; label: string };

export const ThinkingLoader = forwardRef<HTMLSpanElement, ThinkingLoaderProps>(
  function ThinkingLoader(
    {
      phases = DEFAULT_PHASES,
      interval = 2200,
      phase,
      defaultPhase = 0,
      onPhaseChange,
      loop = false,
      done = false,
      doneLabel = defaultDone,
      size = "md",
      variant = "pill",
      className,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const [idx, setIdx] = useControllable(phase, defaultPhase, onPhaseChange);
    const started = useRef(0);
    if (!started.current) started.current = Date.now();

    // done → false starts over
    const wasDone = useRef(done);
    useEffect(() => {
      if (wasDone.current && !done) {
        started.current = Date.now();
        setIdx(0);
      }
      wasDone.current = done;
    }, [done, setIdx]);

    // seconds since the loader started, taken the moment it is done
    const seconds = useMemo(
      () => (done ? Math.max(1, Math.round((Date.now() - started.current) / 1000)) : 0),
      [done],
    );

    const last = Math.max(0, phases.length - 1);
    const current = Math.max(0, Math.min(last, idx));
    useEffect(() => {
      if (done || last === 0) return;
      if (!loop && current >= last) return;
      const t = setTimeout(() => setIdx(current >= last ? 0 : current + 1), interval);
      return () => clearTimeout(t);
    }, [done, loop, current, last, interval, setIdx]);

    const label = done
      ? typeof doneLabel === "function"
        ? doneLabel(seconds)
        : doneLabel
      : (phases[current] ?? "");

    // roll the old label out, the new one in
    const [roll, setRoll] = useState<Roll>({ key: 0, out: null, label });
    if (roll.label !== label)
      setRoll({ key: roll.key + 1, out: reduced ? null : roll.label, label });
    useEffect(() => {
      if (!roll.out) return;
      const t = setTimeout(() => setRoll((r) => (r.out ? { ...r, out: null } : r)), OUT_MS);
      return () => clearTimeout(t);
    }, [roll.key, roll.out]);

    // the chip glides to the new label's width; before the first measure the label sets it
    const inRef = useRef<HTMLSpanElement>(null);
    const [width, setWidth] = useState<number | undefined>(undefined);
    useIsoLayoutEffect(() => {
      const el = inRef.current;
      if (!el) return;
      const measure = () => setWidth(el.offsetWidth + 1);
      measure();
      if (typeof ResizeObserver === "undefined") return;
      // a late web font changes the label's width
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [roll.key, size]);

    return (
      <span
        ref={ref}
        role="status"
        aria-live="polite"
        {...rest}
        className={cn("aui-root aui-tl", className)}
        data-size={size}
        data-variant={variant}
        data-done={done ? "true" : undefined}
      >
        <span className="aui-tl__icon" aria-hidden="true">
          <svg className="aui-tl__rays" viewBox="0 0 16 16">
            {Array.from({ length: 8 }, (_, i) => (
              <line key={i} x1="8" y1="1.75" x2="8" y2="4.75" transform={`rotate(${i * 45} 8 8)`} />
            ))}
          </svg>
          <svg className="aui-tl__check" viewBox="0 0 16 16">
            <path d="M3.5 8.4 6.6 11.3 12.5 4.9" pathLength={1} />
          </svg>
        </span>
        <span
          className="aui-tl__text"
          data-auto={width === undefined ? "" : undefined}
          hidden={roll.label === "" && roll.out === null}
          style={width === undefined ? undefined : { width }}
        >
          {roll.out !== null && (
            <span
              className="aui-tl__label aui-tl__label--out"
              key={`o${roll.key}`}
              aria-hidden="true"
            >
              {roll.out}
            </span>
          )}
          <span
            ref={inRef}
            className={cn(
              "aui-tl__label",
              roll.key > 0 && "aui-tl__label--in",
              !done && "aui-tl__shine",
            )}
            key={`i${roll.key}`}
            data-text={roll.label}
            title={roll.label}
          >
            {roll.label}
          </span>
        </span>
      </span>
    );
  },
);
ThinkingLoader.displayName = "ThinkingLoader";
