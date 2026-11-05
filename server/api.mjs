// Schedrift local API. Used by the production server (server/index.mjs) and
// mounted into the Vite dev server. Binds to localhost only; rejects requests
// whose Host/Origin is not local (DNS-rebinding / cross-site protection).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { findJava, mpxjAvailable, mpxjClasspath, ROOT } from './java.mjs';

export const DATA_DIR = process.env.SCHEDRIFT_DATA_DIR || join(ROOT, 'data', 'projects');
const MAX_UPLOAD = 200 * 1024 * 1024;
const MAX_PROJECT = 50 * 1024 * 1024;
const CONVERT_TIMEOUT = 120_000;
const MPXJ_EXT = new Set(['.mpp', '.mpt', '.mpx']);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const ID = /^[A-Za-z0-9-]{1,80}$/;

let javaCache;
function java() {
  if (javaCache === undefined) javaCache = findJava();
  return javaCache;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error(`File is larger than ${Math.round(limit / 1048576)} MB.`), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function runJava(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill(), CONVERT_TIMEOUT);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, output: String(e) });
    });
  });
}

function friendlyConvertError(output) {
  if (/password/i.test(output)) return 'The file is password protected. Remove the password in Microsoft Project and try again.';
  if (/Unsupported|Unrecognised|not a valid|Invalid header|No reader/i.test(output)) return 'This file is not a Microsoft Project file MPXJ can read.';
  const line = output.split(/\r?\n/).find((l) => /Exception|Error/.test(l) && !/Log4j/.test(l));
  return line ? `MPXJ could not read the file: ${line.trim()}` : 'MPXJ could not read the file.';
}

/** Converts .mpp/.mpx bytes to MSPDI XML using MPXJ on a temporary copy. */
export async function convertToMspdi(bytes, fileName) {
  const j = java();
  if (!j || !mpxjAvailable()) {
    throw Object.assign(new Error('Reading .mpp files needs the MPXJ runtime. Run "npm run setup" (or start Schedrift with Schedrift.cmd) and try again. MS Project XML (.xml) files work without it.'), { status: 503 });
  }
  const ext = extname(fileName).toLowerCase();
  const dir = await mkdtemp(join(tmpdir(), 'schedrift-'));
  try {
    const input = join(dir, `input${ext}`);
    const output = join(dir, 'output.xml');
    await writeFile(input, bytes);
    const r = await runJava(j.bin, ['-Dlog4j2.loggerContextFactory=org.apache.logging.log4j.simple.SimpleLoggerContextFactory', '-cp', mpxjClasspath(), 'org.mpxj.sample.MpxjConvert', input, output]);
    if (r.code !== 0 || !existsSync(output)) throw Object.assign(new Error(friendlyConvertError(r.output)), { status: 422 });
    return await readFile(output, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function listProjects() {
  if (!existsSync(DATA_DIR)) return [];
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.schedrift.json'));
  const out = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8'));
      out.push({ id: data.project.id, name: data.project.name, sourceFileName: data.project.sourceFileName, savedAt: data.savedAt, scenarioItems: data.scenario?.items?.length ?? 0 });
    } catch {
      /* ignore unreadable files */
    }
  }
  return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

/** Returns true when the request was handled. */
export async function handleApi(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;

  if (!LOCAL_HOST.test(req.headers.host ?? '')) {
    send(res, 403, { error: 'Schedrift only accepts local requests.' });
    return true;
  }
  const origin = req.headers.origin;
  if (origin && !LOCAL_ORIGIN.test(origin)) {
    send(res, 403, { error: 'Cross-origin requests are not allowed.' });
    return true;
  }

  try {
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const j = java();
      send(res, 200, { app: 'schedrift', mpp: !!j && mpxjAvailable(), java: j ? { major: j.major, source: j.source } : null, mpxj: mpxjAvailable() });
      return true;
    }

    if (url.pathname === '/api/import' && req.method === 'POST') {
      const name = url.searchParams.get('name') ?? 'project.mpp';
      const ext = extname(name).toLowerCase();
      const bytes = await readBody(req, MAX_UPLOAD);
      if (!bytes.length) return send(res, 400, { error: 'The file is empty.' }), true;
      if (ext === '.xml') {
        send(res, 200, { fileName: name, xml: bytes.toString('utf8') });
        return true;
      }
      if (!MPXJ_EXT.has(ext)) {
        send(res, 415, { error: `Unsupported file type "${ext || name}". Use .mpp, .mpx or Microsoft Project XML (.xml).` });
        return true;
      }
      const xml = await convertToMspdi(bytes, name);
      send(res, 200, { fileName: name, xml });
      return true;
    }

    if (url.pathname === '/api/projects' && req.method === 'GET') {
      send(res, 200, { projects: await listProjects() });
      return true;
    }

    const m = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!ID.test(id)) return send(res, 400, { error: 'Invalid project id.' }), true;
      const file = join(DATA_DIR, `${id}.schedrift.json`);
      if (req.method === 'GET') {
        if (!existsSync(file)) return send(res, 404, { error: 'Project not found.' }), true;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(await readFile(file));
        return true;
      }
      if (req.method === 'PUT') {
        const body = await readBody(req, MAX_PROJECT);
        let data;
        try {
          data = JSON.parse(body.toString('utf8'));
        } catch {
          return send(res, 400, { error: 'Invalid JSON.' }), true;
        }
        if (data?.format !== 'schedrift-project' || data?.project?.id !== id) return send(res, 400, { error: 'Not a Schedrift project.' }), true;
        await mkdir(DATA_DIR, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, body);
        await rename(tmp, file);
        send(res, 200, { ok: true, savedAt: data.savedAt });
        return true;
      }
      if (req.method === 'DELETE') {
        if (existsSync(file)) await unlink(file);
        send(res, 200, { ok: true });
        return true;
      }
    }
    send(res, 404, { error: 'Not found.' });
  } catch (e) {
    send(res, e.status ?? 500, { error: e.message ?? 'Unexpected error.' });
  }
  return true;
}
