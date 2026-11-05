import type { Project, ReportItem } from '../model/types';
import type { WorkCalendar } from '../scheduling/calendar';
import { buildNetwork, schedule } from '../scheduling/engine';
import { detectGoLive } from '../scheduling/impact';
import { dayOf } from '../scheduling/time';
import { cyclicLinks, validateProject } from '../scheduling/validate';
import { ImportError, parseMspdi } from './mspdi';

export { ImportError, parseMspdi };

/**
 * Validate an imported project, exclude links that form cycles (reported),
 * compare the engine's recalculation with the source dates and pick Go-Live.
 */
export function finalizeImport(project: Project): Project {
  const p: Project = { ...project, importReport: { items: [...project.importReport.items] } };
  const items: ReportItem[] = p.importReport.items;

  const cycles = cyclicLinks(p);
  if (cycles.length) {
    p.excludedLinks = cycles;
    const names = (uid: number) => p.tasks.find((t) => t.uid === uid)?.name ?? String(uid);
    items.push({
      level: 'error',
      code: 'cycle',
      message: `Circular dependencies found. These links are excluded from calculation until fixed: ${cycles.map((c) => `${names(c.predUid)} → ${names(c.succUid)}`).join('; ')}.`,
      taskUids: [...new Set(cycles.flatMap((c) => [c.predUid, c.succUid]))],
    });
  }
  for (const v of validateProject(p)) {
    if (v.code === 'cycle') continue; // reported above with the excluded links
    if (items.some((i) => i.code === v.code && i.message === v.message)) continue;
    items.push(v);
  }

  const result = schedule(p);
  const net = buildNetwork(p);
  const mismatched: number[] = [];
  let compared = 0;
  // Same point in *working time* (e.g. Fri 17:00 ≡ Mon 08:00), within ~1 working hour
  // to absorb lunch-break hour mapping. Calendar-day equality also counts as a match.
  const same = (cal: WorkCalendar, a: number, b: number) => dayOf(a) === dayOf(b) || Math.abs(cal.toOrd(a) - cal.toOrd(b)) <= 0.13;
  for (const t of p.tasks) {
    if (t.summary || !t.active || !Number.isFinite(t.start)) continue;
    const s = result.byUid.get(t.uid);
    if (!s) continue;
    compared++;
    const cal = (t.calendarUid !== null && net.calendars.get(t.calendarUid)) || net.defaultCal;
    if (!same(cal, s.es, t.start) || !same(cal, s.ef, t.finish)) mismatched.push(t.uid);
  }
  p.importReport.scheduleCheck = { compared, matched: compared - mismatched.length, mismatchedUids: mismatched };
  if (mismatched.length) {
    items.push({
      level: 'warning',
      code: 'schedule-check',
      message: `Schedrift's recalculation differs from the file's dates for ${mismatched.length} of ${compared} tasks. Simulations use the recalculated dates; see the Data view for details.`,
      taskUids: mismatched,
    });
  }
  p.goLiveUid = detectGoLive(p, result);
  return p;
}

export function importMspdi(xml: string, fileName: string): Project {
  return finalizeImport(parseMspdi(xml, fileName));
}
