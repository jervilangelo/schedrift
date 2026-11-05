#!/usr/bin/env node
// One-time setup: downloads MPXJ (LGPL, reads .mpp files) and, if no Java 11+
// is installed, a portable Eclipse Temurin JRE into ./vendor. No admin rights needed.
// Downloads are pinned and verified with SHA-256.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { findJava, JRE_DIR, MPXJ_LIB, VENDOR, mpxjAvailable } from '../server/java.mjs';

const MPXJ = {
  version: '16.10.0',
  url: 'https://files.pythonhosted.org/packages/b3/c8/f8e5e9a3dcda9f0cc078714f64e8d5f73ba62a45d9b95d5bc41f5c5ee839/mpxj-16.10.0-py3-none-any.whl',
  sha256: '5cc44621b58c9d218afd26f4a4a6baa614b41d207a69f8f4ff16a8f6d6f2e5cd',
};
const JRE = {
  'win32-x64': {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_windows_hotspot_21.0.13_9.zip',
    sha256: '2332c0b4cff6bed722da3567c91d5e47568bcba863fa4945d0a8d6fc76158628',
  },
};

const log = (msg) => console.log(`[setup] ${msg}`);

async function download(url, dest, sha256) {
  log(`Downloading ${url.split('/').pop()} …`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const hash = createHash('sha256').update(readFileSync(dest)).digest('hex');
  if (hash !== sha256) throw new Error(`Checksum mismatch for ${url}\n expected ${sha256}\n got      ${hash}`);
  log('Checksum verified.');
}

function unzip(zip, dir) {
  mkdirSync(dir, { recursive: true });
  const winTar = 'C:\\Windows\\System32\\tar.exe';
  let r;
  if (process.platform === 'win32' && existsSync(winTar)) r = spawnSync(winTar, ['-xf', zip, '-C', dir], { stdio: 'inherit' });
  else if (process.platform === 'win32') r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`], { stdio: 'inherit' });
  else r = spawnSync('unzip', ['-q', '-o', zip, '-d', dir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`Could not extract ${zip}`);
}

async function setupMpxj() {
  if (mpxjAvailable()) return log(`MPXJ present (${MPXJ_LIB}).`);
  const work = join(tmpdir(), `schedrift-mpxj-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const whl = join(work, 'mpxj.zip');
  await download(MPXJ.url, whl, MPXJ.sha256);
  unzip(whl, join(work, 'x'));
  mkdirSync(join(VENDOR, 'mpxj'), { recursive: true });
  cpSync(join(work, 'x', 'mpxj', 'lib'), MPXJ_LIB, { recursive: true });
  rmSync(work, { recursive: true, force: true });
  log(`MPXJ ${MPXJ.version} installed.`);
}

async function setupJava() {
  const java = findJava();
  if (java) return log(`Java ${java.major} found (${java.source}).`);
  const key = `${process.platform}-${process.arch}`;
  const spec = JRE[key];
  if (!spec) {
    throw new Error(`No Java 11+ found. Install a Java runtime (e.g. Eclipse Temurin 21) or set SCHEDRIFT_JAVA. Automatic download is only configured for Windows x64.`);
  }
  const work = join(tmpdir(), `schedrift-jre-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const zip = join(work, 'jre.zip');
  await download(spec.url, zip, spec.sha256);
  unzip(zip, join(work, 'x'));
  const inner = readdirSync(join(work, 'x'))[0];
  rmSync(JRE_DIR, { recursive: true, force: true });
  mkdirSync(VENDOR, { recursive: true });
  try {
    renameSync(join(work, 'x', inner), JRE_DIR);
  } catch {
    cpSync(join(work, 'x', inner), JRE_DIR, { recursive: true });
  }
  rmSync(work, { recursive: true, force: true });
  const check = findJava();
  if (!check) throw new Error('The downloaded Java runtime does not start.');
  log(`Portable Java ${check.major} installed in ${JRE_DIR}.`);
}

try {
  await setupMpxj();
  await setupJava();
  log('Ready. .mpp import is available.');
} catch (e) {
  console.error(`[setup] ${e.message}`);
  console.error('[setup] Schedrift still runs; .xml (MSPDI) files can be imported without Java.');
  process.exit(1);
}
