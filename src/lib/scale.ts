import type { Instant } from '../model/types';
import { dayNumber, instantToDate, monthName, weekdayOf } from '../scheduling/time';

export type Zoom = 'week' | 'month' | 'quarter' | 'fit';

export const PX_PER_DAY: Record<Exclude<Zoom, 'fit'>, number> = { week: 26, month: 6, quarter: 2.4 };

export interface Tick {
  x: number;
  width: number;
  label: string;
  title?: string;
}

export interface Scale {
  start: Instant;
  end: Instant;
  pxPerDay: number;
  width: number;
  x(t: Instant): number;
  top: Tick[];
  bottom: Tick[];
  /** Day lines to draw (week starts at week zoom, month starts otherwise). */
  lines: number[];
  /** Weekend bands (x, width) — only at week zoom. */
  weekends: { x: number; width: number }[];
}

function ymd(day: number): [number, number, number] {
  const d = instantToDate(day);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

function startOfMonth(day: number): number {
  const [y, m] = ymd(day);
  return dayNumber(y, m, 1);
}
function addMonths(day: number, n: number): number {
  const [y, m] = ymd(day);
  const total = y * 12 + (m - 1) + n;
  return dayNumber(Math.floor(total / 12), (total % 12) + 1, 1);
}

/** Builds a timeline scale covering [from, to] with comfortable padding. */
export function buildScale(from: Instant, to: Instant, requested: Zoom, workWeek?: boolean[], fitWidth = 1000): Scale {
  // "Fit" uses month boundaries and stretches them to the available width.
  const fit = requested === 'fit';
  let zoom: Exclude<Zoom, 'fit'> = fit ? 'month' : requested;
  let pxPerDay = fit ? 0 : PX_PER_DAY[zoom];
  let start: number;
  let end: number;
  if (zoom === 'week') {
    const s = Math.floor(from) - 7;
    start = s - ((weekdayOf(s) + 6) % 7); // Monday
    end = Math.ceil(to) + 21;
  } else {
    const m0 = startOfMonth(Math.floor(from));
    start = zoom === 'quarter' ? addMonths(m0, -((ymd(m0)[1] - 1) % 3)) : m0;
    const m1 = addMonths(startOfMonth(Math.ceil(to)), 1);
    end = zoom === 'quarter' ? addMonths(m1, (3 - ((ymd(m1)[1] - 1) % 3)) % 3) : addMonths(m1, 1);
  }
  if (fit) {
    pxPerDay = Math.max(0.5, (fitWidth - 2) / (end - start));
    if (pxPerDay * 30 < 30) zoom = 'quarter';
  }
  const width = Math.floor((end - start) * pxPerDay);
  const x = (t: Instant) => (t - start) * pxPerDay;

  const top: Tick[] = [];
  const bottom: Tick[] = [];
  const lines: number[] = [];
  const weekends: { x: number; width: number }[] = [];

  if (zoom === 'week') {
    for (let m = startOfMonth(start); m < end; m = addMonths(m, 1)) {
      const a = Math.max(m, start);
      const b = Math.min(addMonths(m, 1), end);
      const [y, mo] = ymd(m);
      top.push({ x: x(a), width: (b - a) * pxPerDay, label: `${monthName(mo - 1)} ${y}` });
    }
    for (let d = start; d < end; d += 7) {
      const [, , day] = ymd(d);
      bottom.push({ x: x(d), width: 7 * pxPerDay, label: String(day), title: `Week of ${day}` });
      lines.push(x(d));
    }
    const week = workWeek ?? [false, true, true, true, true, true, false];
    for (let d = start; d < end; d++) if (!week[weekdayOf(d)]) weekends.push({ x: x(d), width: pxPerDay });
  } else {
    for (let y = ymd(start)[0]; dayNumber(y, 1, 1) < end; y++) {
      const a = Math.max(dayNumber(y, 1, 1), start);
      const b = Math.min(dayNumber(y + 1, 1, 1), end);
      if (b > a) top.push({ x: x(a), width: (b - a) * pxPerDay, label: String(y) });
    }
    if (zoom === 'month') {
      for (let m = start; m < end; m = addMonths(m, 1)) {
        const [, mo] = ymd(m);
        bottom.push({ x: x(m), width: (addMonths(m, 1) - m) * pxPerDay, label: monthName(mo - 1) });
        lines.push(x(m));
      }
    } else {
      for (let m = start; m < end; m = addMonths(m, 1)) {
        const [, mo] = ymd(m);
        if ((mo - 1) % 3 === 0) {
          bottom.push({ x: x(m), width: (addMonths(m, 3) - m) * pxPerDay, label: `Q${(mo - 1) / 3 + 1}` });
          lines.push(x(m));
        }
      }
    }
  }
  // merge consecutive weekend days into bands
  const merged: { x: number; width: number }[] = [];
  for (const w of weekends) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.x + last.width - w.x) < 0.01) last.width += w.width;
    else merged.push({ ...w });
  }
  return { start, end, pxPerDay, width, x, top, bottom, lines, weekends: merged };
}
