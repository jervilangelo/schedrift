import { describe, expect, it } from 'vitest';
import { brokenLinks, schedule } from '../../src/scheduling/engine';
import { analyzeImpact } from '../../src/scheduling/impact';
import { findCycles, validateProject } from '../../src/scheduling/validate';
import { formatInstantISO as iso } from '../../src/scheduling/time';
import type { Scenario } from '../../src/model/types';
import { at, makeProject } from './helpers';

const dates = (r: ReturnType<typeof schedule>, uid: number) => {
  const s = r.byUid.get(uid)!;
  return [iso(s.es), iso(s.ef)];
};

describe('dependency types', () => {
  it('FS: successor starts the next working morning', () => {
    const r = schedule(makeProject([{ uid: 1, dur: 5 }, { uid: 2, dur: 3, preds: [1] }]));
    expect(dates(r, 1)).toEqual(['2027-01-04T08:00:00', '2027-01-08T17:00:00']);
    expect(dates(r, 2)).toEqual(['2027-01-11T08:00:00', '2027-01-13T17:00:00']);
  });
  it('FS with positive lag and with lead', () => {
    const lag = schedule(makeProject([{ uid: 1, dur: 5 }, { uid: 2, dur: 1, preds: [{ predUid: 1, lag: 2 }] }]));
    expect(dates(lag, 2)[0]).toBe('2027-01-13T08:00:00');
    const lead = schedule(makeProject([{ uid: 1, dur: 5 }, { uid: 2, dur: 1, preds: [{ predUid: 1, lag: -2 }] }]));
    expect(dates(lead, 2)[0]).toBe('2027-01-07T08:00:00');
  });
  it('SS with lag', () => {
    const r = schedule(makeProject([{ uid: 1, dur: 5 }, { uid: 2, dur: 2, preds: [{ predUid: 1, type: 'SS', lag: 2 }] }]));
    expect(dates(r, 2)).toEqual(['2027-01-06T08:00:00', '2027-01-07T17:00:00']);
  });
  it('FF aligns finishes', () => {
    const r = schedule(makeProject([{ uid: 1, dur: 5 }, { uid: 2, dur: 2, preds: [{ predUid: 1, type: 'FF' }] }]));
    expect(dates(r, 2)).toEqual(['2027-01-07T08:00:00', '2027-01-08T17:00:00']);
  });
  it('SF: successor finishes when predecessor starts', () => {
    const r = schedule(makeProject([
      { uid: 1, dur: 2, preds: [{ predUid: 3, type: 'FS', lag: 5 }] },
      { uid: 2, dur: 2, preds: [{ predUid: 1, type: 'SF' }] },
      { uid: 3, dur: 1 },
    ]));
    // T1 starts Tue 12 Jan (T3 Mon 4 + 1wd + 5 lag); T2 must finish when T1 starts
    expect(dates(r, 1)[0]).toBe('2027-01-12T08:00:00');
    expect(dates(r, 2)).toEqual(['2027-01-08T08:00:00', '2027-01-11T17:00:00']);
  });
  it('elapsed-day lag counts calendar days', () => {
    const r = schedule(makeProject([{ uid: 1, dur: 5 }, { uid: 2, dur: 1, preds: [{ predUid: 1, lag: 2, lagUnit: 'ed' }] }]));
    // Fri 17:00 + 2 calendar days = Sun 17:00 → next working morning Mon
    expect(dates(r, 2)[0]).toBe('2027-01-11T08:00:00');
  });
  it('multiple predecessors: the latest one drives', () => {
    const r = schedule(makeProject([{ uid: 1, dur: 2 }, { uid: 2, dur: 6 }, { uid: 3, dur: 1, preds: [1, 2] }]));
    expect(dates(r, 3)[0]).toBe('2027-01-12T08:00:00');
    expect(r.byUid.get(3)!.driver).toMatchObject({ kind: 'link', predUid: 2 });
  });
  it('places a milestone at the end of its predecessor’s finish day', () => {
    const r = schedule(makeProject([{ uid: 1, dur: 5 }, { uid: 2, milestone: true, preds: [1] }, { uid: 3, dur: 1, preds: [2] }]));
    expect(dates(r, 2)).toEqual(['2027-01-08T17:00:00', '2027-01-08T17:00:00']);
    expect(dates(r, 3)[0]).toBe('2027-01-11T08:00:00');
  });
});

