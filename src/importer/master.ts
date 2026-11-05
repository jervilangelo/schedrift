/**
 * "Update from Excel master": keep the dependency network of the imported MS Project file
 * and take task dates, durations, actuals and status from a spreadsheet that is the
 * source of truth for dates.
 *
 * Rules
 * - Rows are matched to tasks by name, in outline order (so a name used in Phase 1 and
 *   Phase 2 matches the right task), with a fuzzy fallback for small spelling differences.
 * - Not started: duration = working days from Excel planned start to planned end, and the
 *   Excel start becomes a "Start No Earlier Than" constraint. The task keeps Excel's date
 *   unless a predecessor forces it later, so simulated delays still flow downstream.
 * - In progress: actual start from Excel (planned start if blank); finish forecast = planned end.
 * - Complete: actual start and end from Excel (planned dates if blank).
 * - Summary rows only help matching; summary dates always roll up from their tasks.
 */
import type { Instant, Project, Task } from '../model/types';
import type { Cell, Sheet } from './sheet';
import { buildNetwork, schedule, type ScheduleResult } from '../scheduling/engine';
import { detectGoLive } from '../scheduling/impact';
import { dayNumber } from '../scheduling/time';

export type MasterStatus = 'complete' | 'in-progress' | 'not-started';

export interface MasterRow {
  /** 1-based spreadsheet row number. */
  row: number;
  name: string;
  phase?: string;
  status?: MasterStatus;
  /** Day numbers (days since 1970-01-01). */
  plannedStart?: number;
  plannedEnd?: number;
  actualStart?: number;
  actualEnd?: number;
}

export interface MasterTable {
  fileName: string;
  sheetName: string;
  headerRow: number;
  columns: Partial<Record<keyof Omit<MasterRow, 'row'>, string>>;
  rows: MasterRow[];
}

export interface MasterMatch {
  uid: number;
  row: MasterRow;
  how: 'exact' | 'similar';
}

export interface MasterDifference {
  uid: number;
  excelStart: Instant;
  excelEnd: Instant;
  start: Instant;
  end: Instant;
  reason: string;
}

export interface MasterUpdate {
  project: Project;
  table: MasterTable;
  matched: MasterMatch[];
  excelOnly: MasterRow[];
  projectOnly: number[];
  /** Matched tasks whose recalculated dates are not Excel's dates. */
  differences: MasterDifference[];
  /** Tasks in progress whose planned end is already in the past. */
  overdue: number[];
  goLive?: { uid: number; finish: Instant };
}

// ---------------------------------------------------------------- parsing

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function yearOf(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

function valid(y: number, m: number, d: number): number | undefined {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1984 && y <= 2149)) return undefined;
  const day = dayNumber(y, m, d);
  const check = new Date(day * 86_400_000);
  return check.getUTCDate() === d ? day : undefined;
}

/**
 * Parses the date formats people type in planning sheets, e.g.
 * "Thu Jul-02-2026", "02/Jul/26", "2026-07-02", "Jul 2, 2026", "2 Jul 2026", "7/2/2026" (month first).
 */
export function parseLooseDate(value: Cell, date1904 = false): number | undefined {
  if (value === null || value === '') return undefined;
  if (typeof value === 'number') {
    if (value < 1 || value > 200_000) return undefined;
    return Math.floor(value) + (date1904 ? 1462 : 0) - 25569; // Excel serial → days since 1970
  }
  const s = value.trim().toLowerCase().replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*[\s,.]+/, '').replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return valid(+m[1]!, +m[2]!, +m[3]!);
  if ((m = /^([a-z]{3,9})[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+(\d{2,4})$/.exec(s))) {
    const mo = MONTHS[m[1]!.slice(0, 4)] ?? MONTHS[m[1]!.slice(0, 3)];
    return mo ? valid(yearOf(m[3]!), mo, +m[2]!) : undefined;
  }
  if ((m = /^(\d{1,2})[\s\-/.]+([a-z]{3,9})[\s\-/.,]+(\d{2,4})$/.exec(s))) {
    const mo = MONTHS[m[2]!.slice(0, 4)] ?? MONTHS[m[2]!.slice(0, 3)];
    return mo ? valid(yearOf(m[3]!), mo, +m[1]!) : undefined;
  }
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s))) {
    // Month first (as in the Philippines and the US) unless that is impossible.
    const a = +m[1]!;
    const b = +m[2]!;
    return a > 12 ? valid(yearOf(m[3]!), b, a) : valid(yearOf(m[3]!), a, b);
  }
  return undefined;
}

