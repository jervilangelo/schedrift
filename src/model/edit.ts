import type { Instant, Link, LinkType, Project, Task } from './types';
import { buildNetwork } from '../scheduling/engine';
import { cyclicLinks } from '../scheduling/validate';
import { dayOf } from '../scheduling/time';

export interface TaskPatch {
  name?: string;
  /** New planned start: auto-scheduled tasks get a Start No Earlier Than constraint (as in MS Project). */
  start?: Instant;
  /** New planned finish: the duration is changed to fit. Requires the current calculated start. */
  finish?: { value: Instant; currentStart: Instant };
  duration?: number;
  percentComplete?: number;
  milestone?: boolean;
  predecessors?: Link[];
  constraint?: Task['constraint'];
}

export type EditResult = { ok: true; project: Project } | { ok: false; error: string };

const LINK_RE = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*(ed|d|wd|days?|edays?)?)?$/i;

/** "3FS+2d; 5SS-1d" (MS Project style, using task IDs) → links. */
export function parsePredecessors(text: string, project: Project, selfUid: number): { links: Link[] } | { error: string } {
  const byId = new Map(project.tasks.map((t) => [t.id, t]));
  const links: Link[] = [];
  const parts = text.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = LINK_RE.exec(part);
    if (!m) return { error: `"${part}" is not a valid dependency. Use e.g. 12, 12FS+2d, 7SS-1d or 9FF.` };
    const id = Number(m[1]);
    const pred = byId.get(id);
    if (!pred) return { error: `There is no task with ID ${id}.` };
    if (pred.uid === selfUid) return { error: 'A task cannot depend on itself.' };
    const sign = m[3] === '-' ? -1 : 1;
    const lag = m[4] ? sign * Number(m[4]) : 0;
    const unit = (m[5] ?? 'd').toLowerCase().startsWith('e') ? 'ed' : 'wd';
    if (links.some((l) => l.predUid === pred.uid)) return { error: `Task ${id} is listed twice.` };
    links.push({ predUid: pred.uid, type: ((m[2] ?? 'FS').toUpperCase() as LinkType), lag, lagUnit: unit });
  }
  return { links };
}

export function formatLink(l: Link, project: Project): string {
  const pred = project.tasks.find((t) => t.uid === l.predUid);
  const id = pred ? String(pred.id) : `uid${l.predUid}`;
  const lag = l.lag === 0 ? '' : `${l.lag > 0 ? '+' : '−'}${Math.round(Math.abs(l.lag) * 100) / 100}${l.lagUnit === 'ed' ? 'ed' : 'd'}`;
  const type = l.type === 'FS' && !lag ? '' : l.type;
  return `${id}${type}${lag}`;
}

export function formatPredecessors(t: Task, project: Project): string {
  return t.predecessors.map((l) => formatLink(l, project)).join('; ');
}

