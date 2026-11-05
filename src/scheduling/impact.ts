import type { Instant, Project, Scenario, Task } from '../model/types';
import { buildNetwork, type Network, type ScheduleResult, type TaskSchedule } from './engine';
import { EPS, formatDate, formatDays } from './time';

export interface TaskChange {
  uid: number;
  startDelta: number;
  finishDelta: number;
  floatBefore: number | null;
  floatAfter: number | null;
  criticalBefore: boolean;
  criticalAfter: boolean;
}

export interface GoLiveImpact {
  uid: number;
  name: string;
  original: Instant;
  simulated: Instant;
  /** Working days, positive = later. */
  variance: number;
  /** Logic-required date when a hard constraint pins Go-Live. */
  constrainedLogicDate?: Instant;
  floatAfter: number | null;
}

export interface ScenarioTaskOutcome {
  uid: number;
  name: string;
  requested: number;
  finishSlip: number;
  floatBefore: number | null;
  onDrivingChain: boolean;
}

export interface ImpactReport {
  goLive: GoLiveImpact | null;
  changed: TaskChange[];
  becameCritical: number[];
  noLongerCritical: number[];
  /** Go-Live back to the scenario task that drives it (uids, upstream first). */
  drivingChain: number[];
  outcomes: ScenarioTaskOutcome[];
  projectFinishVariance: number;
  conflicts: number[];
  summary: string;
  details: string[];
}

/** Auto-detect the Go-Live task: a "go-live" milestone, else the last milestone, else the last task. */
export function detectGoLive(project: Project, result: ScheduleResult): number | undefined {
  const leaves = project.tasks.filter((t) => t.active && !t.summary);
  // A task named "Go-Live" (milestone or not). With several (one per phase), the next upcoming one.
  const named = leaves.filter((t) => /go[\s-]?live/i.test(t.name));
  const upcoming = named.filter((t) => !result.byUid.get(t.uid)?.complete);
  if (upcoming.length) {
    return upcoming.reduce((a, b) => (result.byUid.get(b.uid)!.ef < result.byUid.get(a.uid)!.ef ? b : a)).uid;
  }
  const pool = named.length ? named : leaves.filter((t) => t.milestone);
  const candidates = pool.length ? pool : leaves;
  let best: Task | undefined;
  for (const t of candidates) {
    const s = result.byUid.get(t.uid);
    const b = best ? result.byUid.get(best.uid) : undefined;
    if (s && (!b || s.ef > b.ef + EPS)) best = t;
  }
  return best?.uid;
}

function delta(net: Network, t: Task | undefined, a: Instant, b: Instant): number {
  const cal = (t && t.calendarUid !== null && net.calendars.get(t.calendarUid)) || net.defaultCal;
  const d = cal.toOrd(b) - cal.toOrd(a);
  return Math.abs(d) < 1e-4 ? 0 : Math.round(d * 1000) / 1000;
}

function nameOf(project: Project, uid: number): string {
  return project.tasks.find((t) => t.uid === uid)?.name ?? `Task ${uid}`;
}

export function analyzeImpact(
  project: Project,
  original: ScheduleResult,
  simulated: ScheduleResult,
  scenario: Scenario,
  goLiveUid: number | undefined,
): ImpactReport {
  const net = buildNetwork(project);
  const changed: TaskChange[] = [];
  const becameCritical: number[] = [];
  const noLongerCritical: number[] = [];
  const conflicts: number[] = [];

  for (const t of project.tasks) {
    const o = original.byUid.get(t.uid);
    const s = simulated.byUid.get(t.uid);
    if (!o || !s) continue;
    if (s.conflict && !t.summary) conflicts.push(t.uid);
    if (t.summary) continue;
    const startDelta = delta(net, t, o.es, s.es);
    const finishDelta = delta(net, t, o.ef, s.ef);
    if (startDelta !== 0 || finishDelta !== 0) {
      changed.push({
        uid: t.uid, startDelta, finishDelta,
        floatBefore: o.totalFloat, floatAfter: s.totalFloat,
        criticalBefore: o.critical, criticalAfter: s.critical,
      });
    }
    if (s.critical && !o.critical) becameCritical.push(t.uid);
    if (!s.critical && o.critical) noLongerCritical.push(t.uid);
  }

  let goLive: GoLiveImpact | null = null;
  const glTask = goLiveUid !== undefined ? net.tasks.get(goLiveUid) : undefined;
  if (glTask) {
    const o = original.byUid.get(glTask.uid)!;
    const s = simulated.byUid.get(glTask.uid)!;
    goLive = {
      uid: glTask.uid, name: glTask.name, original: o.ef, simulated: s.ef,
      variance: delta(net, glTask, o.ef, s.ef), floatAfter: s.totalFloat,
      constrainedLogicDate: s.conflict?.logicStart,
    };
  }

  const scenarioUids = new Set(scenario.items.map((i) => i.uid));
  const drivingChain = goLive && (goLive.variance > 0 || goLive.constrainedLogicDate !== undefined)
    ? traceDrivingChain(net, original, simulated, goLive.uid, scenarioUids)
    : [];
  const chainSet = new Set(drivingChain);

  const outcomes: ScenarioTaskOutcome[] = scenario.items.map((i) => {
    const t = net.tasks.get(i.uid);
    const o = original.byUid.get(i.uid);
    const s = simulated.byUid.get(i.uid);
    return {
      uid: i.uid,
      name: t?.name ?? `Task ${i.uid}`,
      requested: i.startDelay + i.durationDelta,
      finishSlip: o && s ? delta(net, t, o.ef, s.ef) : 0,
      floatBefore: o?.totalFloat ?? null,
      onDrivingChain: chainSet.has(i.uid),
    };
  });

  const projectFinishVariance = delta(net, undefined, original.projectFinish, simulated.projectFinish);
  const { summary, details } = explain(project, goLive, outcomes, drivingChain, changed, becameCritical);

  return { goLive, changed, becameCritical, noLongerCritical, drivingChain, outcomes, projectFinishVariance, conflicts, summary, details };
}

