import type { Project, Task } from '../model/types';

export type GanttMode = 'detailed' | 'executive';

export interface Row {
  uid: number;
  task: Task;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** Executive view only: a header row for one rollout wave, spanning these top-level tasks. */
  wave?: { label: string; members: number[] };
}

const GO_LIVE = /go[\s-]?live/i;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Splits the top-level outline into rollout waves: a new wave starts when a top-level name
 * repeats one already used in the current wave (e.g. a second "Requirements Gathering").
 */
export function waves(tops: Task[]): Task[][] {
  const out: Task[][] = [];
  let cur: Task[] = [];
  let names = new Set<string>();
  for (const t of tops) {
    const n = norm(t.name);
    if (names.has(n) && cur.length) {
      out.push(cur);
      cur = [];
      names = new Set();
    }
    cur.push(t);
    names.add(n);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Rows shown in the Gantt.
 * Detailed: the full outline, minus collapsed branches.
 * Executive: top-level phases with their key dates (milestones and Go-Live tasks), grouped
 * into rollout waves when the outline repeats itself.
 */
export function visibleRows(project: Project, collapsed: ReadonlySet<number>, mode: GanttMode): Row[] {
  const children = new Map<number | null, Task[]>();
  for (const t of project.tasks) {
    const list = children.get(t.parentUid) ?? [];
    list.push(t);
    children.set(t.parentUid, list);
  }
  const rows: Row[] = [];

  if (mode === 'executive') {
    const keyDatesUnder = (uid: number): Task[] => {
      const out: Task[] = [];
      const walk = (u: number) => {
        for (const c of children.get(u) ?? []) {
          if (!c.summary && (c.milestone || c.uid === project.goLiveUid || GO_LIVE.test(c.name))) out.push(c);
          walk(c.uid);
        }
      };
      walk(uid);
      return out;
    };
    const groups = waves(children.get(null) ?? []);
    groups.forEach((group, w) => {
      if (groups.length > 1) {
        const header = {
          ...group[0]!, uid: -(w + 1), id: -(w + 1), name: `Phase ${w + 1}`, summary: true, milestone: false, predecessors: [], parentUid: null,
        } as Task;
        rows.push({ uid: header.uid, task: header, depth: 0, hasChildren: false, collapsed: false, wave: { label: header.name, members: group.map((t) => t.uid) } });
      }
      for (const top of group) {
        rows.push({ uid: top.uid, task: top, depth: 0, hasChildren: false, collapsed: false });
        if (top.summary) for (const m of keyDatesUnder(top.uid)) rows.push({ uid: m.uid, task: m, depth: 1, hasChildren: false, collapsed: false });
      }
    });
    return rows;
  }

  const walk = (parent: number | null, depth: number) => {
    for (const t of children.get(parent) ?? []) {
      const kids = children.get(t.uid);
      const isCollapsed = collapsed.has(t.uid);
      rows.push({ uid: t.uid, task: t, depth, hasChildren: !!kids?.length, collapsed: isCollapsed });
      if (kids?.length && !isCollapsed) walk(t.uid, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Uids of every summary task (for "collapse all"). */
export function summaryUids(project: Project): number[] {
  return project.tasks.filter((t) => t.summary).map((t) => t.uid);
}

/** Nearest visible ancestor (or self) for a task, used to route links to collapsed rows. */
export function visibleAncestor(project: Project, uid: number, visible: ReadonlySet<number>): number | undefined {
  const byUid = new Map(project.tasks.map((t) => [t.uid, t]));
  let cur: number | null = uid;
  let guard = 0;
  while (cur !== null && guard++ < 1000) {
    if (visible.has(cur)) return cur;
    cur = byUid.get(cur)?.parentUid ?? null;
  }
  return undefined;
}