describe('critical path & float', () => {
  const p = makeProject([
    { uid: 1, name: 'A', dur: 5 },
    { uid: 2, name: 'B', dur: 2 },
    { uid: 3, name: 'C', dur: 2, preds: [1, 2] },
    { uid: 4, name: 'Go-Live', milestone: true, preds: [3] },
  ]);
  const r = schedule(p);
  it('computes total float', () => {
    expect(r.byUid.get(1)!.totalFloat).toBe(0);
    expect(r.byUid.get(2)!.totalFloat).toBeCloseTo(3);
    expect(r.byUid.get(3)!.totalFloat).toBe(0);
  });
  it('marks zero-float tasks critical only', () => {
    expect([1, 2, 3, 4].map((u) => r.byUid.get(u)!.critical)).toEqual([true, false, true, true]);
  });
  it('late dates of non-critical work', () => {
    expect(iso(r.byUid.get(2)!.ls)).toBe('2027-01-07T08:00:00');
    expect(iso(r.byUid.get(2)!.lf)).toBe('2027-01-08T17:00:00');
  });
});

describe('delay simulation', () => {
  const p = makeProject([
    { uid: 1, name: 'Build', dur: 10 },
    { uid: 2, name: 'Training', dur: 4 },
    { uid: 3, name: 'UAT', dur: 5, preds: [1, 2] },
    { uid: 4, name: 'Prod Migration', dur: 2, preds: [3] },
    { uid: 5, name: 'Go-Live', milestone: true, preds: [4] },
  ]);
  const original = schedule(p);
  const run = (scenario: Scenario) => {
    const sim = schedule(p, scenario, original);
    return { sim, impact: analyzeImpact(p, original, sim, scenario, 5) };
  };

  it('float absorbs a delay smaller than the float', () => {
    const { impact } = run({ items: [{ uid: 2, startDelay: 6, durationDelta: 0 }] });
    expect(original.byUid.get(2)!.totalFloat).toBeCloseTo(6);
    expect(impact.goLive!.variance).toBe(0);
    expect(impact.changed.map((c) => c.uid)).toEqual([2]);
    expect(impact.summary).toMatch(/unchanged/);
    expect(impact.becameCritical).toContain(2);
  });
  it('only the excess beyond float reaches Go-Live', () => {
    const { impact } = run({ items: [{ uid: 2, startDelay: 10, durationDelta: 0 }] });
    expect(impact.goLive!.variance).toBeCloseTo(4);
    expect(impact.drivingChain).toEqual([2, 3, 4, 5]);
    expect(impact.changed.map((c) => c.uid).sort()).toEqual([2, 3, 4, 5]);
    expect(impact.changed.find((c) => c.uid === 1)).toBeUndefined();
  });
  it('a critical task delay moves Go-Live one-for-one', () => {
    const { impact } = run({ items: [{ uid: 3, startDelay: 10, durationDelta: 0 }] });
    expect(impact.goLive!.variance).toBeCloseTo(10);
  });
  it('does not double count overlapping delays on the same path', () => {
    const { impact } = run({ items: [
      { uid: 3, startDelay: 5, durationDelta: 0 },
      { uid: 4, startDelay: 3, durationDelta: 0 },
    ] });
    expect(impact.goLive!.variance).toBeCloseTo(5);
  });
  it('duration extensions do add up along a path', () => {
    const { impact } = run({ items: [
      { uid: 3, startDelay: 0, durationDelta: 5 },
      { uid: 4, startDelay: 0, durationDelta: 3 },
    ] });
    expect(impact.goLive!.variance).toBeCloseTo(8);
  });
  it('never mutates the plan', () => {
    const snapshot = JSON.stringify(p);
    run({ items: [{ uid: 1, startDelay: 3, durationDelta: 2 }] });
    expect(JSON.stringify(p)).toBe(snapshot);
  });
  it('reports a critical-path switch', () => {
    // Training slips past Build's path → Build gains float and is no longer critical
    const { impact } = run({ items: [{ uid: 2, startDelay: 10, durationDelta: 0 }] });
    expect(impact.noLongerCritical).toContain(1);
  });
});

