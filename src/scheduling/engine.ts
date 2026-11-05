import type { Instant, Link, Project, Scenario, ScenarioItem, Task } from '../model/types';
import { WorkCalendar, standardCalendar } from './calendar';
import { EPS } from './time';

/** Why a task's early start is where it is. */
export type Driver =
  | { kind: 'link'; predUid: number; type: Link['type'] }
  | { kind: 'projectStart' }
  | { kind: 'constraint' }
  | { kind: 'scenario' }
  | { kind: 'actual' }
  | { kind: 'manual' }
  | { kind: 'rollup' }
  | { kind: 'inactive' };

export interface TaskSchedule {
  uid: number;
  es: Instant;
  ef: Instant;
  ls: Instant;
  lf: Instant;
  /** Working days; null for completed/inactive tasks. */
  totalFloat: number | null;
  critical: boolean;
  /** Duration actually used (working days). */
  duration: number;
  driver: Driver;
  complete: boolean;
  started: boolean;
  /** Set when a hard constraint (MSO/MFO) or pinned manual task overrides the logic. */
  conflict?: { logicStart: Instant; reason: string };
}

export interface ScheduleResult {
  byUid: Map<number, TaskSchedule>;
  projectStart: Instant;
  projectFinish: Instant;
  /** Topological order (children before parents, predecessors before successors). */
  order: number[];
  /** Tasks that could not be ordered (cycle). Empty when validation passed. */
  cyclicUids: number[];
}

interface Edge {
  pred: number;
  succ: number;
  link: Link;
}

export interface Network {
  tasks: Map<number, Task>;
  children: Map<number, number[]>;
  /** Effective links after expanding links into summary tasks. */
  incoming: Map<number, Edge[]>;
  outgoing: Map<number, Edge[]>;
  calendars: Map<number, WorkCalendar>;
  defaultCal: WorkCalendar;
}

export function isComplete(t: Task): boolean {
  return t.percentComplete >= 100 || t.actualFinish !== undefined;
}

export function isStarted(t: Task): boolean {
  return !isComplete(t) && (t.actualStart !== undefined || t.percentComplete > 0);
}

export function buildCalendars(project: Project): { calendars: Map<number, WorkCalendar>; defaultCal: WorkCalendar } {
  const calendars = new Map<number, WorkCalendar>();
  const anchor = Math.floor(project.projectStart);
  for (const c of project.calendars) {
    calendars.set(c.uid, new WorkCalendar(c, project.dayStartHours, project.dayEndHours, anchor));
  }
  let defaultCal = calendars.get(project.defaultCalendarUid);
  if (!defaultCal) {
    defaultCal = new WorkCalendar(standardCalendar(project.defaultCalendarUid), project.dayStartHours, project.dayEndHours, anchor);
    calendars.set(project.defaultCalendarUid, defaultCal);
  }
  return { calendars, defaultCal };
}

export function leafDescendants(uid: number, children: Map<number, number[]>, tasks: Map<number, Task>): number[] {
  const out: number[] = [];
  const stack = [...(children.get(uid) ?? [])];
  while (stack.length) {
    const u = stack.pop()!;
    const kids = children.get(u);
    if (kids && kids.length) stack.push(...kids);
    else if (tasks.get(u)?.active !== false) out.push(u);
  }
  return out;
}

export function buildNetwork(project: Project): Network {
  const tasks = new Map(project.tasks.map((t) => [t.uid, t]));
  const children = new Map<number, number[]>();
  for (const t of project.tasks) {
    if (t.parentUid !== null && tasks.has(t.parentUid)) {
      const list = children.get(t.parentUid) ?? [];
      list.push(t.uid);
      children.set(t.parentUid, list);
    }
  }
  const excluded = new Set((project.excludedLinks ?? []).map((l) => `${l.predUid}>${l.succUid}`));
  const incoming = new Map<number, Edge[]>();
  const outgoing = new Map<number, Edge[]>();
  const add = (e: Edge) => {
    (incoming.get(e.succ) ?? incoming.set(e.succ, []).get(e.succ)!).push(e);
    (outgoing.get(e.pred) ?? outgoing.set(e.pred, []).get(e.pred)!).push(e);
  };
  for (const t of project.tasks) {
    if (!t.active) continue;
    for (const link of t.predecessors) {
      const pred = tasks.get(link.predUid);
      if (!pred || !pred.active || pred.uid === t.uid) continue;
      if (excluded.has(`${link.predUid}>${t.uid}`)) continue;
      const isSummary = (children.get(t.uid)?.length ?? 0) > 0;
      if (isSummary) {
        const leaves = leafDescendants(t.uid, children, tasks);
        const predIsInside = isDescendant(pred.uid, t.uid, tasks);
        if (predIsInside) continue;
        for (const leaf of leaves) add({ pred: pred.uid, succ: leaf, link });
      } else {
        if (isDescendant(t.uid, pred.uid, tasks)) continue; // link from own parent summary
        add({ pred: pred.uid, succ: t.uid, link });
      }
    }
  }
  const { calendars, defaultCal } = buildCalendars(project);
  return { tasks, children, incoming, outgoing, calendars, defaultCal };
}

