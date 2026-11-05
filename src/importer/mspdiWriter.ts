import type { Project } from '../model/types';
import { formatInstantISO } from '../scheduling/time';

/**
 * Minimal MSPDI writer used to produce synthetic sample files and test fixtures.
 * The output opens in Microsoft Project and in MPXJ.
 */
const LINK_CODE = { FF: 0, FS: 1, SF: 2, SS: 3 } as const;
const CONSTRAINT_CODE = { ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 } as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hours = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}:00`;
const dur = (days: number, minutesPerDay: number) => {
  const minutes = Math.round(days * minutesPerDay);
  return `PT${Math.floor(minutes / 60)}H${minutes % 60}M0S`;
};

export function writeMspdi(project: Project): string {
  const mpd = Math.round((project.dayEndHours - project.dayStartHours - 1) * 60) || 480;
  const out: string[] = [];
  const el = (indent: number, tag: string, value: string | number | undefined) => {
    if (value === undefined) return;
    out.push(`${'  '.repeat(indent)}<${tag}>${typeof value === 'string' ? esc(value) : value}</${tag}>`);
  };
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<Project xmlns="http://schemas.microsoft.com/project">');
  el(1, 'SaveVersion', 14);
  el(1, 'Name', `${project.name}.xml`);
  el(1, 'Title', project.name);
  el(1, 'ScheduleFromStart', 1);
  el(1, 'StartDate', formatInstantISO(project.projectStart));
  if (project.statusDate !== undefined) el(1, 'StatusDate', formatInstantISO(project.statusDate));
  el(1, 'CriticalSlackLimit', project.criticalSlackLimit);
  el(1, 'CalendarUID', project.defaultCalendarUid);
  el(1, 'DefaultStartTime', hours(project.dayStartHours));
  el(1, 'DefaultFinishTime', hours(project.dayEndHours));
  el(1, 'MinutesPerDay', mpd);
  el(1, 'MinutesPerWeek', mpd * 5);
  el(1, 'DaysPerMonth', 20);
  el(1, 'HonorConstraints', 1);

  out.push('  <Calendars>');
  for (const c of project.calendars) {
    out.push('    <Calendar>');
    el(3, 'UID', c.uid);
    el(3, 'Name', c.name);
    el(3, 'IsBaseCalendar', 1);
    el(3, 'BaseCalendarUID', -1);
    out.push('      <WeekDays>');
    c.workWeek.forEach((working, i) => {
      out.push('        <WeekDay>');
      el(5, 'DayType', i + 1);
      el(5, 'DayWorking', working ? 1 : 0);
      if (working) {
        const mid = project.dayStartHours + (project.dayEndHours - project.dayStartHours) / 2;
        out.push('          <WorkingTimes>');
        out.push(`            <WorkingTime><FromTime>${hours(project.dayStartHours)}</FromTime><ToTime>${hours(Math.floor(mid))}</ToTime></WorkingTime>`);
        out.push(`            <WorkingTime><FromTime>${hours(Math.floor(mid) + 1)}</FromTime><ToTime>${hours(project.dayEndHours)}</ToTime></WorkingTime>`);
        out.push('          </WorkingTimes>');
      }
      out.push('        </WeekDay>');
    });
    for (const e of c.exceptions) {
      const d = formatInstantISO(e.day, false);
      out.push(`        <WeekDay><DayType>0</DayType><DayWorking>${e.working ? 1 : 0}</DayWorking><TimePeriod><FromDate>${d}T00:00:00</FromDate><ToDate>${d}T23:59:00</ToDate></TimePeriod></WeekDay>`);
    }
    out.push('      </WeekDays>');
    out.push('    </Calendar>');
  }
  out.push('  </Calendars>');

  out.push('  <Tasks>');
  out.push(`    <Task><UID>0</UID><ID>0</ID><Name>${esc(project.name)}</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>`);
  for (const t of project.tasks) {
    out.push('    <Task>');
    el(3, 'UID', t.uid);
    el(3, 'ID', t.id);
    el(3, 'Name', t.name);
    el(3, 'Active', t.active ? 1 : 0);
    el(3, 'Manual', t.manual ? 1 : 0);
    el(3, 'WBS', t.wbs);
    el(3, 'OutlineNumber', t.wbs);
    el(3, 'OutlineLevel', t.outlineLevel);
    el(3, 'Start', formatInstantISO(t.start));
    el(3, 'Finish', formatInstantISO(t.finish));
    el(3, 'Duration', dur(t.summary ? 0 : t.duration, mpd));
    el(3, 'DurationFormat', 7);
    el(3, 'Milestone', t.milestone ? 1 : 0);
    el(3, 'Summary', t.summary ? 1 : 0);
    el(3, 'PercentComplete', Math.round(t.percentComplete));
    if (t.actualStart !== undefined) el(3, 'ActualStart', formatInstantISO(t.actualStart));
    if (t.actualFinish !== undefined) el(3, 'ActualFinish', formatInstantISO(t.actualFinish));
    el(3, 'ConstraintType', CONSTRAINT_CODE[t.constraint.type]);
    if (t.constraint.date !== undefined) el(3, 'ConstraintDate', formatInstantISO(t.constraint.date));
    if (t.deadline !== undefined) el(3, 'Deadline', formatInstantISO(t.deadline));
    el(3, 'CalendarUID', t.calendarUid ?? -1);
    for (const l of t.predecessors) {
      out.push('      <PredecessorLink>');
      el(4, 'PredecessorUID', l.predUid);
      el(4, 'Type', LINK_CODE[l.type]);
      el(4, 'CrossProject', 0);
      el(4, 'LinkLag', Math.round(l.lag * (l.lagUnit === 'ed' ? 1440 : mpd) * 10));
      el(4, 'LagFormat', l.lagUnit === 'ed' ? 8 : 7);
      out.push('      </PredecessorLink>');
    }
    if (t.baselineStart !== undefined && t.baselineFinish !== undefined) {
      out.push('      <Baseline>');
      el(4, 'Number', 0);
      el(4, 'Start', formatInstantISO(t.baselineStart));
      el(4, 'Finish', formatInstantISO(t.baselineFinish));
      out.push('      </Baseline>');
    }
    out.push('    </Task>');
  }
  out.push('  </Tasks>');
  out.push('</Project>');
  return out.join('\n') + '\n';
}
