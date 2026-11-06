import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importMspdi } from '../../src/importer';
import { applyMaster, matchRows, parseLooseDate, parseMaster, similarity, normalizeName } from '../../src/importer/master';
import { readCsv, readXlsx } from '../../src/importer/sheet';
import { schedule } from '../../src/scheduling/engine';
import { dayNumber, formatInstantISO } from '../../src/scheduling/time';
import { atlasMaster, makeXlsx, serial } from './xlsxFixture';
import { makeProject } from './helpers';

const sampleXml = readFileSync(resolve(__dirname, '../../public/samples/atlas-erp-rollout.xml'), 'utf8');
const day = (iso: string) => formatInstantISO(Number(iso), false);
const TODAY = dayNumber(2026, 11, 5);

describe('date parsing', () => {
  it.each([
    ['Thu Jul-02-2026', '2026-07-02'],
    ['02/Jul/26', '2026-07-02'],
    ['2026-07-02', '2026-07-02'],
    ['Jul 2, 2026', '2026-07-02'],
    ['2 July 2026', '2026-07-02'],
    ['7/2/2026', '2026-07-02'],
    ['25/12/2026', '2026-12-25'],
  ])('%s', (text, expected) => {
    expect(formatInstantISO(parseLooseDate(text)!, false)).toBe(expected);
  });
  it('reads Excel serial dates in both date systems', () => {
    expect(formatInstantISO(parseLooseDate(serial(2027, 3, 11))!, false)).toBe('2027-03-11');
    expect(formatInstantISO(parseLooseDate(serial(2027, 3, 11) - 1462, true)!, false)).toBe('2027-03-11');
  });
  it('rejects nonsense', () => {
    expect(parseLooseDate('—')).toBeUndefined();
    expect(parseLooseDate('Feb-30-2027')).toBeUndefined();
    expect(parseLooseDate(null)).toBeUndefined();
  });
});

describe('spreadsheet reading', () => {
  it('reads an .xlsx and finds the header row under a title row', () => {
    const table = parseMaster(readXlsx(makeXlsx(atlasMaster())), 'master.xlsx');
    expect(table.headerRow).toBe(2);
    expect(table.columns).toMatchObject({ name: 'Milestone & Task Breakdown', plannedStart: 'Planned Start', plannedEnd: 'Planned End', status: 'Status', actualStart: 'Actual Start' });
    expect(table.rows).toHaveLength(9);
    expect(table.rows[0]).toMatchObject({ name: 'Functional design', status: 'complete', actualEnd: dayNumber(2026, 9, 11) });
    expect(table.rows[6]!.plannedStart).toBe(dayNumber(2027, 2, 23)); // serial number cell
  });
  it('reads CSV with quoted fields', () => {
    const t = parseMaster(readCsv('Task,Status,Planned Start,Planned End\n"Design, phase A",Completed,2026-07-02,2026-07-03\n'), 'm.csv');
    expect(t.rows[0]).toMatchObject({ name: 'Design, phase A', plannedEnd: dayNumber(2026, 7, 3) });
  });
  it('explains a sheet without date columns', () => {
    expect(() => parseMaster(readCsv('a,b\n1,2\n'), 'x.csv')).toThrow(/Planned Start/);
  });
});

describe('matching', () => {
  it('normalizes outline numbers and punctuation; tolerates small typos', () => {
    expect(normalizeName('4 UAT')).toBe('uat');
    expect(normalizeName('Cutover Preparation & Go Live')).toBe('cutover preparation and go live');
    expect(similarity(normalizeName('Business Blueprint Sign-Off'), normalizeName('Business Bluepring Sign-off'))).toBeGreaterThan(0.86);
  });
  it('matches repeated names to the right phase by order', () => {
    const p = makeProject([
      { uid: 1, name: 'UAT Sign-off' }, { uid: 2, name: 'Go-Live' },
      { uid: 3, name: 'UAT Sign-off' }, { uid: 4, name: 'Go-Live' },
    ]);
    const rows = ['UAT Sign-off', 'Go-Live', 'UAT Sign-off', 'Go-Live'].map((name, i) => ({ row: i + 2, name }));
    expect(matchRows(p, rows).matched.map((m) => m.uid)).toEqual([1, 2, 3, 4]);
  });
});

describe('applying the master', () => {
  const project = importMspdi(sampleXml, 'atlas.mpp');
  const table = parseMaster(readXlsx(makeXlsx(atlasMaster())), 'master.xlsx');
  const update = applyMaster(project, table, TODAY);
  const t = (uid: number) => update.project.tasks.find((x) => x.uid === uid)!;
  const r = schedule(update.project);

  it('keeps every dependency of the project file', () => {
    expect(update.project.tasks.map((x) => x.predecessors)).toEqual(project.tasks.map((x) => x.predecessors));
  });
  it('takes durations and starts from Excel', () => {
    expect(t(19).duration).toBe(15);
    expect(t(19).constraint).toMatchObject({ type: 'SNET' });
    expect(day(String(r.byUid.get(24)!.es))).toBe('2027-02-23');
  });
  it('moves Go-Live to the Excel date when the logic allows it', () => {
    expect(update.goLive?.uid).toBe(26);
    expect(formatInstantISO(update.goLive!.finish, false)).toBe('2027-03-04');
  });
  it('keeps the Excel dates exactly, even where a dependency would not allow them', () => {
    expect(formatInstantISO(t(20).start, false)).toBe('2026-11-02');
    expect(update.differences).toEqual([]);
  });
  it('lists rows only in Excel and similar-name matches', () => {
    expect(update.excelOnly.map((x) => x.name)).toEqual(['Core HR']);
    expect(update.matched.find((m) => m.uid === 19)?.how).toBe('similar');
  });
  it('records actual dates for completed rows', () => {
    expect(t(6)).toMatchObject({ percentComplete: 100 });
    expect(formatInstantISO(t(6).actualFinish!, false)).toBe('2026-09-11');
  });
  it('updates the schedule check against the Excel dates', () => {
    expect(update.project.importReport.scheduleCheck?.mismatchedUids).toEqual([]);
  });
  it('never mutates the original project', () => {
    expect(project.tasks.find((x) => x.uid === 19)!.duration).toBe(20);
  });
});
