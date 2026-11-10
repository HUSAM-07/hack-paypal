import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_MS, MAX_BACKOFF_MS, type PollerEnv, pollDelay, startPolling } from "./poll";

const INTERVAL = 15_000;

function fakeEnv() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = new EventTarget();
  const env: PollerEnv = {
    doc: doc as unknown as PollerEnv["doc"],
    win: win as unknown as PollerEnv["win"],
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  };
  const setHidden = (h: boolean) => {
    doc.hidden = h;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  const input = () => win.dispatchEvent(new Event("pointerdown"));
  return { env, setHidden, input };
}

describe("pollDelay", () => {
  it("doubles per failure and caps", () => {
    expect(pollDelay(INTERVAL, 0)).toBe(15_000);
    expect(pollDelay(INTERVAL, 1)).toBe(30_000);
    expect(pollDelay(INTERVAL, 3)).toBe(120_000);
    expect(pollDelay(INTERVAL, 20)).toBe(MAX_BACKOFF_MS);
  });
});

describe("startPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls every interval while visible and in use", async () => {
    const { env, input } = fakeEnv();
    const tick = vi.fn(async () => true);
    const stop = startPolling(tick, INTERVAL, env);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(tick).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);
    input();
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(INTERVAL * 4);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("pauses while hidden and polls at once when shown again", async () => {
    const { env, setHidden } = fakeEnv();
    const tick = vi.fn(async () => true);
    startPolling(tick, INTERVAL, env);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(tick).toHaveBeenCalledTimes(0);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("stops after 10 minutes without input and resumes on input", async () => {
    const { env, input } = fakeEnv();
    const tick = vi.fn(async () => true);
    startPolling(tick, INTERVAL, env);
    await vi.advanceTimersByTimeAsync(IDLE_MS + INTERVAL);
    const atIdle = tick.mock.calls.length;
    expect(atIdle).toBe(IDLE_MS / INTERVAL - 1);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(tick).toHaveBeenCalledTimes(atIdle);
    input();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(atIdle + 1);
  });

  it("backs off after failures and returns to the interval on success", async () => {
    const { env, input } = fakeEnv();
    let ok = false;
    const tick = vi.fn(async () => ok);
    startPolling(tick, INTERVAL, env);
    await vi.advanceTimersByTimeAsync(INTERVAL); // 1st poll fails
    await vi.advanceTimersByTimeAsync(30_000); // 2nd fails after 30 s
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(tick).toHaveBeenCalledTimes(2); // next waits 60 s
    input();
    ok = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("counts a thrown tick as a failure", async () => {
    const { env } = fakeEnv();
    const tick = vi.fn(async () => {
      throw new Error("500");
    });
    startPolling(tick, INTERVAL, env);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
