import type { Link, Project, Task } from '../../src/model/types';
import { standardCalendar } from '../../src/scheduling/calendar';
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
  start?: number;
  calendarUid?: number;
}

/** Builds a project starting Monday 4 Jan 2027 08:00 on a Mon–Fri calendar. */
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
