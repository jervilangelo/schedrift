#!/usr/bin/env node
// Downloads a few synthetic .mpp test files from the MPXJ project's public test
// corpus (https://github.com/joniles/mpxj, LGPL) for integration testing.
// They are not committed to this repository.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/java.mjs';

const COMMIT = 'master';
const FILES = ['mpp14relations.mpp', 'mpp14baseline.mpp', 'mpp14task.mpp', 'mpp14calendar.mpp', 'mpp12relations.mpp', 'mpp9relations.mpp'];
const dir = join(ROOT, 'tests', 'fixtures', 'mpxj');
mkdirSync(dir, { recursive: true });

for (const f of FILES) {
  const dest = join(dir, f);
  if (existsSync(dest)) continue;
  const url = `https://raw.githubusercontent.com/joniles/mpxj/${COMMIT}/junit/data/${f}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`skip ${f}: HTTP ${res.status}`);
    continue;
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${f}`);
}