function parseStatus(value: Cell): MasterStatus | undefined {
  const s = String(value ?? '').toLowerCase();
  if (!s.trim()) return undefined;
  if (/complet|done|finish|closed/.test(s)) return 'complete';
  if (/progress|ongoing|on-going|started|active|wip/.test(s) && !/not started|yet/.test(s)) return 'in-progress';
  if (/yet|not started|pending|planned|open|to do|todo/.test(s)) return 'not-started';
  return undefined;
}

const norm = (v: Cell) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

type ColumnKey = keyof MasterTable['columns'];
const COLUMN_TESTS: [ColumnKey, (h: string) => boolean][] = [
  ['plannedStart', (h) => /planned.*start|baseline.*start|^start( date)?$/.test(h)],
  ['plannedEnd', (h) => /planned.*(end|finish)|baseline.*(end|finish)|^(end|finish)( date)?$/.test(h)],
  ['actualStart', (h) => /actual.*start/.test(h)],
  ['actualEnd', (h) => /actual.*(end|finish)/.test(h)],
  ['status', (h) => /^status$|task status|status/.test(h) && !/rag/.test(h)],
  ['phase', (h) => /phase/.test(h)],
  ['name', (h) => /task|milestone|activity|breakdown|name|description/.test(h) && !/planned|actual|status|phase|owner/.test(h)],
];

/** Finds the header row and columns, then reads every task row. */
export function parseMaster(sheets: Sheet[], fileName: string): MasterTable {
  for (const sheet of sheets) {
    for (let r = 0; r < Math.min(40, sheet.rows.length); r++) {
      const headers = (sheet.rows[r] ?? []).map(norm);
      const cols: Partial<Record<ColumnKey, number>> = {};
      for (const [key, test] of COLUMN_TESTS) {
        const i = headers.findIndex((h, k) => h && test(h) && !Object.values(cols).includes(k));
        if (i >= 0) cols[key] = i;
      }
      if (cols.plannedStart === undefined || cols.plannedEnd === undefined) continue;
      if (cols.name === undefined) cols.name = headers.findIndex((h) => h !== '');
      const original = sheet.rows[r] ?? [];
      const columns: MasterTable['columns'] = {};
      for (const [k, i] of Object.entries(cols) as [ColumnKey, number][]) columns[k] = String(original[i] ?? '').replace(/\s+/g, ' ').trim();

      const rows: MasterRow[] = [];
      for (let k = r + 1; k < sheet.rows.length; k++) {
        const cells = sheet.rows[k] ?? [];
        const get = (key: ColumnKey) => (cols[key] === undefined ? null : (cells[cols[key]!] ?? null));
        const name = String(get('name') ?? '').replace(/\s+/g, ' ').trim();
        if (!name) continue;
        rows.push({
          row: k + 1,
          name,
          phase: get('phase') === null ? undefined : String(get('phase')).trim(),
          status: parseStatus(get('status')),
          plannedStart: parseLooseDate(get('plannedStart'), sheet.date1904),
          plannedEnd: parseLooseDate(get('plannedEnd'), sheet.date1904),
          actualStart: parseLooseDate(get('actualStart'), sheet.date1904),
          actualEnd: parseLooseDate(get('actualEnd'), sheet.date1904),
        });
      }
      return { fileName, sheetName: sheet.name, headerRow: r + 1, columns, rows };
    }
  }
  throw new Error('No header row with "Planned Start" and "Planned End" (or "Start" and "Finish") columns was found in the first 40 rows.');
}

// ---------------------------------------------------------------- matching

