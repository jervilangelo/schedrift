import { describe, expect, it } from 'vitest';
import { WorkCalendar, standardCalendar } from '../../src/scheduling/calendar';
import { dayNumber, formatInstantISO, parseInstant, weekdayOf } from '../../src/scheduling/time';
import { at } from './helpers';

const cal = new WorkCalendar(standardCalendar(), 8, 17, dayNumber(2027, 1, 4));
const iso = (t: number) => formatInstantISO(t);

describe('time helpers', () => {
  it('parses MSPDI timestamps as wall-clock instants', () => {
    expect(parseInstant('2027-03-11T08:00:00')).toBeCloseTo(dayNumber(2027, 3, 11) + 8 / 24);
    expect(parseInstant('2027-02-30T08:00:00')).toBeNull();
    expect(parseInstant('garbage')).toBeNull();
  });
  it('knows weekdays', () => {
    expect(weekdayOf(dayNumber(2027, 1, 4))).toBe(1); // Monday
    expect(weekdayOf(dayNumber(2027, 1, 9))).toBe(6); // Saturday
  });
});

describe('WorkCalendar', () => {
  it('end of a working day and start of the next share an ordinal', () => {
    expect(cal.toOrd(at(2027, 1, 8, 17))).toBeCloseTo(cal.toOrd(at(2027, 1, 11, 8)));
  });
  it('skips weekends when adding working days', () => {
    const o = cal.toOrd(at(2027, 1, 4)) + 5; // Mon + 5 wd
    expect(iso(cal.fromOrdStart(o))).toBe('2027-01-11T08:00:00');
    expect(iso(cal.fromOrdFinish(o))).toBe('2027-01-08T17:00:00');
  });
  it('maps weekend instants to the next working morning', () => {
    expect(iso(cal.normalizeStart(at(2027, 1, 9, 12)))).toBe('2027-01-11T08:00:00');
  });
  it('handles half days', () => {
    const o = cal.toOrd(at(2027, 1, 4)) + 0.5;
    expect(iso(cal.fromOrdFinish(o))).toBe('2027-01-04T12:30:00');
  });
  it('honours holiday exceptions and working-Saturday exceptions', () => {
    const c = new WorkCalendar(
      { uid: 2, name: 'Holidays', workWeek: standardCalendar().workWeek, exceptions: [
        { day: dayNumber(2027, 1, 6), working: false },
        { day: dayNumber(2027, 1, 9), working: true },
      ] },
      8, 17, dayNumber(2027, 1, 4),
    );
    // Mon,Tue,(Wed off),Thu,Fri,Sat(working) → 5 wd from Monday ends Saturday
    expect(iso(c.fromOrdFinish(c.toOrd(at(2027, 1, 4)) + 5))).toBe('2027-01-09T17:00:00');
  });
  it('works far from its anchor in both directions', () => {
    const o = cal.toOrd(at(2031, 6, 2));
    expect(iso(cal.fromOrdStart(o))).toBe('2031-06-02T08:00:00');
    const p = cal.toOrd(at(2019, 6, 3));
    expect(iso(cal.fromOrdStart(p))).toBe('2019-06-03T08:00:00');
  });
  it('falls back to a Mon–Fri week when a calendar has no working weekdays', () => {
    const c = new WorkCalendar({ uid: 3, name: 'Empty', workWeek: [false, false, false, false, false, false, false], exceptions: [] });
    expect(c.isWorking(dayNumber(2027, 1, 4))).toBe(true);
  });
});