export function isDescendant(uid: number, ancestorUid: number, tasks: Map<number, Task>): boolean {
  let cur = tasks.get(uid)?.parentUid ?? null;
  let guard = 0;
  while (cur !== null && guard++ < 10_000) {
    if (cur === ancestorUid) return true;
    cur = tasks.get(cur)?.parentUid ?? null;
  }
  return false;
}

function topoOrder(net: Network, project: Project): { order: number[]; cyclic: number[] } {
  const indeg = new Map<number, number>();
  const succs = new Map<number, number[]>();
  const addEdge = (a: number, b: number) => {
    (succs.get(a) ?? succs.set(a, []).get(a)!).push(b);
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
  };
  for (const t of project.tasks) indeg.set(t.uid, indeg.get(t.uid) ?? 0);
  for (const edges of net.incoming.values()) for (const e of edges) addEdge(e.pred, e.succ);
  for (const [parent, kids] of net.children) for (const k of kids) addEdge(k, parent);
  const queue: number[] = [];
  for (const t of project.tasks) if ((indeg.get(t.uid) ?? 0) === 0) queue.push(t.uid);
  const order: number[] = [];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]!;
    order.push(u);
    for (const v of succs.get(u) ?? []) {
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }
  const placed = new Set(order);
  const cyclic = project.tasks.filter((t) => !placed.has(t.uid)).map((t) => t.uid);
  return { order, cyclic };
}

function calFor(net: Network, t: Task): WorkCalendar {
  return (t.calendarUid !== null && net.calendars.get(t.calendarUid)) || net.defaultCal;
}

/** Instant after applying a lag on calendar `cal` from instant `t` with the given result form. */
function shift(cal: WorkCalendar, t: Instant, link: Link, sign: 1 | -1): number {
  if (link.lagUnit === 'ed') return cal.toOrd(t + sign * link.lag);
  return cal.toOrd(t) + sign * link.lag;
}

/**
 * Schedule a project with the Critical Path Method.
 *
 * @param scenario optional delay scenario (never mutates the project)
 * @param original the un-simulated result; required to interpret scenario start delays.
 *                 Computed automatically if omitted.
 */