/** Lowercase, no leading outline numbers ("1 ", "2.3 "), letters and digits only. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\s*\d+(\.\d+)*[.)]?\s+/, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity on character bigrams (0–1). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

const SIMILAR = 0.86;

export function matchRows(project: Project, rows: MasterRow[]): { matched: MasterMatch[]; excelOnly: MasterRow[]; projectOnly: number[] } {
  const tasks = project.tasks.map((t, index) => ({ t, index, key: normalizeName(t.name) }));
  const used = new Set<number>();
  const matched: MasterMatch[] = [];
  const excelOnly: MasterRow[] = [];
  let last = -1;

  for (const row of rows) {
    const key = normalizeName(row.name);
    if (!key) continue;
    const free = tasks.filter((x) => !used.has(x.t.uid));
    const pick = (cands: typeof free) => cands.find((c) => c.index > last) ?? cands[0];
    let hit = pick(free.filter((x) => x.key === key));
    let how: MasterMatch['how'] = 'exact';
    if (!hit) {
      const scored = free.map((x) => ({ x, s: similarity(x.key, key) })).filter((c) => c.s >= SIMILAR);
      const ahead = scored.filter((c) => c.x.index > last).sort((a, b) => a.x.index - b.x.index);
      const best = (ahead.length ? ahead : scored.sort((a, b) => b.s - a.s))[0];
      hit = best?.x;
      how = 'similar';
    }
    if (!hit) {
      excelOnly.push(row);
      continue;
    }
    used.add(hit.t.uid);
    last = hit.index;
    matched.push({ uid: hit.t.uid, row, how });
  }
  const projectOnly = project.tasks.filter((t) => !used.has(t.uid)).map((t) => t.uid);
  return { matched, excelOnly, projectOnly };
}

// ---------------------------------------------------------------- applying

export function applyMaster(project: Project, table: MasterTable, today: number): MasterUpdate {
  const { matched, excelOnly, projectOnly } = matchRows(project, table.rows);
  const net = buildNetwork(project);
  const startOf = (day: number) => day + project.dayStartHours / 24;
  const endOf = (day: number) => day + project.dayEndHours / 24;
  const byUid = new Map(matched.map((m) => [m.uid, m]));
  const overdue: number[] = [];

  const tasks = project.tasks.map((orig): Task => {
    const m = byUid.get(orig.uid);
    if (!m || orig.summary) return orig;
    const r = m.row;
    if (r.plannedStart === undefined && r.plannedEnd === undefined && r.actualStart === undefined) return orig;
    const t: Task = { ...orig, constraint: { ...orig.constraint }, predecessors: orig.predecessors };
    const cal = (t.calendarUid !== null && net.calendars.get(t.calendarUid)) || net.defaultCal;
    const span = (a: number, b: number) => Math.max(0, Math.round((cal.toOrd(endOf(b)) - cal.toOrd(startOf(a))) * 1000) / 1000);
    const keepMilestone = orig.milestone && orig.duration === 0;
    const status = r.status ?? (r.actualEnd !== undefined ? 'complete' : r.actualStart !== undefined ? 'in-progress' : 'not-started');

    if (status === 'complete') {
      const s = r.actualStart ?? r.plannedStart ?? r.actualEnd!;
      const e = r.actualEnd ?? r.plannedEnd ?? s;
      t.percentComplete = 100;
      t.actualStart = startOf(s);
      t.actualFinish = keepMilestone ? startOf(s) : endOf(Math.max(s, e));
      t.start = t.actualStart;
      t.finish = t.actualFinish;
      if (!keepMilestone) t.duration = span(s, Math.max(s, e));
    } else if (status === 'in-progress') {
      const s = r.actualStart ?? r.plannedStart ?? today;
      const e = r.plannedEnd !== undefined && r.plannedEnd >= s ? r.plannedEnd : s;
      t.actualStart = startOf(s);
      t.actualFinish = undefined;
      if (t.percentComplete >= 100) t.percentComplete = 0; // the actual start marks it as started
      t.start = t.actualStart;
      t.finish = endOf(e);
      if (!keepMilestone) t.duration = span(s, e);
      if (e < today) overdue.push(t.uid);
    } else {
      const s = r.plannedStart ?? r.plannedEnd!;
      const e = r.plannedEnd !== undefined && r.plannedEnd >= s ? r.plannedEnd : s;
      t.actualStart = undefined;
      t.actualFinish = undefined;
      t.percentComplete = 0;
      t.start = startOf(s);
      t.finish = keepMilestone ? t.start : endOf(e);
      if (!keepMilestone) t.duration = span(s, e);
      if (t.constraint.type === 'ASAP' || t.constraint.type === 'SNET' || t.constraint.type === 'ALAP') {
        t.constraint = { type: 'SNET', date: startOf(s) };
      }
    }
    return t;
  });

  const next: Project = {
    ...project,
    tasks,
    sourceFileName: project.sourceFileName.includes(' + ') ? project.sourceFileName.replace(/ \+ .*$/, ` + ${table.fileName}`) : `${project.sourceFileName} + ${table.fileName}`,
  };
  const result = schedule(next);
  // Tasks that are not in the master keep their dependencies and move with them; their old
  // project-file dates no longer apply, so they become the reference dates for the schedule check.
  const matchedUids = new Set(matched.map((m) => m.uid));
  next.tasks = next.tasks.map((t) => {
    if (t.summary || matchedUids.has(t.uid) || t.manual) return t;
    const s = result.byUid.get(t.uid);
    return s ? { ...t, start: s.es, finish: s.ef } : t;
  });
  const differences = diffAgainstFile(next, result, matchedUids);
  next.importReport = {
    ...next.importReport,
    scheduleCheck: scheduleCheckFor(next, result),
  };
  const glUid = goLiveFor(next, result);
  next.goLiveUid = glUid;
  return {
    project: next,
    table,
    matched,
    excelOnly,
    projectOnly,
    differences,
    overdue,
    goLive: glUid !== undefined ? { uid: glUid, finish: result.byUid.get(glUid)!.ef } : undefined,
  };
}

/** Keep the user's Go-Live choice; otherwise auto-detect. */
function goLiveFor(project: Project, result: ScheduleResult): number | undefined {
  if (project.goLiveUid !== undefined && project.tasks.some((t) => t.uid === project.goLiveUid)) return project.goLiveUid;
  return detectGoLive(project, result);
}