/** Follow driving links upstream from Go-Live through tasks that moved, until a scenario task. */
export function traceDrivingChain(
  net: Network,
  original: ScheduleResult,
  simulated: ScheduleResult,
  fromUid: number,
  scenarioUids: Set<number>,
): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let cur: number | undefined = fromUid;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    const s: TaskSchedule | undefined = simulated.byUid.get(cur);
    if (!s) break;
    const kids = net.children.get(cur);
    if (kids && kids.length) {
      // Summary: descend into the child that finishes last.
      let last: TaskSchedule | undefined;
      for (const k of kids) {
        const ks = simulated.byUid.get(k);
        if (ks && (!last || ks.ef > last.ef)) last = ks;
      }
      cur = last?.uid;
      continue;
    }
    chain.push(cur);
    if (scenarioUids.has(cur)) break;
    const o = original.byUid.get(cur);
    if (o && Math.abs(o.es - s.es) < EPS && Math.abs(o.ef - s.ef) < EPS && s.conflict === undefined) break;
    cur = s.driver.kind === 'link' ? s.driver.predUid : undefined;
  }
  chain.reverse();
  // Only a chain that reaches a scenario task explains the impact.
  return chain.length && scenarioUids.has(chain[0]!) ? chain : [];
}

function explain(
  project: Project,
  goLive: GoLiveImpact | null,
  outcomes: ScenarioTaskOutcome[],
  chain: number[],
  changed: TaskChange[],
  becameCritical: number[],
): { summary: string; details: string[] } {
  const details: string[] = [];
  for (const o of outcomes) {
    const float = o.floatBefore === null ? 'no float information' : `${formatDays(o.floatBefore)} of total float`;
    details.push(`${o.name}: finish moves ${formatDays(o.finishSlip)} (requested ${formatDays(o.requested)}; it had ${float}).`);
  }
  const others = changed.length - outcomes.filter((o) => o.finishSlip !== 0).length;
  if (others > 0) details.push(`${others} downstream ${others === 1 ? 'task moves' : 'tasks move'} as a result.`);
  if (becameCritical.length) details.push(`${becameCritical.length} ${becameCritical.length === 1 ? 'task becomes' : 'tasks become'} critical.`);

  if (!goLive) return { summary: 'No Go-Live milestone selected.', details };
  if (goLive.constrainedLogicDate !== undefined && goLive.variance === 0) {
    return {
      summary: `${goLive.name} is fixed by a constraint on ${formatDate(goLive.original)}, but the dependencies now require ${formatDate(goLive.constrainedLogicDate)}. Total float is ${goLive.floatAfter === null ? 'unknown' : formatDays(goLive.floatAfter)}.`,
      details,
    };
  }
  if (goLive.variance > 0) {
    const path = chain.map((u) => nameOf(project, u)).join(' → ');
    return {
      summary: `${goLive.name} moves ${formatDays(goLive.variance)} later, to ${formatDate(goLive.simulated, { weekday: true })}${path ? `, driven by ${path}` : ''}.`,
      details,
    };
  }
  if (goLive.variance < 0) {
    return { summary: `${goLive.name} moves ${formatDays(-goLive.variance)} earlier, to ${formatDate(goLive.simulated, { weekday: true })}.`, details };
  }
  const absorbed = outcomes.filter((o) => o.finishSlip > 0);
  return {
    summary: absorbed.length
      ? `${goLive.name} is unchanged. The available float absorbs the delay${absorbed.length > 1 ? 's' : ''}.`
      : `${goLive.name} is unchanged.`,
    details,
  };
}
