import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** Join class names, skipping falsy values. */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}

export const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** True when the user asked the OS for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () =>
      typeof window === "undefined"
        ? false
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Controlled/uncontrolled state in one hook. */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, Dispatch<SetStateAction<T>>] {
  const [inner, setInner] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? (value as T) : inner;
  const ref = useRef(current);
  ref.current = current;
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(ref.current) : next;
      if (Object.is(resolved, ref.current)) return;
      if (!controlled) setInner(resolved);
      onChange?.(resolved);
    },
    [controlled, onChange],
  );
  return [current, set];
}

/** setInterval that always calls the latest callback; pass null to pause. */
export function useInterval(cb: () => void, ms: number | null) {
  const saved = useRef(cb);
  saved.current = cb;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Seconds elapsed since mount (or since `running` turned true). */
export function useElapsed(running = true, start = 0): number {
  const [s, setS] = useState(start);
  useInterval(() => setS((v) => v + 1), running ? 1000 : null);
  return s;
}

/** Close on outside pointer down / Escape. */
export function useDismiss(
  open: boolean,
  onClose: () => void,
  refs: Array<RefObject<HTMLElement | null>>,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** Reveal `text` word by word, like a streaming model. */
export function useStreamedText(text: string, { wps = 38, enabled = true } = {}) {
  const reduced = useReducedMotion();
  const words = text.split(/(\s+)/);
  const [count, setCount] = useState(enabled && !reduced ? 0 : words.length);
  const prev = useRef(text);
  useEffect(() => {
    if (!text.startsWith(prev.current)) setCount(enabled && !reduced ? 0 : words.length);
    prev.current = text;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useInterval(
    () => setCount((c) => Math.min(words.length, c + 2)),
    enabled && !reduced && count < words.length ? 1000 / wps : null,
  );
  return {
    shown: words.slice(0, count).join(""),
    done: count >= words.length,
    restart: () => setCount(0),
  };
}

/** Format seconds as 1m 04s / 42s. */
export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function formatMoney(n: number, digits = 2): string {
  return `$${n.toFixed(digits)}`;
}

/** Stable id for aria wiring. */
export { useId } from "react";
