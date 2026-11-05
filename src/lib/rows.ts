import type { Project, Task } from '../model/types';

export type GanttMode = 'detailed' | 'executive';

export interface Row {
  uid: number;
  task: Task;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

/**
 * Rows shown in the Gantt.
 * Detailed: the full outline, minus collapsed branches.
 * Executive: top-level phases, every milestone (under its phase) and the Go-Live task.
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
    const milestonesUnder = (uid: number): Task[] => {
      const out: Task[] = [];
      const walk = (u: number) => {
        for (const c of children.get(u) ?? []) {
          if ((c.milestone || c.uid === project.goLiveUid) && !c.summary) out.push(c);
          walk(c.uid);
        }
      };
      walk(uid);
      return out;
    };
    for (const top of children.get(null) ?? []) {
      const ms = top.summary ? milestonesUnder(top.uid) : [];
      rows.push({ uid: top.uid, task: top, depth: 0, hasChildren: false, collapsed: false });
      for (const m of ms) rows.push({ uid: m.uid, task: m, depth: 1, hasChildren: false, collapsed: false });
    }
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