const sameDay = (a: Instant, b: Instant) => Math.floor(a + 1e-9) === Math.floor(b + 1e-9);

function diffAgainstFile(project: Project, result: ScheduleResult, only: Set<number>): MasterDifference[] {
  const byUid = new Map(project.tasks.map((t) => [t.uid, t]));
  const out: MasterDifference[] = [];
  for (const t of project.tasks) {
    if (t.summary || !only.has(t.uid)) continue;
    const s = result.byUid.get(t.uid);
    if (!s || (sameDay(s.es, t.start) && sameDay(s.ef, t.finish))) continue;
    let reason = '';
    if (s.driver.kind === 'link') {
      const p = byUid.get(s.driver.predUid);
      const ps = result.byUid.get(s.driver.predUid);
      reason = `Waits for “${p?.name ?? s.driver.predUid}” (${s.driver.type})${ps ? `, which finishes ${new Date(ps.ef * 86_400_000).toUTCString().slice(5, 16)}` : ''}`;
    } else if (s.driver.kind === 'constraint') reason = `${t.constraint.type} constraint in the project file`;
    else if (s.driver.kind === 'manual') reason = 'Manually scheduled task in the project file';
    else if (s.driver.kind === 'actual') reason = 'Actual dates';
    else reason = 'Calendar (non-working days)';
    out.push({ uid: t.uid, excelStart: t.start, excelEnd: t.finish, start: s.es, end: s.ef, reason });
  }
  return out;
}

/** Same rule as the import schedule check, against the dates now stored on each task. */
export function scheduleCheckFor(project: Project, result: ScheduleResult) {
  const net = buildNetwork(project);
  const mismatched: number[] = [];
  let compared = 0;
  for (const t of project.tasks) {
    if (t.summary || !t.active || !Number.isFinite(t.start)) continue;
    const s = result.byUid.get(t.uid);
    if (!s) continue;
    compared++;
    const cal = (t.calendarUid !== null && net.calendars.get(t.calendarUid)) || net.defaultCal;
    const same = (a: number, b: number) => sameDay(a, b) || Math.abs(cal.toOrd(a) - cal.toOrd(b)) <= 0.13;
    if (!same(s.es, t.start) || !same(s.ef, t.finish)) mismatched.push(t.uid);
  }
  return { compared, matched: compared - mismatched.length, mismatchedUids: mismatched };
}
