import { describe, expect, it } from 'vitest';
import { applyTaskEdit, formatPredecessors, parsePredecessors } from '../../src/model/edit';
import { schedule } from '../../src/scheduling/engine';
import { formatInstantISO as iso } from '../../src/scheduling/time';
import { at, makeProject, type TaskSpec } from './helpers';

const p = makeProject([
  { uid: 10, dur: 5 },
  { uid: 20, dur: 3, preds: [10] },
  { uid: 30, dur: 2, preds: [{ predUid: 20, type: 'SS', lag: 1 }] },
]);

describe('predecessor text', () => {
  it('parses MS Project notation using task IDs', () => {
    const r = parsePredecessors('1; 2SS+2d, 2FF-1.5ed', p, 30);
    expect('error' in r).toBe(true); // task 2 listed twice
    const ok = parsePredecessors('1FS+2d; 2SS-1', p, 30);
    expect(ok).toEqual({ links: [
      { predUid: 10, type: 'FS', lag: 2, lagUnit: 'wd' },
      { predUid: 20, type: 'SS', lag: -1, lagUnit: 'wd' },
    ] });
  });
  it('rejects unknown IDs, self links and garbage', () => {
    expect(parsePredecessors('99', p, 30)).toMatchObject({ error: expect.stringContaining('99') });
    expect(parsePredecessors('3', p, 30)).toMatchObject({ error: expect.stringContaining('itself') });
    expect(parsePredecessors('banana', p, 30)).toMatchObject({ error: expect.any(String) });
  });
  it('round-trips through formatting', () => {
    expect(formatPredecessors(p.tasks[2]!, p)).toBe('2SS+1d');
    expect(formatPredecessors(p.tasks[1]!, p)).toBe('1');
  });
});

describe('task edits', () => {
  it('a duration change moves only that task’s finish', () => {
    const r = applyTaskEdit(p, 10, { duration: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(iso(r.project.tasks[0]!.finish)).toBe('2027-01-12T17:00:00');
    expect(iso(schedule(r.project).byUid.get(20)!.es)).toBe(iso(schedule(p).byUid.get(20)!.es));
    expect(p.tasks[0]!.duration).toBe(5);
  });
  it('a start edit moves the task and keeps its length', () => {
    const r = applyTaskEdit(p, 10, { start: at(2027, 1, 11) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(iso(r.project.tasks[0]!.start)).toBe('2027-01-11T08:00:00');
    expect(iso(r.project.tasks[0]!.finish)).toBe('2027-01-15T17:00:00');
  });
  it('a finish edit changes the duration to fit', () => {
    const r = applyTaskEdit(p, 10, { finish: { value: at(2027, 1, 12, 0), currentStart: at(2027, 1, 4) } });
    expect(r.ok && r.project.tasks[0]!.duration).toBe(7);
  });
  it('rejects a dependency that creates a cycle', () => {
    const r = applyTaskEdit(p, 10, { predecessors: [{ predUid: 30, type: 'FS', lag: 0, lagUnit: 'wd' }] });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('circular') });
  });
  it('rejects invalid values', () => {
    expect(applyTaskEdit(p, 10, { duration: -1 }).ok).toBe(false);
    expect(applyTaskEdit(p, 10, { name: '  ' }).ok).toBe(false);
    expect(applyTaskEdit(p, 10, { percentComplete: 140 }).ok).toBe(false);
  });
  it('removing a cyclic link clears its exclusion', () => {
    const cyc = makeProject([{ uid: 1, preds: [2] }, { uid: 2, preds: [1] }], { excludedLinks: [{ predUid: 1, succUid: 2 }, { predUid: 2, succUid: 1 }] });
    const r = applyTaskEdit(cyc, 1, { predecessors: [] });
    expect(r.ok && r.project.excludedLinks).toBeUndefined();
  });
});

describe('performance', () => {
  it('schedules a 3,000-task network quickly', () => {
    const specs: TaskSpec[] = [];
    for (let i = 1; i <= 3000; i++) {
      const preds = i > 1 ? [i - 1] : [];
      if (i > 40 && i % 7 === 0) preds.push(i - 37);
      specs.push({ uid: i, dur: (i % 9) + 1, preds });
    }
    const big = makeProject(specs);
    const t0 = performance.now();
    const r = schedule(big);
    const ms = performance.now() - t0;
    expect(r.byUid.size).toBe(3000);
    expect(ms).toBeLessThan(1500);
  });
});
