const MS_PER_DAY = 86_400_000;

export { MS_PER_DAY };

/**
 * Demo clock. The ledger maths take `now` as an argument and never read the system
 * clock; this is the only thing that decides what "now" is, so the demo can jump to day 30.
 */
export class DemoClock {
  private ms: number;

  constructor(start: string | Date) {
    this.ms = new Date(start).getTime();
    if (Number.isNaN(this.ms)) throw new Error("invalid clock start");
  }

  now(): Date {
    return new Date(this.ms);
  }

  advanceDays(days: number): Date {
    return this.advanceMs(days * MS_PER_DAY);
  }

  advanceMs(ms: number): Date {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("the clock only moves forward");
    this.ms += ms;
    return this.now();
  }

  /** Jump to an absolute instant, never backwards. */
  setTo(to: string | Date): Date {
    const t = new Date(to).getTime();
    if (Number.isNaN(t) || t < this.ms) throw new Error("the clock only moves forward");
    this.ms = t;
    return this.now();
  }
}

export const toDate = (t: string | Date): Date => {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid timestamp: ${String(t)}`);
  return d;
};
