import type { Project, ReportItem } from '../model/types';
import { schedule } from '../scheduling/engine';
import { detectGoLive } from '../scheduling/impact';
import { cyclicLinks, validateProject } from '../scheduling/validate';
import { ImportError, parseMspdi } from './mspdi';
import { scheduleCheckFor } from './master';

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
  const check = scheduleCheckFor(p, result);
  const { compared, mismatchedUids: mismatched } = check;
  p.importReport.scheduleCheck = check;
  if (mismatched.length) {
    items.push({
      level: 'warning',
      code: 'schedule-check',
      message: `Schedrift's recalculation differs from the file's dates for ${mismatched.length} of ${compared} tasks. Simulations use the recalculated dates; open Project data (top bar) to see which tasks and why.`,
      taskUids: mismatched,
    });
  }
  p.goLiveUid = detectGoLive(p, result);
  return p;
}

export function importMspdi(xml: string, fileName: string): Project {
  return finalizeImport(parseMspdi(xml, fileName));
}
