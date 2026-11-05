/**
 * Generates the synthetic demo schedule `samples/atlas-erp-rollout.xml` (MSPDI).
 * All names and dates are fictitious. Dates are produced by the Schedrift engine
 * so the file is internally consistent; a baseline is derived from a slightly
 * more optimistic plan so baseline variance is visible.
 *
 *   npm run sample
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Link, Project, Task } from '../src/model/types';
import { schedule } from '../src/scheduling/engine';
import { dayNumber } from '../src/scheduling/time';
import { writeMspdi } from '../src/importer/mspdiWriter';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type L = number | [number, Link['type'], number?];
interface Row { uid: number; name: string; level: number; dur?: number; ms?: boolean; preds?: L[]; baselineDur?: number }

const rows: Row[] = [
  { uid: 1, name: 'Initiation', level: 1 },
  { uid: 2, name: 'Project kickoff', level: 2, dur: 2 },
  { uid: 3, name: 'Business requirements', level: 2, dur: 12, preds: [2] },
  { uid: 4, name: 'Requirements sign-off', level: 2, ms: true, preds: [3] },
  { uid: 5, name: 'Solution Design', level: 1 },
  { uid: 6, name: 'Functional design', level: 2, dur: 15, preds: [4] },
  { uid: 7, name: 'Technical architecture', level: 2, dur: 10, preds: [[6, 'SS', 5]] },
  { uid: 8, name: 'Integration design', level: 2, dur: 14, preds: [7], baselineDur: 10 },
  { uid: 9, name: 'Design approval', level: 2, ms: true, preds: [6, 8] },
  { uid: 10, name: 'Build', level: 1 },
  { uid: 11, name: 'System configuration', level: 2, dur: 40, preds: [9] },
  { uid: 12, name: 'Data migration scripts', level: 2, dur: 35, preds: [9] },
  { uid: 13, name: 'Integration development', level: 2, dur: 62, preds: [9], baselineDur: 56 },
  { uid: 14, name: 'Reports and forms', level: 2, dur: 25, preds: [[11, 'SS', 10]] },
  { uid: 15, name: 'Build complete', level: 2, ms: true, preds: [11, 12, 13, 14] },
  { uid: 16, name: 'Testing', level: 1 },
  { uid: 17, name: 'System integration testing', level: 2, dur: 20, preds: [15] },
  { uid: 18, name: 'UAT preparation', level: 2, dur: 5, preds: [[17, 'FS', -5]] },
  { uid: 19, name: 'User acceptance testing (UAT)', level: 2, dur: 20, preds: [17, 18] },
  { uid: 20, name: 'Training materials', level: 2, dur: 10, preds: [11] },
  { uid: 21, name: 'UAT sign-off', level: 2, ms: true, preds: [19] },
  { uid: 22, name: 'Deployment', level: 1 },
  { uid: 23, name: 'End-user training', level: 2, dur: 8, preds: [20, [19, 'SS', 5]] },
  { uid: 24, name: 'Cutover rehearsal', level: 2, dur: 5, preds: [21] },
  { uid: 25, name: 'Production migration', level: 2, dur: 3, preds: [24, 12] },
  { uid: 26, name: 'Go-Live', level: 2, ms: true, preds: [25, 23] },
  { uid: 27, name: 'Post Go-Live', level: 1 },
  { uid: 28, name: 'Hypercare support', level: 2, dur: 20, preds: [26] },
  { uid: 29, name: 'Project closure', level: 2, ms: true, preds: [28] },
];

const start = dayNumber(2026, 8, 3) + 8 / 24;
const holidays = [
  dayNumber(2026, 8, 31), dayNumber(2026, 11, 30), dayNumber(2026, 12, 24), dayNumber(2026, 12, 25),
  dayNumber(2026, 12, 31), dayNumber(2027, 1, 1), dayNumber(2027, 4, 1), dayNumber(2027, 4, 2),
];
const status = dayNumber(2026, 11, 5) + 17 / 24;

function build(useBaseline: boolean): Project {
  const parents: number[] = [];
  const tasks: Task[] = rows.map((r, i) => {
    parents.length = r.level - 1;
    const parentUid = r.level > 1 ? parents[r.level - 2]! : null;
    parents[r.level - 1] = r.uid;
    const summary = rows[i + 1]?.level === r.level + 1;
    return {
      uid: r.uid, id: i + 1, wbs: '', name: r.name, outlineLevel: r.level, parentUid, summary,
      milestone: !!r.ms, manual: false, active: true, start, finish: start,
      duration: r.ms ? 0 : useBaseline ? (r.baselineDur ?? r.dur ?? 0) : (r.dur ?? 0),
      calendarUid: null, constraint: { type: 'ASAP' }, percentComplete: 0,
      predecessors: (r.preds ?? []).map((p) => (typeof p === 'number'
        ? { predUid: p, type: 'FS', lag: 0, lagUnit: 'wd' }
        : { predUid: p[0], type: p[1], lag: p[2] ?? 0, lagUnit: 'wd' })),
    };
  });
  // WBS numbers
  const counters: number[] = [];
  for (const t of tasks) {
    counters.length = t.outlineLevel;
    counters[t.outlineLevel - 1] = (counters[t.outlineLevel - 1] ?? 0) + 1;
    t.wbs = counters.map((c) => c ?? 1).join('.');
  }
  return {
    schemaVersion: 1, id: 'sample', name: 'Atlas ERP Rollout', sourceFileName: 'atlas-erp-rollout.xml',
    importedAt: new Date().toISOString(), projectStart: start, statusDate: status, defaultCalendarUid: 1,
    calendars: [{ uid: 1, name: 'Standard', workWeek: [false, true, true, true, true, true, false], exceptions: holidays.map((day) => ({ day, working: false })) }],
    dayStartHours: 8, dayEndHours: 17, criticalSlackLimit: 0, tasks, importReport: { items: [] },
  };
}

const baselinePlan = build(true);
const baseline = schedule(baselinePlan);
const plan = build(false);
const first = schedule(plan);

for (const t of plan.tasks) {
  const s = first.byUid.get(t.uid)!;
  const b = baseline.byUid.get(t.uid)!;
  t.start = s.es;
  t.finish = s.ef;
  t.baselineStart = b.es;
  t.baselineFinish = b.ef;
  if (t.summary) continue;
  if (s.ef <= status) {
    t.percentComplete = 100;
    t.actualStart = s.es;
    t.actualFinish = s.ef;
  } else if (s.es < status) {
    t.actualStart = s.es;
    t.percentComplete = Math.round(((status - s.es) / (s.ef - s.es)) * 100 / 5) * 5;
  }
}
// Summary progress: duration-weighted
for (const t of plan.tasks.filter((x) => x.summary)) {
  const kids = plan.tasks.filter((k) => k.parentUid === t.uid && !k.milestone);
  const total = kids.reduce((s, k) => s + k.duration, 0);
  t.percentComplete = total ? Math.round(kids.reduce((s, k) => s + k.duration * k.percentComplete, 0) / total) : 0;
}

const check = schedule(plan);
const gl = check.byUid.get(26)!;
const out = resolve(root, 'samples/atlas-erp-rollout.xml');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, writeMspdi(plan));
console.log(`Wrote ${out}`);
console.log(`Go-Live: ${new Date(gl.ef * 86400000).toUTCString()}  float=${gl.totalFloat}`);
for (const t of plan.tasks) {
  const s = check.byUid.get(t.uid)!;
  console.log(`${String(t.uid).padStart(3)} ${t.name.padEnd(32)} ${new Date(s.es * 864e5).toISOString().slice(0, 10)} → ${new Date(s.ef * 864e5).toISOString().slice(0, 10)} TF=${s.totalFloat} ${s.critical ? 'CRIT' : ''} ${t.percentComplete}%`);
}
