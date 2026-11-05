import type { Calendar, Instant } from '../model/types';
import { dayOf, weekdayOf } from './time';

const STANDARD_WEEK = [false, true, true, true, true, true, false];
const CHUNK = 512;

/**
 * Working-day arithmetic for one calendar.
 *
 * Every Instant maps to a *working ordinal*: the number of working days before
 * its day plus the elapsed fraction of the working day. The end of a working
 * day and the start of the next working day share the same ordinal, which is
 * what makes Finish-to-Start links land on the next working morning.
 */
export class WorkCalendar {
  readonly uid: number;
  readonly name: string;
  private readonly week: boolean[];
  private readonly exceptions: Map<number, boolean>;
  private readonly dayStart: number;
  private readonly daySpan: number;
  /** cum[i] = number of working days in [lo, lo + i) */
  private cum: Int32Array = new Int32Array(1);
  private lo = 0;
  private hi = 0;
  private origin = 0;
  private originCum = 0;

  constructor(cal: Calendar, dayStartHours = 8, dayEndHours = 17, anchorDay = 20_000) {
    this.uid = cal.uid;
    this.name = cal.name;
    const hasWorkingWeekday = cal.workWeek.some(Boolean);
    this.week = hasWorkingWeekday ? cal.workWeek.slice(0, 7) : STANDARD_WEEK.slice();
    this.exceptions = new Map(cal.exceptions.map((e) => [e.day, e.working]));
    const start = Math.min(dayStartHours, dayEndHours - 1);
    this.dayStart = start / 24;
    this.daySpan = Math.max(1, dayEndHours - start) / 24;
    this.lo = anchorDay - CHUNK;
    this.hi = anchorDay + CHUNK;
    this.origin = anchorDay;
    this.rebuild();
  }

  isWorking(day: number): boolean {
    const ex = this.exceptions.get(day);
    if (ex !== undefined) return ex;
    return this.week[weekdayOf(day)] ?? false;
  }

  private rebuild(): void {
    const n = this.hi - this.lo;
    const cum = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i]! + (this.isWorking(this.lo + i) ? 1 : 0);
    this.cum = cum;
    this.originCum = cum[this.origin - this.lo]!;
  }

  private ensure(day: number): void {
    if (day >= this.lo && day < this.hi) return;
    while (day < this.lo) this.lo -= Math.max(CHUNK, this.hi - this.lo);
    while (day >= this.hi) this.hi += Math.max(CHUNK, this.hi - this.lo);
    this.rebuild();
  }

  /** Working days in [origin, day). Negative before origin. */
  countBefore(day: number): number {
    this.ensure(day);
    return this.cum[day - this.lo]! - this.originCum;
  }

  /** The working day whose countBefore equals k. */
  nthWorkingDay(k: number): number {
    // Grow the table until it contains the target, then binary-search it.
    for (let guard = 0; guard < 64; guard++) {
      const target = k + this.originCum;
      const n = this.hi - this.lo;
      if (target < 0) {
        this.ensure(this.lo - 1);
        continue;
      }
      if (this.cum[n]! <= target) {
        this.ensure(this.hi);
        continue;
      }
      // smallest i with cum[i + 1] > target
      let a = 0;
      let b = n - 1;
      while (a < b) {
        const mid = (a + b) >> 1;
        if (this.cum[mid + 1]! > target) b = mid;
        else a = mid + 1;
      }
      return this.lo + a;
    }
    throw new Error(`Calendar "${this.name}" has no working days near ordinal ${k}`);
  }

  /** Instant → working ordinal. */
  toOrd(t: Instant): number {
    const d = dayOf(t);
    const base = this.countBefore(d);
    if (!this.isWorking(d)) return base;
    const tod = t - d;
    const frac = (tod - this.dayStart) / this.daySpan;
    return base + Math.min(1, Math.max(0, frac));
  }

  /** Working ordinal → Instant, preferring the *start* of a working day for whole numbers. */
  fromOrdStart(o: number): Instant {
    let k = Math.floor(o + 1e-9);
    let f = o - k;
    if (f < 1e-9) f = 0;
    if (f > 1 - 1e-9) {
      k += 1;
      f = 0;
    }
    return this.nthWorkingDay(k) + this.dayStart + f * this.daySpan;
  }

  /** Working ordinal → Instant, preferring the *end* of the previous working day for whole numbers. */
  fromOrdFinish(o: number): Instant {
    const k = Math.floor(o + 1e-9);
    const f = o - k;
    if (f < 1e-9) return this.nthWorkingDay(k - 1) + this.dayStart + this.daySpan;
    return this.nthWorkingDay(k) + this.dayStart + f * this.daySpan;
  }

  /** Working days between two instants (b − a). */
  workingDaysBetween(a: Instant, b: Instant): number {
    return this.toOrd(b) - this.toOrd(a);
  }

  /** Start of the working day at or after `t` (normalizes a start date). */
  normalizeStart(t: Instant): Instant {
    return this.fromOrdStart(this.toOrd(t));
  }
}

export function standardCalendar(uid = 1): Calendar {
  return { uid, name: 'Standard', workWeek: STANDARD_WEEK.slice(), exceptions: [] };
}
