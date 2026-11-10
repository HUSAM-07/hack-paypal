/**
 * When Studio re-reads the engine. Every poll reads every table, so an open tab must not poll
 * without someone looking at it: polling pauses while the tab is hidden, stops after IDLE_MS
 * without user input (any input resumes it at once), and a failed poll backs off.
 */
export const IDLE_MS = 10 * 60_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/** Delay before the next poll: the interval, doubled per consecutive failure, capped. */
export function pollDelay(intervalMs: number, failures: number): number {
  return Math.min(intervalMs * 2 ** Math.max(0, failures), MAX_BACKOFF_MS);
}

export interface PollerEnv {
  doc: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

const browserEnv = (): PollerEnv => ({
  doc: document,
  win: window,
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (t) => window.clearTimeout(t as number),
});

/**
 * Calls `tick` every `intervalMs` while the page is visible and in use. `tick` resolves true on
 * success, false on failure. Returns a function that stops polling for good.
 */
export function startPolling(
  tick: () => Promise<boolean>,
  intervalMs: number,
  env: PollerEnv = browserEnv(),
): () => void {
  let timer: unknown = null;
  let running = false;
  let stopped = false;
  let failures = 0;
  let lastInput = env.now();

  const active = () => !env.doc.hidden && env.now() - lastInput < IDLE_MS;
  const schedule = (ms: number) => {
    if (timer !== null) env.clearTimeout(timer);
    timer = env.setTimeout(run, ms);
  };
  async function run() {
    timer = null;
    if (stopped || running) return;
    // Hidden or idle: no timer at all until visibility or input brings the page back.
    if (!active()) return;
    running = true;
    const ok = await tick().catch(() => false);
    running = false;
    failures = ok ? 0 : failures + 1;
    if (!stopped) schedule(pollDelay(intervalMs, failures));
  }
  /** Back from hidden or idle: poll now rather than wait out a full interval. */
  const wake = () => {
    if (!stopped && !running && timer === null && active()) schedule(0);
  };
  const onInput = () => {
    lastInput = env.now();
    wake();
  };
  const onVisibility = () => wake();

  for (const e of INPUT_EVENTS) env.win.addEventListener(e, onInput, { passive: true });
  env.doc.addEventListener("visibilitychange", onVisibility);
  schedule(intervalMs);
  return () => {
    stopped = true;
    if (timer !== null) env.clearTimeout(timer);
    for (const e of INPUT_EVENTS) env.win.removeEventListener(e, onInput);
    env.doc.removeEventListener("visibilitychange", onVisibility);
  };
}
