import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createFileStore } from './lib/store-file.mjs';
import { createHandlers } from './lib/handlers.mjs';
import { newRoomDoc, encodeRoomDoc, decodeRoomDoc } from './lib/room-doc.mjs';
import { makeRoomId, signToken } from './lib/tokens.mjs';
import { SECURITY_HEADERS } from './lib/security-headers.mjs';
import { serveStatic } from './lib/static.mjs';

const json = (status, body, headers = {}) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(body) });
const streamPattern = /^\/local-db\/rooms\/([A-HJ-NP-Z2-9]{16})\.json$/;

// Inspect the original path before URL parsing can collapse traversal segments.
function pathnameOf(url) {
  try {
    const pathname = decodeURIComponent(url.split(/[?#]/, 1)[0]);
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')
      || pathname.split('/').some(part => part === '..' || part === '.')) return null;
    return pathname;
  } catch { return null; }
}

export function findLanAddress(interfaces = networkInterfaces()) {
  const candidates = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const entry of addresses ?? []) {
      if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4)) continue;
      const parts = entry.address.split('.').map(Number);
      if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) continue;
      if (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168)) candidates.push({ name, address: entry.address });
    }
  }
  return (candidates.find(entry => /^(en|wl|eth)/.test(entry.name)) ?? candidates[0])?.address ?? null;
}

function loadSecrets(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'secrets.json');
  try {
    writeFileSync(file, JSON.stringify({ roomSecret: randomBytes(32).toString('base64url'), adminKey: randomBytes(32).toString('base64url') }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof saved.roomSecret !== 'string' || !saved.roomSecret || typeof saved.adminKey !== 'string' || !saved.adminKey) {
    throw new Error('Invalid local secrets');
  }
  chmodSync(file, 0o600);
  return saved;
}

export function createLocalApp({ publicDir = fileURLToPath(new URL('./public/', import.meta.url)),
  dataDir = path.resolve('data'), port = 8791, getLanAddress = findLanAddress, fetchImpl = fetch, now = Date.now } = {}) {
  const { roomSecret, adminKey } = loadSecrets(dataDir);
  const store = createFileStore({ file: path.join(dataDir, 'rooms.json'), now });
  const handlers = createHandlers({ store, secret: roomSecret, adminKey, mode: 'local', dbUrl: '/local-db',
    origin: () => `http://${getLanAddress() || 'localhost'}:${port}`, referer: () => `http://localhost:${port}/`, fetchImpl, now });
  let streams = 0;
  const ready = (async () => {
    let rooms = await store.listRooms();
    if (!rooms.length) {
      const roomId = makeRoomId();
      await store.writeQueue(roomId, encodeRoomDoc(newRoomDoc('บ้าน')), 'null_etag');
      rooms = await store.listRooms();
    }
    const ownerLinks = [];
    for (const roomId of rooms) {
      const doc = decodeRoomDoc((await store.readQueue(roomId)).text);
      if (!doc) throw new Error('Invalid local room');
      ownerLinks.push(`http://localhost:${port}/#o=${signToken(roomSecret, { roomId, role: 'o', epoch: doc.ownerEpoch })}`);
    }
    return { ownerLinks };
  })();

  return {
    ready,
    async handle(request) {
      await ready;
      const pathname = pathnameOf(request.url);
      let response;
      if (pathname === null) response = json(404, { error: 'not_found' });
      else if (pathname.startsWith('/api/')) {
        const name = pathname.slice(5);
        response = Object.hasOwn(handlers, name) ? await handlers[name](request) : json(404, { error: 'not_found' });
      } else if (pathname.startsWith('/local-db/')) response = json(404, { error: 'not_found' });
      else if (!['GET', 'HEAD'].includes(request.method)) response = json(405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
      else response = await serveStatic(publicDir, request.url.split(/[?#]/, 1)[0]) ?? json(404, { error: 'not_found' });
      return { ...response, headers: { ...response.headers, ...SECURITY_HEADERS }, body: request.method === 'HEAD' ? '' : response.body };
    },
    openStream(roomId, send) {
      if (!/^[A-HJ-NP-Z2-9]{16}$/.test(roomId) || streams >= 50) return null;
      streams++;
      let closed = false;
      const unsubscribe = store.subscribe(roomId, send);
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        streams--;
      };
      try { send({ path: '/', data: store.readRoom(roomId) }); } catch (error) { close(); throw error; }
      return close;
    },
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    if (Number(request.headers['content-length']) > 16 * 1024) {
      request.pause();
      reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
      return;
    }
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onError = error => { cleanup(); reject(error); };
    const onAborted = () => onError(new Error('Request aborted'));
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const onData = chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 16 * 1024) {
        cleanup(); request.pause();
        reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
      } else chunks.push(bytes);
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

export function createRequestHandler(app, { startInterval = setInterval, stopInterval = clearInterval } = {}) {
  return async (req, res) => {
    const respond = result => {
      res.writeHead(result.status, { ...result.headers, ...SECURITY_HEADERS, ...(result.status === 413 ? { Connection: 'close' } : {}) });
      res.end(req.method === 'HEAD' ? '' : result.body);
    };
    try {
      await app.ready;
      const pathname = pathnameOf(req.url);
      const match = pathname?.match(streamPattern);
      if (req.method === 'GET' && match) {
        // openStream sends the initial value synchronously. Buffer until accepted.
        let streaming = false;
        const queued = [];
        const send = data => {
          const event = `event: put\ndata: ${JSON.stringify(data)}\n\n`;
          if (streaming) res.write(event); else queued.push(event);
        };
        const close = app.openStream(match[1], send);
        if (!close) { respond(json(503, { error: 'too_many_streams' })); return; }
        let timer;
        const cleanup = () => {
          close();
          if (timer !== undefined) { stopInterval(timer); timer = undefined; }
          res.off('close', cleanup); res.off('error', cleanup);
        };
        res.once('close', cleanup); res.once('error', cleanup);
        try {
          res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          streaming = true;
          for (const event of queued) res.write(event);
          timer = startInterval(() => {
            try { res.write('event: keep-alive\ndata: null\n\n'); } catch { cleanup(); res.destroy(); }
          }, 25_000);
        } catch (error) { cleanup(); throw error; }
        return;
      }
      let body;
      const request = { method: req.method, url: req.url, headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), value])),
        get body() { return req.method === 'POST' ? body ??= readBody(req) : ''; } };
      respond(await app.handle(request));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      respond(error.code === 'too_large' ? json(413, { error: 'too_large' }) : json(500, { error: 'internal' }));
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8791);
  const app = createLocalApp({ dataDir: process.env.DATA_DIR ?? path.resolve('data'), port });
  const { ownerLinks } = await app.ready;
  const server = http.createServer(createRequestHandler(app));
  server.listen(port, process.env.HOST ?? '0.0.0.0', () => {
    for (const link of ownerLinks) console.log(link);
  });
}