/** Applies a patch to one task, validating it. Never mutates the input project. */
export function applyTaskEdit(project: Project, uid: number, patch: TaskPatch): EditResult {
  const idx = project.tasks.findIndex((t) => t.uid === uid);
  if (idx < 0) return { ok: false, error: 'Task not found.' };
  const old = project.tasks[idx]!;
  const t: Task = { ...old, constraint: { ...old.constraint }, predecessors: old.predecessors.map((l) => ({ ...l })) };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, error: 'Task name cannot be empty.' };
    t.name = name;
  }
  if (patch.duration !== undefined) {
    if (t.summary) return { ok: false, error: 'Summary task durations come from their subtasks.' };
    if (!(patch.duration >= 0) || patch.duration > 10_000) return { ok: false, error: 'Duration must be between 0 and 10,000 working days.' };
    t.duration = Math.round(patch.duration * 1000) / 1000;
    if (t.duration > 0 && t.milestone && old.duration === 0) t.milestone = false;
    if (t.duration === 0) t.milestone = true;
  }
  if (patch.start !== undefined) {
    if (!Number.isFinite(patch.start)) return { ok: false, error: 'Invalid start date.' };
    if (t.summary) return { ok: false, error: 'Summary task dates come from their subtasks.' };
    if (t.manual) {
      const shift = patch.start - t.start;
      t.start = patch.start;
      t.finish += shift;
    } else {
      t.constraint = { type: 'SNET', date: patch.start };
    }
  }
  if (patch.finish !== undefined) {
    if (t.summary) return { ok: false, error: 'Summary task dates come from their subtasks.' };
    const net = buildNetwork(project);
    const cal = (t.calendarUid !== null && net.calendars.get(t.calendarUid)) || net.defaultCal;
    const endOfDay = dayOf(patch.finish.value) + project.dayEndHours / 24;
    const d = cal.toOrd(endOfDay) - cal.toOrd(patch.finish.currentStart);
    if (d < 0) return { ok: false, error: 'The finish cannot be before the start.' };
    t.duration = Math.round(d * 1000) / 1000;
  }
  if (patch.percentComplete !== undefined) {
    const pc = Math.round(patch.percentComplete);
    if (!(pc >= 0 && pc <= 100)) return { ok: false, error: 'Percent complete must be between 0 and 100.' };
    t.percentComplete = pc;
    if (pc < 100) t.actualFinish = undefined;
    if (pc === 0) t.actualStart = undefined;
  }
  if (patch.milestone !== undefined) {
    t.milestone = patch.milestone;
    if (patch.milestone && !t.summary) t.duration = 0;
  }
  if (patch.constraint !== undefined) t.constraint = patch.constraint;
  if (patch.predecessors !== undefined) {
    if (t.summary && patch.predecessors.length && project.tasks.some((x) => x.parentUid === uid && patch.predecessors!.some((l) => l.predUid === x.uid))) {
      return { ok: false, error: 'A summary task cannot depend on one of its own subtasks.' };
    }
    const seen = new Set<number>();
    for (const l of patch.predecessors) {
      if (l.predUid === uid) return { ok: false, error: 'A task cannot depend on itself.' };
      if (!project.tasks.some((x) => x.uid === l.predUid)) return { ok: false, error: `Predecessor ${l.predUid} does not exist.` };
      if (seen.has(l.predUid)) return { ok: false, error: 'Each predecessor can be linked only once.' };
      if (!Number.isFinite(l.lag) || Math.abs(l.lag) > 5000) return { ok: false, error: 'Lag must be a number of days.' };
      seen.add(l.predUid);
    }
    t.predecessors = patch.predecessors.map((l) => ({ ...l }));
  }

  const tasks = project.tasks.slice();
  tasks[idx] = t;
  const next: Project = { ...project, tasks };

  // Links that were excluded as cyclic stay excluded only while they still form a cycle;
  // an edit may not introduce a new cycle.
  const before = new Set((project.excludedLinks ?? []).map((l) => `${l.predUid}>${l.succUid}`));
  const cycles = cyclicLinks({ ...next, excludedLinks: [] });
  const fresh = cycles.filter((l) => !before.has(`${l.predUid}>${l.succUid}`));
  if (fresh.length) {
    const nm = (u: number) => project.tasks.find((x) => x.uid === u)?.name ?? String(u);
    return { ok: false, error: `This change creates a circular dependency (${fresh.map((l) => `${nm(l.predUid)} → ${nm(l.succUid)}`).join(', ')}).` };
  }
  next.excludedLinks = cycles.length ? cycles : undefined;
  return { ok: true, project: next };
}

/** Successors of a task (uids that list it as predecessor). */
export function successorsOf(project: Project, uid: number): { task: Task; link: Link }[] {
  const out: { task: Task; link: Link }[] = [];
  for (const t of project.tasks) for (const l of t.predecessors) if (l.predUid === uid) out.push({ task: t, link: l });
  return out;
}

export function phaseOf(project: Project, uid: number): Task | undefined {
  const byUid = new Map(project.tasks.map((t) => [t.uid, t]));
  let cur = byUid.get(uid);
  let guard = 0;
  while (cur && cur.parentUid !== null && guard++ < 1000) {
    const parent = byUid.get(cur.parentUid);
    if (!parent) break;
    cur = parent;
  }
  return cur && cur.uid !== uid ? cur : cur?.summary ? cur : undefined;
}

export type TaskStatus = 'Complete' | 'In progress' | 'Not started';
export function statusOf(t: Task): TaskStatus {
  if (t.percentComplete >= 100 || t.actualFinish !== undefined) return 'Complete';
  if (t.percentComplete > 0 || t.actualStart !== undefined) return 'In progress';
  return 'Not started';
}
