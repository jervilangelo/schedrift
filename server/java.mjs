// Locates a Java runtime and the MPXJ jars used to read .mpp files.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const VENDOR = join(ROOT, 'vendor');
export const MPXJ_LIB = join(VENDOR, 'mpxj', 'lib');
export const JRE_DIR = join(VENDOR, 'jre');

const exe = process.platform === 'win32' ? 'java.exe' : 'java';

function javaVersion(bin) {
  try {
    const r = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const text = `${r.stderr ?? ''}${r.stdout ?? ''}`;
    const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
    if (!m) return null;
    const major = Number(m[1]) === 1 ? Number(m[2]) : Number(m[1]);
    return { major, text: text.split(/\r?\n/)[0] };
  } catch {
    return null;
  }
}

/** Returns { bin, major, source } for the first usable Java (11+), or null. */
export function findJava() {
  const candidates = [];
  if (process.env.SCHEDRIFT_JAVA) candidates.push([process.env.SCHEDRIFT_JAVA, 'SCHEDRIFT_JAVA']);
  candidates.push([join(JRE_DIR, 'bin', exe), 'bundled']);
  if (process.env.JAVA_HOME) candidates.push([join(process.env.JAVA_HOME, 'bin', exe), 'JAVA_HOME']);
  candidates.push([exe, 'PATH']);
  for (const [bin, source] of candidates) {
    if (source !== 'PATH' && !existsSync(bin)) continue;
    const v = javaVersion(bin);
    if (v && v.major >= 11) return { bin, major: v.major, source, description: v.text };
  }
  return null;
}

export function mpxjAvailable() {
  return existsSync(join(MPXJ_LIB, 'mpxj.jar'));
}

export function mpxjClasspath() {
  return join(MPXJ_LIB, '*');
}