export function schedule(project: Project, scenario?: Scenario, original?: ScheduleResult): ScheduleResult {
  const net = buildNetwork(project);
  const { order, cyclic } = topoOrder(net, project);
  const items = new Map<number, ScenarioItem>((scenario?.items ?? []).map((i) => [i.uid, i]));
  const base = items.size > 0 ? (original ?? schedule(project)) : undefined;

  const byUid = new Map<number, TaskSchedule>();
  const esOrd = new Map<number, number>();
  const durOf = (t: Task): number => {
    if (t.milestone && t.duration === 0) return 0;
    const extra = items.get(t.uid)?.durationDelta ?? 0;
    return Math.max(0, t.duration + (isComplete(t) ? 0 : extra));
  };

  // ---------- forward pass ----------
  for (const uid of order) {
    const t = net.tasks.get(uid)!;
    const kids = net.children.get(uid);
    if (kids && kids.length) {
      const sched = kids.map((k) => byUid.get(k)).filter((s): s is TaskSchedule => !!s && net.tasks.get(s.uid)!.active);
      const es = sched.length ? Math.min(...sched.map((s) => s.es)) : t.start;
      const ef = sched.length ? Math.max(...sched.map((s) => s.ef)) : t.finish;
      byUid.set(uid, {
        uid, es, ef, ls: es, lf: ef, totalFloat: null, critical: false,
        duration: net.defaultCal.workingDaysBetween(es, ef), driver: { kind: 'rollup' },
        complete: sched.length > 0 && sched.every((s) => s.complete), started: sched.some((s) => s.started || s.complete),
      });
      continue;
    }
    const cal = calFor(net, t);
    const dur = durOf(t);
    const complete = isComplete(t);
    const started = isStarted(t);

    if (!t.active) {
      byUid.set(uid, { uid, es: t.start, ef: t.finish, ls: t.start, lf: t.finish, totalFloat: null, critical: false, duration: t.duration, driver: { kind: 'inactive' }, complete, started });
      continue;
    }
    if (complete) {
      const es = t.actualStart ?? t.start;
      const ef = t.actualFinish ?? t.finish;
      byUid.set(uid, { uid, es, ef, ls: es, lf: ef, totalFloat: null, critical: false, duration: t.duration, driver: { kind: 'actual' }, complete, started });
      esOrd.set(uid, cal.toOrd(es));
      continue;
    }

    // Collect start candidates (ordinal on this task's calendar) + whether they come from a finish.
    let best = cal.toOrd(project.projectStart);
    let bestFromFinish = false;
    let driver: Driver = { kind: 'projectStart' };
    let finishFloor = -Infinity; // for started tasks (FF/SF links)
    const consider = (ord: number, fromFinish: boolean, d: Driver) => {
      if (ord > best + EPS || (Math.abs(ord - best) <= EPS && fromFinish && !bestFromFinish)) {
        best = ord;
        bestFromFinish = fromFinish;
        driver = d;
      }
    };
    for (const e of net.incoming.get(uid) ?? []) {
      const p = byUid.get(e.pred);
      if (!p) continue;
      const d: Driver = { kind: 'link', predUid: e.pred, type: e.link.type };
      switch (e.link.type) {
        case 'FS': consider(shift(cal, p.ef, e.link, 1), true, d); break;
        case 'SS': consider(shift(cal, p.es, e.link, 1), false, d); break;
        case 'FF': {
          const f = shift(cal, p.ef, e.link, 1);
          finishFloor = Math.max(finishFloor, f);
          consider(f - dur, true, d);
          break;
        }
        case 'SF': {
          const f = shift(cal, p.es, e.link, 1);
          finishFloor = Math.max(finishFloor, f);
          consider(f - dur, false, d);
          break;
        }
      }
    }
    const c = t.constraint;
    if (c.date !== undefined) {
      if (c.type === 'SNET') consider(cal.toOrd(c.date), false, { kind: 'constraint' });
      if (c.type === 'FNET') consider(cal.toOrd(c.date) - dur, true, { kind: 'constraint' });
    }
    const item = items.get(uid);
    if (item && item.startDelay > 0 && base && !started) {
      const b = base.byUid.get(uid);
      if (b) consider(cal.toOrd(b.es) + item.startDelay, false, { kind: 'scenario' });
    }

    let start = best;
    let fromFinish = bestFromFinish;
    let conflict: TaskSchedule['conflict'];
    const logicStartInstant = () => (fromFinish && dur === 0 ? cal.fromOrdFinish(best) : cal.fromOrdStart(best));

    if (started) {
      const es = t.actualStart ?? t.start;
      const s = cal.toOrd(es);
      let f = s + dur;
      if (finishFloor > f) f = finishFloor;
      esOrd.set(uid, s);
      byUid.set(uid, { uid, es, ef: dur === 0 && f === s ? es : cal.fromOrdFinish(f), ls: es, lf: es, totalFloat: null, critical: false, duration: f - s, driver: { kind: 'actual' }, complete, started });
      continue;
    }
    const hard = c.date !== undefined && (c.type === 'MSO' || c.type === 'MFO');
    if (hard) {
      const fixed = c.type === 'MSO' ? cal.toOrd(c.date!) : cal.toOrd(c.date!) - dur;
      if (best > fixed + EPS) conflict = { logicStart: logicStartInstant(), reason: `${c.type} constraint` };
      start = fixed;
      fromFinish = c.type === 'MFO';
      driver = { kind: 'constraint' };
    } else if (t.manual && !item) {
      const fixed = cal.toOrd(t.start);
      if (best > fixed + EPS) conflict = { logicStart: logicStartInstant(), reason: 'manually scheduled task' };
      start = fixed;
      fromFinish = false;
      driver = { kind: 'manual' };
    } else if (t.manual && item) {
      // Simulating a manual task: links still do not move it, but its own pinned start moves by the delay.
      start = cal.toOrd(t.start) + item.startDelay;
      fromFinish = false;
      driver = { kind: 'scenario' };
    }

    esOrd.set(uid, start);
    const es = dur === 0 && fromFinish ? cal.fromOrdFinish(start) : cal.fromOrdStart(start);
    const ef = dur === 0 ? es : cal.fromOrdFinish(start + dur);
    byUid.set(uid, { uid, es, ef, ls: es, lf: ef, totalFloat: null, critical: false, duration: dur, driver, complete, started, conflict });
  }

  // Project dates (active, scheduled tasks only)
  let projectFinish = -Infinity;
  let projectStart = Infinity;
  for (const t of project.tasks) {
    if (!t.active || t.summary) continue;
    const s = byUid.get(t.uid);
    if (!s) continue;
    projectFinish = Math.max(projectFinish, s.ef);
    projectStart = Math.min(projectStart, s.es);
  }
  if (!Number.isFinite(projectFinish)) projectFinish = project.projectStart;
  if (!Number.isFinite(projectStart)) projectStart = project.projectStart;

  // ---------- backward pass ----------
  /** Late limits inherited from summary tasks' outgoing links (instants). */
  const finishLimit = new Map<number, Instant>();
  const startLimit = new Map<number, Instant>();
  for (let i = order.length - 1; i >= 0; i--) {
    const uid = order[i]!;
    const t = net.tasks.get(uid)!;
    const s = byUid.get(uid);
    if (!s) continue;
    const kids = net.children.get(uid);
    const isSummary = !!kids && kids.length > 0;
    const cal = isSummary ? net.defaultCal : calFor(net, t);

    let lf = cal.toOrd(projectFinish);
    let lsLim = Infinity;
    for (const e of net.outgoing.get(uid) ?? []) {
      const sc = byUid.get(e.succ);
      if (!sc || sc.complete) continue;
      const st = net.tasks.get(e.succ)!;
      const sCal = calFor(net, st);
      switch (e.link.type) {
        case 'FS': lf = Math.min(lf, cal.toOrd(sCal.fromOrdStart(shift(sCal, sc.ls, e.link, -1)))); break;
        case 'FF': lf = Math.min(lf, cal.toOrd(sCal.fromOrdFinish(shift(sCal, sc.lf, e.link, -1)))); break;
        case 'SS': lsLim = Math.min(lsLim, cal.toOrd(sCal.fromOrdStart(shift(sCal, sc.ls, e.link, -1)))); break;
        case 'SF': lsLim = Math.min(lsLim, cal.toOrd(sCal.fromOrdFinish(shift(sCal, sc.lf, e.link, -1)))); break;
      }
    }
    const parent = t.parentUid;
    if (parent !== null) {
      const pf = finishLimit.get(parent);
      const ps = startLimit.get(parent);
      if (pf !== undefined) lf = Math.min(lf, cal.toOrd(pf));
      if (ps !== undefined) lsLim = Math.min(lsLim, cal.toOrd(ps));
    }

    if (isSummary) {
      finishLimit.set(uid, cal.fromOrdFinish(lf));
      if (Number.isFinite(lsLim)) startLimit.set(uid, cal.fromOrdStart(lsLim));
      continue; // summary late dates rolled up below
    }
    if (!t.active || s.complete) continue;

    const c = t.constraint;
    if (c.date !== undefined) {
      if (c.type === 'FNLT' || c.type === 'MFO') lf = Math.min(lf, cal.toOrd(c.date));
      if (c.type === 'SNLT' || c.type === 'MSO') lsLim = Math.min(lsLim, cal.toOrd(c.date));
    }
    if (t.deadline !== undefined) lf = Math.min(lf, cal.toOrd(t.deadline));

    const dur = s.duration;
    const efOrd = cal.toOrd(s.ef);
    const esO = esOrd.get(uid) ?? cal.toOrd(s.es);
    let ls = Math.min(lf - dur, lsLim);
    lf = ls + dur;
    if (s.started) ls = esO + (lf - efOrd); // remaining work only
    const tf = lf - efOrd;
    s.ls = dur === 0 ? cal.fromOrdFinish(ls) : cal.fromOrdStart(ls);
    s.lf = dur === 0 ? s.ls : cal.fromOrdFinish(lf);
    s.totalFloat = Math.abs(tf) < EPS ? 0 : Math.round(tf * 1e6) / 1e6;
    s.critical = s.totalFloat <= project.criticalSlackLimit + EPS;
  }

  // ---------- summary roll-up of late dates & critical flag ----------
  for (const uid of order) {
    const kids = net.children.get(uid);
    if (!kids || !kids.length) continue;
    const s = byUid.get(uid)!;
    const sched = kids.map((k) => byUid.get(k)!).filter((k) => net.tasks.get(k.uid)!.active);
    if (!sched.length) continue;
    s.ls = Math.min(...sched.map((k) => k.ls));
    s.lf = Math.max(...sched.map((k) => k.lf));
    const floats = sched.map((k) => k.totalFloat).filter((f): f is number => f !== null);
    s.totalFloat = floats.length ? Math.min(...floats) : null;
    s.critical = sched.some((k) => k.critical);
  }

  return { byUid, projectStart, projectFinish, order, cyclicUids: cyclic };
}

/** Working days between two instants on the task's calendar. */
export function workingDelta(project: Project, uid: number, a: Instant, b: Instant, net?: Network): number {
  const n = net ?? buildNetwork(project);
  const t = n.tasks.get(uid);
  const cal = t ? calFor(n, t) : n.defaultCal;
  const d = cal.toOrd(b) - cal.toOrd(a);
  return Math.abs(d) < EPS ? 0 : d;
}
