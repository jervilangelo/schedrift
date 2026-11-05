import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finalizeImport, ImportError, importMspdi, parseMspdi } from '../../src/importer';
import { durationMinutes } from '../../src/importer/mspdi';
import { writeMspdi } from '../../src/importer/mspdiWriter';
import { schedule } from '../../src/scheduling/engine';
import { analyzeImpact } from '../../src/scheduling/impact';
import { formatInstantISO } from '../../src/scheduling/time';
import { at, makeProject } from './helpers';

const sampleXml = readFileSync(resolve(__dirname, '../../public/samples/atlas-erp-rollout.xml'), 'utf8');

describe('MSPDI parsing', () => {
  it('parses ISO-8601 durations', () => {
    expect(durationMinutes('PT8H0M0S')).toBe(480);
    expect(durationMinutes('PT4H30M0S')).toBe(270);
    expect(durationMinutes('-PT16H0M0S')).toBe(-960);
    expect(durationMinutes('P1DT2H')).toBe(1560);
  });

  it('imports the synthetic sample with hierarchy, links, calendars and baselines', () => {
    const p = importMspdi(sampleXml, 'atlas-erp-rollout.xml');
    expect(p.name).toBe('Atlas ERP Rollout');
    expect(p.tasks).toHaveLength(29);
    const uat = p.tasks.find((t) => t.name.startsWith('User acceptance'))!;
    expect(uat.duration).toBe(20);
    expect(uat.parentUid).toBe(16);
    expect(uat.predecessors.map((l) => l.predUid)).toEqual([17, 18]);
    const prep = p.tasks.find((t) => t.uid === 18)!;
    expect(prep.predecessors[0]).toMatchObject({ predUid: 17, type: 'FS', lag: -5, lagUnit: 'wd' });
    expect(p.tasks.find((t) => t.uid === 7)!.predecessors[0]).toMatchObject({ type: 'SS', lag: 5 });
    expect(p.calendars[0]!.exceptions.length).toBe(8);
    expect(p.tasks.filter((t) => t.summary).map((t) => t.uid)).toEqual([1, 5, 10, 16, 22, 27]);
    expect(uat.baselineStart).toBeDefined();
    expect(p.goLiveUid).toBe(26);
  });

  it('engine reproduces every date in the sample (schedule check)', () => {
    const p = importMspdi(sampleXml, 'atlas-erp-rollout.xml');
    expect(p.importReport.scheduleCheck).toMatchObject({ compared: 23, matched: 23 });
    expect(p.importReport.items.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('answers the UAT example: 10 working days of delay on UAT', () => {
    const p = importMspdi(sampleXml, 'atlas-erp-rollout.xml');
    const original = schedule(p);
    expect(formatInstantISO(original.byUid.get(26)!.ef, false)).toBe('2027-03-11');
    const scenario = { items: [{ uid: 19, startDelay: 10, durationDelta: 0 }] };
    const sim = schedule(p, scenario, original);
    const impact = analyzeImpact(p, original, sim, scenario, 26);
    expect(impact.goLive!.variance).toBe(10);
    expect(formatInstantISO(impact.goLive!.simulated, false)).toBe('2027-03-25');
    expect(impact.drivingChain).toEqual([19, 21, 24, 25, 26]);
  });

  it('absorbs a delay on a task with float', () => {
    const p = importMspdi(sampleXml, 'atlas-erp-rollout.xml');
    const original = schedule(p);
    const scenario = { items: [{ uid: 20, startDelay: 10, durationDelta: 0 }] };
    const sim = schedule(p, scenario, original);
    const impact = analyzeImpact(p, original, sim, scenario, 26);
    expect(impact.goLive!.variance).toBe(0);
    expect(impact.summary).toMatch(/absorbs/);
  });

  it('rejects non-MSPDI content', () => {
    expect(() => parseMspdi('<html></html>', 'x.xml')).toThrow(ImportError);
    expect(() => parseMspdi('<Project><Tasks/></Project>', 'x.xml')).toThrow(/no tasks/);
  });

  it('reports cycles and excludes the cyclic links instead of failing', () => {
    const p = makeProject([{ uid: 1, preds: [2] }, { uid: 2, preds: [1] }, { uid: 3 }]);
    const xml = writeMspdi(p);
    const imported = importMspdi(xml, 'cycle.xml');
    expect(imported.excludedLinks?.length).toBe(2);
    expect(imported.importReport.items.some((i) => i.code === 'cycle')).toBe(true);
    expect(() => schedule(imported)).not.toThrow();
  });

  it('reports missing predecessors, invalid dates and duplicate IDs', () => {
    const p = makeProject([{ uid: 1, preds: [42] }, { uid: 2 }]);
    let xml = writeMspdi(p);
    xml = xml.replace('<UID>2</UID>', '<UID>1</UID>').replace(/<Start>2027-01-04T08:00:00<\/Start>/, '<Start>2027-13-40</Start>');
    const imported = finalizeImport(parseMspdi(xml, 'bad.xml'));
    const codes = imported.importReport.items.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['missing-predecessor', 'duplicate-uid', 'invalid-date']));
  });

  it('flags manual tasks and keeps them pinned', () => {
    const p = makeProject([{ uid: 1, dur: 3 }, { uid: 2, dur: 1, preds: [1], manual: true, start: at(2027, 1, 20) }]);
    p.tasks[1]!.finish = at(2027, 1, 20, 17);
    const imported = importMspdi(writeMspdi(p), 'manual.xml');
    expect(imported.importReport.items.some((i) => i.code === 'manual-tasks')).toBe(true);
    expect(formatInstantISO(schedule(imported).byUid.get(2)!.es, false)).toBe('2027-01-20');
  });
});
