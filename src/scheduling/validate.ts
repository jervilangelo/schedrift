import type { Project, ReportItem } from '../model/types';
import { buildNetwork, leafDescendants } from './engine';

/** Strongly connected components with more than one node (or a self loop) in the scheduling network. */
export function findCycles(project: Project): number[][] {
  const net = buildNetwork({ ...project, excludedLinks: project.excludedLinks });
  const adj = new Map<number, number[]>();
  const push = (a: number, b: number) => (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  for (const edges of net.outgoing.values()) for (const e of edges) push(e.pred, e.succ);
  for (const [parent, kids] of net.children) for (const k of kids) push(k, parent);

  // Iterative Tarjan
  let index = 0;
  const idx = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const out: number[][] = [];
  for (const t of project.tasks) {
    if (idx.has(t.uid)) continue;
    const work: { v: number; i: number }[] = [{ v: t.uid, i: 0 }];
    idx.set(t.uid, index); low.set(t.uid, index); index++; stack.push(t.uid); onStack.add(t.uid);
    while (work.length) {
      const frame = work[work.length - 1]!;
      const succs = adj.get(frame.v) ?? [];
      if (frame.i < succs.length) {
        const w = succs[frame.i++]!;
        if (!idx.has(w)) {
          idx.set(w, index); low.set(w, index); index++; stack.push(w); onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, idx.get(w)!));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1]!.v;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.v)!));
        }
        if (low.get(frame.v) === idx.get(frame.v)) {
          const comp: number[] = [];
          let w: number;
          do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== frame.v);
          if (comp.length > 1) out.push(comp);
        }
      }
    }
  }
  return out;
}

/** Original (user-level) links that participate in a cycle. */
export function cyclicLinks(project: Project): { predUid: number; succUid: number }[] {
  const comps = findCycles(project);
  if (!comps.length) return [];
  const compOf = new Map<number, number>();
  comps.forEach((c, i) => c.forEach((u) => compOf.set(u, i)));
  const net = buildNetwork(project);
  const excluded = new Set((project.excludedLinks ?? []).map((l) => `${l.predUid}>${l.succUid}`));
  const res: { predUid: number; succUid: number }[] = [];
  for (const t of project.tasks) {
    for (const l of t.predecessors) {
      if (excluded.has(`${l.predUid}>${t.uid}`)) continue;
      const c = compOf.get(l.predUid);
      if (c === undefined) continue;
      const targets = (net.children.get(t.uid)?.length ?? 0) > 0 ? [t.uid, ...leafDescendants(t.uid, net.children, net.tasks)] : [t.uid];
      if (targets.some((u) => compOf.get(u) === c)) res.push({ predUid: l.predUid, succUid: t.uid });
    }
  }
  return res;
}

/** Structural checks on a (possibly edited) project. */
export function validateProject(project: Project): ReportItem[] {
  const items: ReportItem[] = [];
  const uids = new Map<number, number>();
  for (const t of project.tasks) uids.set(t.uid, (uids.get(t.uid) ?? 0) + 1);
  const dups = [...uids].filter(([, n]) => n > 1).map(([u]) => u);
  if (dups.length) items.push({ level: 'error', code: 'duplicate-uid', message: `Duplicate unique IDs: ${dups.join(', ')}.`, taskUids: dups });

  for (const t of project.tasks) {
    if (!Number.isFinite(t.start) || !Number.isFinite(t.finish)) {
      items.push({ level: 'error', code: 'invalid-date', message: `"${t.name}" has an invalid start or finish date.`, taskUids: [t.uid] });
    } else if (t.finish + 1e-6 < t.start) {
      items.push({ level: 'error', code: 'finish-before-start', message: `"${t.name}" finishes before it starts.`, taskUids: [t.uid] });
    }
    if (!t.summary && !(t.duration >= 0)) {
      items.push({ level: 'error', code: 'invalid-duration', message: `"${t.name}" has a missing or negative duration.`, taskUids: [t.uid] });
    }
    if (t.constraint.type !== 'ASAP' && t.constraint.type !== 'ALAP' && t.constraint.date === undefined) {
      items.push({ level: 'warning', code: 'constraint-no-date', message: `"${t.name}" has a ${t.constraint.type} constraint without a date; it is treated as As Soon As Possible.`, taskUids: [t.uid] });
    }
    for (const l of t.predecessors) {
      if (l.predUid === t.uid) {
        items.push({ level: 'error', code: 'self-link', message: `"${t.name}" depends on itself.`, taskUids: [t.uid] });
      } else if (!uids.has(l.predUid)) {
        items.push({ level: 'error', code: 'missing-predecessor', message: `"${t.name}" references predecessor UID ${l.predUid}, which does not exist. The link is ignored.`, taskUids: [t.uid] });
      }
    }
  }
  const links = cyclicLinks(project);
  if (links.length) {
    const involved = [...new Set(links.flatMap((l) => [l.predUid, l.succUid]))];
    const names = involved.map((u) => project.tasks.find((t) => t.uid === u)?.name ?? u).join(', ');
    items.push({ level: 'error', code: 'cycle', message: `Circular dependency between: ${names}.`, taskUids: involved });
  }
  return items;
}
