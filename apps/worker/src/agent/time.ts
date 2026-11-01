/**
 * Wall-clock helpers for one IANA time zone, using only `Intl` (no tz database in
 * Workers). The model resolves "before Friday" against the Now line; the server uses
 * these for defaults such as "tomorrow at 9am local".
 */

export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallClock(at: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: n("year"),
    month: n("month"),
    day: n("day"),
    hour: n("hour"),
    minute: n("minute"),
  };
}

/** Offset of `timeZone` from UTC at `at`, in ms (negative west of Greenwich). */
function offsetMs(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return asUtc - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** The instant when the wall clock in `timeZone` reads the given local time. */
export function zonedTime(
  local: { year: number; month: number; day: number; hour: number; minute?: number },
  timeZone: string,
): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute ?? 0);
  // Two passes settle DST: the offset at the first estimate can differ by an hour.
  let at = guess - offsetMs(new Date(guess), timeZone);
  at = guess - offsetMs(new Date(at), timeZone);
  return new Date(at);
}

/** Tomorrow (in `timeZone`) at `hour`:00 local. */
export function tomorrowAt(now: Date, timeZone: string, hour: number): Date {
  const today = wallClock(now, timeZone);
  const noonTomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12));
  return zonedTime(
    {
      year: noonTomorrow.getUTCFullYear(),
      month: noonTomorrow.getUTCMonth() + 1,
      day: noonTomorrow.getUTCDate(),
      hour,
    },
    timeZone,
  );
}

/** "Thu, Nov 5, 9:00 AM PST": a date the model can repeat without converting zones. */
export function formatLocal(at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(typeof at === "string" ? new Date(at) : at);
}

export function weekday(at: Date, timeZone: string): string {
  return at.toLocaleDateString("en-US", { weekday: "long", timeZone });
}

/** Falls back to the default when a configured zone is missing or unknown to Intl. */
export function validTimeZone(tz: string | undefined): string {
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