describe('progress and file dates', () => {
  it('keeps completed actual dates fixed', () => {
    const p = makeProject([
      { uid: 1, dur: 5, pct: 100, actualStart: at(2027, 1, 5), actualFinish: at(2027, 1, 12, 17), start: at(2027, 1, 5), finish: at(2027, 1, 12, 17) },
      { uid: 2, dur: 2, preds: [1] },
    ]);
    const orig = schedule(p);
    const sim = schedule(p, { items: [{ uid: 1, startDelay: 5, durationDelta: 5 }] }, orig);
    expect(dates(sim, 1)).toEqual(['2027-01-05T08:00:00', '2027-01-12T17:00:00']);
    expect(dates(sim, 2)[0]).toBe('2027-01-13T08:00:00');
    expect(sim.byUid.get(1)!.critical).toBe(false);
  });
  it('in-progress tasks keep their actual start; duration extension moves the finish', () => {
    const p = makeProject([{ uid: 1, dur: 5, pct: 40, actualStart: at(2027, 1, 4) }, { uid: 2, dur: 1, preds: [1] }]);
    const orig = schedule(p);
    const sim = schedule(p, { items: [{ uid: 1, startDelay: 0, durationDelta: 2 }] }, orig);
    expect(dates(sim, 1)).toEqual(['2027-01-04T08:00:00', '2027-01-12T17:00:00']);
    expect(dates(sim, 2)[0]).toBe('2027-01-13T08:00:00');
  });
  it('uses the start and finish from the file, not the duration or constraints', () => {
    const p = makeProject([
      { uid: 1, dur: 5 },
      { uid: 2, dur: 2, preds: [1], start: at(2027, 1, 20), finish: at(2027, 1, 26, 17), constraint: { type: 'MSO', date: at(2027, 2, 1) } },
    ]);
    const r = schedule(p);
    expect(dates(r, 2)).toEqual(['2027-01-20T08:00:00', '2027-01-26T17:00:00']);
    expect(r.byUid.get(2)!.duration).toBeCloseTo(5);
  });
  it('a gap before a successor absorbs a delay; only the excess pushes it', () => {
    // T2 starts Mon 18 Jan although T1 finishes Fri 8 Jan: a 5-day gap.
    const p = makeProject([{ uid: 1, dur: 5 }, { uid: 2, dur: 2, preds: [1], start: at(2027, 1, 18) }]);
    const orig = schedule(p);
    expect(orig.byUid.get(1)!.totalFloat).toBeCloseTo(5);
    const small = schedule(p, { items: [{ uid: 1, startDelay: 3, durationDelta: 0 }] }, orig);
    expect(dates(small, 2)[0]).toBe('2027-01-18T08:00:00');
    const big = schedule(p, { items: [{ uid: 1, startDelay: 7, durationDelta: 0 }] }, orig);
    expect(dates(big, 2)[0]).toBe('2027-01-20T08:00:00');
    expect(big.byUid.get(2)!.driver).toMatchObject({ kind: 'link', predUid: 1 });
  });
  it('keeps dates that break a link and passes on only further slippage', () => {
    // T2 starts Wed 6 Jan although T1 only finishes Fri 8 Jan: it overlaps by 3 days.
    const p = makeProject([{ uid: 1, dur: 5 }, { uid: 2, dur: 2, preds: [1], start: at(2027, 1, 6) }]);
    const orig = schedule(p);
    expect(dates(orig, 2)[0]).toBe('2027-01-06T08:00:00');
    expect(brokenLinks(p, orig)).toEqual([{ predUid: 1, succUid: 2, days: 3 }]);
    const sim = schedule(p, { items: [{ uid: 1, startDelay: 2, durationDelta: 0 }] }, orig);
    expect(dates(sim, 2)[0]).toBe('2027-01-08T08:00:00');
  });
});

