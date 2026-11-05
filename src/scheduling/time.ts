import type { Instant } from '../model/types';

const MS_PER_DAY = 86_400_000;
export const EPS = 1e-6;

/** Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss]" as wall-clock time. Returns null if invalid. */
export function parseInstant(text: string | undefined | null): Instant | null {
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h = '0', mi = '0', s = '0'] = m.slice(1);
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day, Number(h), Number(mi), Number(s));
  const check = new Date(ms);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;
  if (year < 1984 || year > 2149) return null; // MS Project supports 1984–2149
  return ms / MS_PER_DAY;
}

export function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function dayOf(t: Instant): number {
  return Math.floor(t + 1e-9);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(day: number): number {
  // 1970-01-01 was a Thursday (4)
  return (((day + 4) % 7) + 7) % 7;
}

export function instantToDate(t: Instant): Date {
  return new Date(Math.round(t * MS_PER_DAY));
}

export function formatInstantISO(t: Instant, withTime = true): string {
  const d = instantToDate(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (!withTime) return date;
  return `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu 11 Mar 2027" */
export function formatDate(t: Instant | undefined | null, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (t === undefined || t === null || !Number.isFinite(t)) return '—';
  const d = instantToDate(t);
  const parts: string[] = [];
  if (opts.weekday) parts.push(WEEKDAYS[d.getUTCDay()]!);
  parts.push(String(d.getUTCDate()), MONTHS[d.getUTCMonth()]!);
  if (opts.year !== false) parts.push(String(d.getUTCFullYear()));
  return parts.join(' ');
}

export function monthName(index: number): string {
  return MONTHS[index]!;
}

/** Today's date as an Instant at midnight (local wall-clock). */
export function todayInstant(now = new Date()): Instant {
  return dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function formatDays(n: number): string {
  const r = Math.round(n * 100) / 100;
  const abs = Math.abs(r);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(abs < 1 ? 2 : 1).replace(/\.?0+$/, '');
  return `${r < 0 ? '−' : ''}${text} ${abs === 1 ? 'day' : 'days'}`;
}
