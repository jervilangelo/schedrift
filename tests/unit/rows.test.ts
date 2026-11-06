import { describe, expect, it } from 'vitest';
import { visibleRows, waves } from '../../src/lib/rows';
import { makeProject } from './helpers';

describe('executive rows', () => {
  const p = makeProject([
    { uid: 1, name: 'Requirements Gathering', summary: true },
    { uid: 2, name: 'Workshop', parent: 1 },
    { uid: 3, name: 'UAT', summary: true },
    { uid: 4, name: 'Go Live All', parent: 3, dur: 1 },
    { uid: 5, name: 'Requirements gathering', summary: true },
    { uid: 6, name: 'Templates', parent: 5 },
  ]);
  it('starts a new wave when a top-level name repeats', () => {
    expect(waves(p.tasks.filter((t) => t.parentUid === null)).map((w) => w.map((t) => t.uid))).toEqual([[1, 3], [5]]);
  });
  it('adds wave headers and shows Go-Live tasks as key dates even when not flagged as milestones', () => {
    const rows = visibleRows(p, new Set(), 'executive');
    expect(rows.map((r) => (r.wave ? r.wave.label : r.uid))).toEqual(['Phase 1', 1, 3, 4, 'Phase 2', 5]);
  });
  it('has no wave headers for a single rollout', () => {
    const single = makeProject([{ uid: 1, name: 'A', summary: true }, { uid: 2, parent: 1 }, { uid: 3, name: 'B' }]);
    expect(visibleRows(single, new Set(), 'executive').some((r) => r.wave)).toBe(false);
  });
});
