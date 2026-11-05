import { XMLParser } from 'fast-xml-parser';
import type { Calendar, CalendarException, ConstraintType, Instant, Link, LinkType, Project, ReportItem, Task } from '../model/types';
import { standardCalendar } from '../scheduling/calendar';
import { dayOf, parseInstant } from '../scheduling/time';

/** Thrown when the file is not a readable MSPDI document. */
export class ImportError extends Error {}

type Node = Record<string, unknown>;

const ARRAY_TAGS = new Set([
  'Task', 'PredecessorLink', 'Calendar', 'WeekDay', 'WorkingTime', 'Exception', 'Baseline', 'WorkWeek', 'TimePeriod',
]);

const LINK_TYPES: Record<string, LinkType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };
const CONSTRAINTS: Record<string, ConstraintType> = {
  '0': 'ASAP', '1': 'ALAP', '2': 'MSO', '3': 'MFO', '4': 'SNET', '5': 'SNLT', '6': 'FNET', '7': 'FNLT',
};
/** MSPDI duration/lag formats that are elapsed (calendar) time. */
const ELAPSED_FORMATS = new Set([4, 6, 8, 10, 12, 36, 38, 40, 42, 44]);
const PERCENT_FORMATS = new Set([19, 20, 51, 52]);

function str(n: Node | undefined, key: string): string | undefined {
  const v = n?.[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object') return undefined;
  return String(v);
}
function num(n: Node | undefined, key: string): number | undefined {
  const s = str(n, key);
  if (s === undefined || s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}
function bool(n: Node | undefined, key: string): boolean {
  return str(n, key) === '1' || str(n, key)?.toLowerCase() === 'true';
}
function arr(n: Node | undefined, key: string): Node[] {
  const v = n?.[key];
  return Array.isArray(v) ? (v as Node[]) : v && typeof v === 'object' ? [v as Node] : [];
}
function child(n: Node | undefined, key: string): Node | undefined {
  const v = n?.[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : undefined;
}

/** "PT8H30M0S" → minutes. Supports optional days and negative sign. */
export function durationMinutes(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /^(-)?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text.trim());
  if (!m) return undefined;
  const [, neg, , , d, h, mi, s] = m;
  const minutes = Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(mi ?? 0) + Number(s ?? 0) / 60;
  return neg ? -minutes : minutes;
}

function hoursOf(time: string | undefined, fallback: number): number {
  const m = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null;
  return m ? Number(m[1]) + Number(m[2]) / 60 : fallback;
}

function daysInRange(from: Instant, to: Instant): number[] {
  const out: number[] = [];
  const a = dayOf(from);
  const b = dayOf(to - 1 / 86400);
  for (let d = a; d <= b && out.length < 20_000; d++) out.push(d);
  return out;
}

function parseCalendars(raw: Node[], minutesPerDay: number, report: ReportItem[]): Calendar[] {
  interface Draft { uid: number; name: string; base?: number; week: (boolean | undefined)[]; exceptions: CalendarException[]; isBase: boolean }
  const drafts = new Map<number, Draft>();
  for (const c of raw) {
    const uid = num(c, 'UID');
    if (uid === undefined) continue;
    const week: (boolean | undefined)[] = new Array(7).fill(undefined);
    const exceptions = new Map<number, boolean>();
    const name = str(c, 'Name') ?? `Calendar ${uid}`;
    let partial = false;
    for (const wd of arr(child(c, 'WeekDays'), 'WeekDay')) {
      const type = num(wd, 'DayType');
      const working = bool(wd, 'DayWorking');
      if (type === 0) {
        for (const tp of arr(wd, 'TimePeriod')) {
          const from = parseInstant(str(tp, 'FromDate'));
          const to = parseInstant(str(tp, 'ToDate'));
          if (from !== null && to !== null) for (const d of daysInRange(from, to)) exceptions.set(d, working);
        }
      } else if (type !== undefined && type >= 1 && type <= 7) {
        week[type - 1] = working;
        if (working) {
          const mins = arr(child(wd, 'WorkingTimes'), 'WorkingTime').reduce((sum, w) => {
            const a = hoursOf(str(w, 'FromTime'), 0);
            let b = hoursOf(str(w, 'ToTime'), 0);
            if (b <= a) b += 24;
            return sum + (b - a) * 60;
          }, 0);
          if (mins > 0 && Math.abs(mins - minutesPerDay) > 1) partial = true;
        }
      }
    }
    let recurring = false;
    for (const ex of arr(child(c, 'Exceptions'), 'Exception')) {
      const type = num(ex, 'Type') ?? 1;
      const working = bool(ex, 'DayWorking');
      const tp = arr(ex, 'TimePeriod')[0];
      const from = parseInstant(str(tp, 'FromDate'));
      const to = parseInstant(str(tp, 'ToDate'));
      if (from === null || to === null) continue;
      if (type === 1) for (const d of daysInRange(from, to)) exceptions.set(d, working);
      else recurring = true;
    }
    if (arr(child(c, 'WorkWeeks'), 'WorkWeek').length) {
      report.push({ level: 'warning', code: 'calendar-work-weeks', message: `Calendar "${name}" defines alternate work weeks. Only its default work week is used.` });
    }
    if (recurring) {
      report.push({ level: 'warning', code: 'calendar-recurring', message: `Calendar "${name}" has recurring exceptions. Only explicitly dated exceptions are applied.` });
    }
    if (partial) {
      report.push({ level: 'info', code: 'calendar-hours', message: `Calendar "${name}" has working days that differ from ${minutesPerDay / 60} hours. Schedrift schedules in whole working days.` });
    }
    drafts.set(uid, {
      uid, name, base: num(c, 'BaseCalendarUID'), week,
      exceptions: [...exceptions].map(([day, w]) => ({ day, working: w })), isBase: bool(c, 'IsBaseCalendar'),
    });
  }
  const resolved = new Map<number, Calendar>();
  const resolve = (uid: number, depth = 0): Calendar | undefined => {
    if (resolved.has(uid)) return resolved.get(uid);
    const d = drafts.get(uid);
    if (!d) return undefined;
    const parent = d.base !== undefined && d.base >= 0 && d.base !== uid && depth < 20 ? resolve(d.base, depth + 1) : undefined;
    const fallback = parent?.workWeek ?? standardCalendar().workWeek;
    const workWeek = d.week.map((w, i) => (w === undefined ? fallback[i]! : w));
    const ex = new Map((parent?.exceptions ?? []).map((e) => [e.day, e.working]));
    for (const e of d.exceptions) ex.set(e.day, e.working);
    const cal: Calendar = { uid, name: d.name, workWeek, exceptions: [...ex].map(([day, working]) => ({ day, working })).sort((a, b) => a.day - b.day) };
    resolved.set(uid, cal);
    return cal;
  };
  for (const uid of drafts.keys()) resolve(uid);
  return [...resolved.values()];
}

export interface ParsedMspdi {
  project: Project;
}

/** Parse a Microsoft Project XML (MSPDI) document into the Schedrift model. */
export function parseMspdi(xml: string, sourceFileName: string): Project {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => ARRAY_TAGS.has(name),
    processEntities: true,
  });
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (e) {
    throw new ImportError(`The file is not valid XML: ${(e as Error).message}`);
  }
  const root = child(doc, 'Project');
  if (!root) throw new ImportError('This is not a Microsoft Project XML (MSPDI) file: no <Project> element found.');

  const report: ReportItem[] = [];
  const minutesPerDay = num(root, 'MinutesPerDay') || 480;
  const dayStartHours = hoursOf(str(root, 'DefaultStartTime'), 8);
  let dayEndHours = hoursOf(str(root, 'DefaultFinishTime'), 17);
  if (dayEndHours <= dayStartHours) dayEndHours = dayStartHours + minutesPerDay / 60;

  const calendars = parseCalendars(arr(child(root, 'Calendars'), 'Calendar'), minutesPerDay, report);
  let defaultCalendarUid = num(root, 'CalendarUID') ?? 1;
  if (!calendars.some((c) => c.uid === defaultCalendarUid)) {
    report.push({ level: 'warning', code: 'calendar-missing', message: 'The project calendar is missing. A standard Monday–Friday calendar is used.' });
    const std = standardCalendar(calendars.length ? Math.max(...calendars.map((c) => c.uid)) + 1 : 1);
    calendars.push(std);
    defaultCalendarUid = std.uid;
  }
  const calendarUids = new Set(calendars.map((c) => c.uid));

  if (str(root, 'ScheduleFromStart') === '0') {
    report.push({ level: 'warning', code: 'schedule-from-finish', message: 'The project is scheduled from its finish date. Schedrift schedules forward from the project start.' });
  }

  const rawTasks = arr(child(root, 'Tasks'), 'Task');
  const tasks: Task[] = [];
  const stack: Task[] = [];
  const dropped = { null: 0, external: 0 };
  const flagged = { manual: [] as number[], inactive: [] as number[], alap: [] as number[], elapsed: [] as number[], percentLag: [] as number[], split: [] as number[], subproject: [] as number[], badDates: [] as number[], effort: [] as number[], leveling: [] as number[] };
  let projectStart = parseInstant(str(root, 'StartDate'));
  const percentLags: { link: Link; percent: number }[] = [];

  for (const rt of rawTasks) {
    const uid = num(rt, 'UID');
    if (uid === undefined) continue;
    const level = num(rt, 'OutlineLevel') ?? 1;
    if (uid === 0 || level === 0) continue; // project summary task
    if (bool(rt, 'IsNull')) { dropped.null++; continue; }
    if (bool(rt, 'ExternalTask')) { dropped.external++; continue; }

    const name = str(rt, 'Name') ?? `(unnamed ${uid})`;
    let start = parseInstant(str(rt, 'Start'));
    let finish = parseInstant(str(rt, 'Finish'));
    if (start === null || finish === null) {
      flagged.badDates.push(uid);
      start = start ?? finish ?? projectStart ?? NaN;
      finish = finish ?? start;
    }
    const durMin = durationMinutes(str(rt, 'Duration'));
    const durFormat = num(rt, 'DurationFormat') ?? 7;
    let duration = durMin !== undefined ? durMin / minutesPerDay : NaN;
    if (ELAPSED_FORMATS.has(durFormat)) {
      flagged.elapsed.push(uid);
      if (durMin !== undefined) duration = (durMin / 1440) * (5 / 7);
    }
    const milestone = bool(rt, 'Milestone');
    const summary = bool(rt, 'Summary');
    // MS Project allows flagging a task with duration as a milestone; keep its real duration.
    if (milestone && !summary && !(duration >= 0)) duration = 0;
    if (bool(rt, 'Manual')) flagged.manual.push(uid);
    const active = str(rt, 'Active') !== '0';
    if (!active) flagged.inactive.push(uid);
    if (bool(rt, 'IsSubproject')) flagged.subproject.push(uid);
    if (arr(rt, 'TimephasedData').length || child(rt, 'SplitParts')) flagged.split.push(uid);

    const cType = CONSTRAINTS[str(rt, 'ConstraintType') ?? '0'] ?? 'ASAP';
    const cDate = parseInstant(str(rt, 'ConstraintDate')) ?? undefined;
    if (cType === 'ALAP') flagged.alap.push(uid);

    const predecessors: Link[] = [];
    for (const pl of arr(rt, 'PredecessorLink')) {
      const predUid = num(pl, 'PredecessorUID');
      if (predUid === undefined) continue;
      if (bool(pl, 'CrossProject')) continue;
      const type = LINK_TYPES[str(pl, 'Type') ?? '1'] ?? 'FS';
      const raw = num(pl, 'LinkLag') ?? 0; // tenths of a minute
      const format = num(pl, 'LagFormat') ?? 7;
      let lag = raw / 10 / minutesPerDay;
      let lagUnit: Link['lagUnit'] = 'wd';
      if (ELAPSED_FORMATS.has(format)) {
        lag = raw / 10 / 1440;
        lagUnit = 'ed';
      } else if (PERCENT_FORMATS.has(format)) {
        flagged.percentLag.push(uid);
        const link: Link = { predUid, type, lag: 0, lagUnit: 'wd' };
        percentLags.push({ link, percent: raw / 10 }); // resolved once all durations are known
        predecessors.push(link);
        continue;
      }
      predecessors.push({ predUid, type, lag: Math.round(lag * 1e6) / 1e6, lagUnit });
    }

    const baseline = arr(rt, 'Baseline').find((b) => (num(b, 'Number') ?? 0) === 0);
    const calUid = num(rt, 'CalendarUID');
    const task: Task = {
      uid,
      id: num(rt, 'ID') ?? uid,
      wbs: str(rt, 'WBS') ?? str(rt, 'OutlineNumber') ?? '',
      name,
      outlineLevel: level,
      parentUid: null,
      summary,
      milestone,
      manual: bool(rt, 'Manual'),
      active,
      start,
      finish,
      duration: summary ? 0 : duration,
      calendarUid: calUid !== undefined && calUid >= 0 && calendarUids.has(calUid) ? calUid : null,
      constraint: { type: cType, date: cType === 'ASAP' || cType === 'ALAP' ? undefined : cDate },
      deadline: parseInstant(str(rt, 'Deadline')) ?? undefined,
      percentComplete: num(rt, 'PercentComplete') ?? 0,
      actualStart: parseInstant(str(rt, 'ActualStart')) ?? undefined,
      actualFinish: parseInstant(str(rt, 'ActualFinish')) ?? undefined,
      baselineStart: baseline ? (parseInstant(str(baseline, 'Start')) ?? undefined) : undefined,
      baselineFinish: baseline ? (parseInstant(str(baseline, 'Finish')) ?? undefined) : undefined,
      predecessors,
    };
    if (calUid !== undefined && calUid >= 0 && !calendarUids.has(calUid)) {
      report.push({ level: 'warning', code: 'calendar-unknown', message: `"${name}" uses calendar UID ${calUid}, which is not in the file. The project calendar is used.`, taskUids: [uid] });
    }
    if (bool(rt, 'EffortDriven') && str(rt, 'Type') === '2') flagged.effort.push(uid);
    const levelingDelay = num(rt, 'LevelingDelay') ?? 0; // tenths of a minute
    if (levelingDelay > 0) {
      flagged.leveling.push(uid);
      task.levelingDelay = Math.round((levelingDelay / 10 / minutesPerDay) * 100) / 100;
    }

    while (stack.length && stack[stack.length - 1]!.outlineLevel >= level) stack.pop();
    task.parentUid = stack.length ? stack[stack.length - 1]!.uid : null;
    stack.push(task);
    tasks.push(task);
    if (projectStart === null && Number.isFinite(start)) projectStart = start;
  }

  if (!tasks.length) throw new ImportError('The file contains no tasks.');

  // A task is a summary if it has children, regardless of the flag.
  const hasKids = new Set(tasks.map((t) => t.parentUid).filter((u): u is number => u !== null));
  for (const t of tasks) {
    if (hasKids.has(t.uid)) t.summary = true;
    else if (t.summary) { t.summary = false; if (!(t.duration >= 0)) t.duration = 0; }
  }

  // Resolve percentage lags against predecessor durations.
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  for (const { link, percent } of percentLags) {
    const pred = byUid.get(link.predUid);
    link.lag = pred ? Math.round((percent / 100) * pred.duration * 1e6) / 1e6 : 0;
  }

  const name = str(root, 'Title') || str(root, 'Name')?.replace(/\.(xml|mpp)$/i, '') || sourceFileName.replace(/\.[^.]+$/, '');
  const ps = projectStart ?? Math.min(...tasks.map((t) => t.start).filter(Number.isFinite));

  const add = (level: ReportItem['level'], code: string, uids: number[], message: string) => {
    if (uids.length) report.push({ level, code, message: message.replace('{n}', String(uids.length)), taskUids: uids });
  };
  add('error', 'invalid-date', flagged.badDates, '{n} task(s) have missing or invalid start/finish dates.');
  add('warning', 'manual-tasks', flagged.manual, '{n} manually scheduled task(s). Like MS Project, they stay pinned to their dates unless simulated directly.');
  add('info', 'inactive-tasks', flagged.inactive, '{n} inactive task(s) are shown but do not affect the schedule.');
  add('warning', 'alap', flagged.alap, '{n} task(s) use "As Late As Possible". They are scheduled as soon as possible.');
  add('warning', 'elapsed-duration', flagged.elapsed, '{n} task(s) have elapsed durations, converted to working days (×5/7).');
  add('info', 'percent-lag', flagged.percentLag, '{n} link(s) use percentage lag, converted to working days.');
  add('warning', 'subproject', flagged.subproject, '{n} inserted subproject(s) are not expanded.');
  add('info', 'split-tasks', flagged.split, '{n} task(s) may be split. Splits are not modelled.');
  add('warning', 'leveling-delay', flagged.leveling, '{n} task(s) carry a resource-leveling delay from MS Project. Schedrift does not apply leveling delays, so these tasks may start earlier than in the file.');
  if (dropped.null) report.push({ level: 'info', code: 'null-tasks', message: `${dropped.null} blank row(s) skipped.` });
  if (dropped.external) report.push({ level: 'warning', code: 'external-tasks', message: `${dropped.external} external (cross-project) task(s) and their links are not imported.` });

  return {
    schemaVersion: 1,
    id: newId(),
    name,
    sourceFileName,
    importedAt: new Date().toISOString(),
    projectStart: ps,
    statusDate: parseInstant(str(root, 'StatusDate')) ?? undefined,
    defaultCalendarUid,
    calendars,
    dayStartHours,
    dayEndHours,
    criticalSlackLimit: (num(root, 'CriticalSlackLimit') ?? 0),
    tasks,
    importReport: { items: report },
  };
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
