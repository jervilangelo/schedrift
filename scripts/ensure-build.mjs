#!/usr/bin/env node
// Builds the app when dist/ is missing or older than any source file.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../server/java.mjs';

const target = join(ROOT, 'dist', 'index.html');
const sources = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json'];

function newest(path) {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.mtimeMs;
  let max = s.mtimeMs;
  for (const e of readdirSync(path)) max = Math.max(max, newest(join(path, e)));
  return max;
}

const built = existsSync(target) ? statSync(target).mtimeMs : 0;
const latest = Math.max(...sources.map((p) => newest(join(ROOT, p))));
if (built >= latest) {
  console.log('[schedrift] Build is up to date.');
  process.exit(0);
}
console.log('[schedrift] Building the app (first run or after an update)…');
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