describe('summary tasks', () => {
  const p = makeProject([
    { uid: 1, dur: 3 },
    { uid: 10, name: 'Phase', summary: true, preds: [1] },
    { uid: 11, dur: 2, parent: 10 },
    { uid: 12, dur: 4, parent: 10 },
    { uid: 20, dur: 1, preds: [10] },
  ]);
  const r = schedule(p);
  it('a link into a summary applies to its children', () => {
    expect(dates(r, 11)[0]).toBe('2027-01-07T08:00:00');
    expect(dates(r, 12)[0]).toBe('2027-01-07T08:00:00');
  });
  it('summaries roll up and drive their successors', () => {
    expect(dates(r, 10)).toEqual(['2027-01-07T08:00:00', '2027-01-12T17:00:00']);
    expect(dates(r, 20)[0]).toBe('2027-01-13T08:00:00');
  });
  it('children inherit late limits from the summary’s successors', () => {
    expect(r.byUid.get(12)!.critical).toBe(true);
    expect(r.byUid.get(11)!.totalFloat).toBeCloseTo(2);
    expect(r.byUid.get(10)!.critical).toBe(true);
  });
  it('a link into a summary that its children already overlap only passes on further slippage', () => {
    const m = makeProject([
      { uid: 1, dur: 3, start: at(2027, 1, 11) },
      { uid: 10, name: 'Phase', summary: true, manual: true, preds: [1] },
      { uid: 11, dur: 2, parent: 10, start: at(2027, 1, 4) },
    ]);
    const orig = schedule(m);
    expect(dates(orig, 11)[0]).toBe('2027-01-04T08:00:00');
    expect(brokenLinks(m, orig)).toEqual([{ predUid: 1, succUid: 10, days: 8 }]);
    const sim = schedule(m, { items: [{ uid: 1, startDelay: 2, durationDelta: 0 }] }, orig);
    expect(dates(sim, 11)[0]).toBe('2027-01-06T08:00:00');
  });
});

describe('validation', () => {
  it('detects circular dependencies', () => {
    const p = makeProject([{ uid: 1, preds: [3] }, { uid: 2, preds: [1] }, { uid: 3, preds: [2] }, { uid: 4 }]);
    expect(findCycles(p)[0]!.sort()).toEqual([1, 2, 3]);
    expect(validateProject(p).some((i) => i.code === 'cycle')).toBe(true);
  });
  it('detects cycles through summary tasks', () => {
    const p = makeProject([
      { uid: 1, preds: [10] },
      { uid: 10, summary: true },
      { uid: 11, parent: 10, preds: [1] },
    ]);
    expect(findCycles(p).length).toBe(1);
  });
  it('detects missing predecessors and self links', () => {
    const p = makeProject([{ uid: 1, preds: [99] }, { uid: 2, preds: [2] }]);
    const codes = validateProject(p).map((i) => i.code);
    expect(codes).toContain('missing-predecessor');
    expect(codes).toContain('self-link');
  });
  it('schedules around excluded cyclic links', () => {
    const p = makeProject([{ uid: 1, dur: 2, preds: [2], start: at(2027, 1, 4) }, { uid: 2, dur: 2, preds: [1], start: at(2027, 1, 6) }], {
      excludedLinks: [{ predUid: 2, succUid: 1 }],
    });
    const r = schedule(p);
    expect(r.cyclicUids).toEqual([]);
    expect(dates(r, 2)[0]).toBe('2027-01-06T08:00:00');
  });
});
