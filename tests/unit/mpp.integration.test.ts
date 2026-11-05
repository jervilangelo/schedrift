/**
 * Real .mpp → MPXJ (Java) → MSPDI → Schedrift model → engine.
 * Requires `npm run setup` and `npm run fixtures`; skipped otherwise.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { convertToMspdi } from '../../server/api.mjs';
// @ts-expect-error plain JS module
import { findJava, mpxjAvailable } from '../../server/java.mjs';
import { importMspdi } from '../../src/importer';
import { schedule } from '../../src/scheduling/engine';
import { formatInstantISO } from '../../src/scheduling/time';

const dir = resolve(__dirname, '../fixtures/mpxj');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mpp')) : [];
const ready = !!findJava() && mpxjAvailable() && files.length > 0;

describe.skipIf(!ready)('real .mpp files via MPXJ', () => {
  it.each(files)('%s imports and schedules', async (f) => {
    const xml: string = await convertToMspdi(readFileSync(join(dir, f)), f);
    const p = importMspdi(xml, f);
    expect(p.tasks.length).toBeGreaterThan(0);
    const r = schedule(p);
    expect(r.cyclicUids).toEqual([]);
    for (const t of p.tasks) expect(r.byUid.has(t.uid)).toBe(true);
  }, 60_000);

  it.skipIf(!files.includes('mpp14relations.mpp'))('reads all four link types and matches MS Project dates', async () => {
    const xml: string = await convertToMspdi(readFileSync(join(dir, 'mpp14relations.mpp')), 'mpp14relations.mpp');
    const p = importMspdi(xml, 'mpp14relations.mpp');
    const types = new Set(p.tasks.flatMap((t) => t.predecessors.map((l) => l.type)));
    expect([...types].sort()).toEqual(['FF', 'FS', 'SF', 'SS']);
    const check = p.importReport.scheduleCheck!;
    // Print differences to help diagnose engine divergences from MS Project.
    const r = schedule(p);
    for (const uid of check.mismatchedUids) {
      const t = p.tasks.find((x) => x.uid === uid)!;
      const s = r.byUid.get(uid)!;
      console.log(`${t.name}: file ${formatInstantISO(t.start)}→${formatInstantISO(t.finish)} engine ${formatInstantISO(s.es)}→${formatInstantISO(s.ef)}`);
    }
    expect(check.matched).toBe(check.compared);
  }, 60_000);

  it('rejects a file that is not a project', async () => {
    await expect(convertToMspdi(Buffer.from('not a project file at all'), 'fake.mpp')).rejects.toThrow();
  }, 60_000);
});
