#!/usr/bin/env node
// Schedrift production server: serves the built app (dist/) and the local API on 127.0.0.1.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { handleApi } from './api.mjs';
import { ROOT } from './java.mjs';

const PORT = Number(process.env.SCHEDRIFT_PORT || 5178);
const HOST = '127.0.0.1';
const DIST = join(ROOT, 'dist');
const OPEN = process.argv.includes('--open') && !process.env.SCHEDRIFT_NO_OPEN;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ is missing. Run "npm run build" first (Schedrift.cmd does this automatically).');
  process.exit(1);
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST + sep)) {
    res.writeHead(403).end();
    return;
  }
  let target = file;
  try {
    if (!(await stat(target)).isFile()) target = join(DIST, 'index.html');
  } catch {
    target = join(DIST, 'index.html');
  }
  const body = await readFile(target);
  const immutable = target.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

const server = createServer(async (req, res) => {
  try {
    if (await handleApi(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    await serveStatic(req, res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(e?.message ?? e));
  }
});

server.on('error', async (e) => {
  if (e.code === 'EADDRINUSE') {
    try {
      const r = await fetch(`http://${HOST}:${PORT}/api/status`);
      const s = await r.json();
      if (s.app === 'schedrift') {
        console.log(`Schedrift is already running at http://localhost:${PORT}`);
        if (OPEN) openBrowser(`http://localhost:${PORT}`);
        process.exit(0);
      }
    } catch {
      /* not schedrift */
    }
    console.error(`Port ${PORT} is in use by another program. Set SCHEDRIFT_PORT to a free port.`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Schedrift running at ${url}  (press Ctrl+C to stop)`);
  if (OPEN) openBrowser(url);
});
