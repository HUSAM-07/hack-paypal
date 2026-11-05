const DAY_MS = 86_400_000;

/** Demo clock: real time plus an offset, so the day-7 schedule switch can be shown on stage. */
export class DemoClock {
  private offsetMs = 0;
  constructor(private readonly base: () => number = Date.now) {}

  now(): Date {
    return new Date(this.base() + this.offsetMs);
  }

  advanceDays(days: number): void {
    this.offsetMs += days * DAY_MS;
  }
}

/** Whole days since a test was published (day 0 = publish day); never negative. */
export function testDay(publishedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - publishedAt.getTime()) / DAY_MS));
}
