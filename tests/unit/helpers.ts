import type { Link, Project, Task } from '../../src/model/types';
import { WorkCalendar, standardCalendar } from '../../src/scheduling/calendar';
import { dayNumber } from '../../src/scheduling/time';

export const at = (y: number, m: number, d: number, h = 8) => dayNumber(y, m, d) + h / 24;

export interface TaskSpec {
  uid: number;
  name?: string;
  dur?: number;
  preds?: (number | Partial<Link> & { predUid: number })[];
  parent?: number;
  summary?: boolean;
  milestone?: boolean;
  pct?: number;
  actualStart?: number;
  actualFinish?: number;
  constraint?: Task['constraint'];
  manual?: boolean;
  /** File start. Without it, the task is laid out after its predecessors. */
  start?: number;
  /** File finish. Without it, start + duration. */
  finish?: number;
  calendarUid?: number;
}

/**
 * Builds a project starting Monday 4 Jan 2027 08:00 on a Mon–Fri calendar.
 * Schedrift keeps the file's dates, so tasks without an explicit start get file dates laid out
 * from their links (as MS Project would have saved them).
 */
export function makeProject(specs: TaskSpec[], extra: Partial<Project> = {}): Project {
  const start = at(2027, 1, 4);
  const tasks: Task[] = specs.map((s, i) => ({
    uid: s.uid,
    id: i + 1,
    wbs: String(i + 1),
    name: s.name ?? `T${s.uid}`,
    outlineLevel: s.parent ? 2 : 1,
    parentUid: s.parent ?? null,
    summary: !!s.summary,
    milestone: !!s.milestone,
    manual: !!s.manual,
    active: true,
    start: s.start ?? start,
    finish: s.start ?? start,
    duration: s.milestone ? 0 : (s.dur ?? 1),
    calendarUid: s.calendarUid ?? null,
    constraint: s.constraint ?? { type: 'ASAP' },
    percentComplete: s.pct ?? 0,
    actualStart: s.actualStart,
    actualFinish: s.actualFinish,
    predecessors: (s.preds ?? []).map((p) =>
      typeof p === 'number' ? { predUid: p, type: 'FS', lag: 0, lagUnit: 'wd' } : { type: 'FS', lag: 0, lagUnit: 'wd', ...p },
    ),
  }));
  layOut(tasks, specs, start);
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    sourceFileName: 'test.xml',
    importedAt: '2027-01-01T00:00:00Z',
    projectStart: start,
    defaultCalendarUid: 1,
    calendars: [standardCalendar(1)],
    dayStartHours: 8,
    dayEndHours: 17,
    criticalSlackLimit: 0,
    tasks,
    importReport: { items: [] },
    ...extra,
  };
}

/** Places tasks after their predecessors (and their parents' predecessors) on a Mon–Fri calendar. */
function layOut(tasks: Task[], specs: TaskSpec[], projectStart: number) {
  const cal = new WorkCalendar(standardCalendar(1), 8, 17, Math.floor(projectStart));
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const spec = new Map(specs.map((s) => [s.uid, s]));
  const parents = new Set(tasks.map((t) => t.parentUid).filter((u): u is number => u !== null));
  const leaves = tasks.filter((t) => !parents.has(t.uid));
  const kidsOf = (uid: number): Task[] => tasks.filter((t) => t.parentUid === uid).flatMap((k) => (parents.has(k.uid) ? kidsOf(k.uid) : [k]));
  const span = (t: Task) => (parents.has(t.uid) ? (() => {
    const k = kidsOf(t.uid);
    return { s: Math.min(...k.map((x) => x.start)), f: Math.max(...k.map((x) => x.finish)) };
  })() : { s: t.start, f: t.finish });
  const place = (t: Task, ord: number, fromFinish: boolean) => {
    const sp = spec.get(t.uid)!;
    t.start = t.duration === 0 && fromFinish ? cal.fromOrdFinish(ord) : cal.fromOrdStart(ord);
    t.finish = sp.finish ?? (t.duration === 0 ? t.start : cal.fromOrdFinish(ord + t.duration));
  };
  for (const t of leaves) place(t, cal.toOrd(spec.get(t.uid)!.start ?? projectStart), false);
  for (let pass = 0; pass < tasks.length + 1; pass++) {
    let changed = false;
    for (const t of leaves) {
      const sp = spec.get(t.uid)!;
      if (sp.start !== undefined || t.manual) continue;
      let best = cal.toOrd(projectStart);
      let fromFinish = false;
      const links: Link[] = [...t.predecessors];
      for (let p = t.parentUid; p !== null; p = byUid.get(p)?.parentUid ?? null) links.push(...(byUid.get(p)?.predecessors ?? []));
      for (const l of links) {
        const pred = byUid.get(l.predUid);
        if (!pred || pred.uid === t.uid) continue;
        const { s, f } = span(pred);
        const lag = (i: number) => (l.lagUnit === 'ed' ? cal.toOrd(i + l.lag) : cal.toOrd(i) + l.lag);
        const c = l.type === 'FS' ? lag(f) : l.type === 'SS' ? lag(s) : (l.type === 'FF' ? lag(f) : lag(s)) - t.duration;
        if (c > best + 1e-9) { best = c; fromFinish = l.type === 'FS' || l.type === 'FF'; }
      }
      const before = t.start;
      place(t, best, fromFinish);
      if (Math.abs(before - t.start) > 1e-9) changed = true;
    }
    if (!changed) break;
  }
}
