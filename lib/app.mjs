import { readFile, realpath } from 'node:fs/promises';
import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { normalizeQuery, searchYouTube, checkEmbeddable } from './youtube.mjs';
import { deserialize, createState } from '../public/js/store.js';
import { applyCommand } from '../public/js/commands.js';
import { qrSvg } from './qr.mjs';

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const json = (status, value) => ({
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(value),
});
const notFound = () => ({ status: 404, headers: { 'Cache-Control': 'no-cache' }, body: 'Not found' });
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PLAYER_STATES = new Set(['playing', 'paused', 'buffering', 'idle']);
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const defaultMakeKey = () => Array.from({ length: 6 }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join('');

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

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createApp({ publicDir, fetchImpl, now = Date.now, dataFile, port = 8791,
  getLanAddress = findLanAddress, makeKey = defaultMakeKey }) {
  const cache = new Map();
  const embedCache = new Map();
  const embedInFlight = new Map();
  const embedJobs = [];
  let embedActive = 0;
  const root = path.resolve(publicDir);
  const listeners = new Set();
  let saved;
  try { if (dataFile) saved = JSON.parse(readFileSync(dataFile, 'utf8')); } catch { /* Start fresh. */ }
  const key = typeof saved?.key === 'string' && saved.key ? saved.key : makeKey();
  let state = saved?.state ? deserialize(JSON.stringify(saved.state)) : createState();
  let rev = Number.isSafeInteger(saved?.state?.rev) && saved.state.rev >= 0 ? saved.state.rev : 0;
  let playerState = state.current && PLAYER_STATES.has(saved?.state?.playerState) ? saved.state.playerState : 'idle';
  let currentSnapshot = freeze({ rev, ...state, playerState });

  function persist() {
    if (!dataFile) return;
    const temporary = `${dataFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      mkdirSync(path.dirname(dataFile), { recursive: true });
      writeFileSync(temporary, JSON.stringify({ key, state: currentSnapshot }), { mode: 0o600 });
      renameSync(temporary, dataFile);
    } catch {
      try { unlinkSync(temporary); } catch { /* Persistence must not break commands. */ }
    }
  }
  persist(); // Also save a newly generated room key before the first command.

  function publish(event, data) {
    const message = freeze({ event, data });
    for (const listener of [...listeners]) {
      try { listener(message); } catch { /* A closed subscriber must not break other clients. */ }
    }
  }

  function update(nextState, nextPlayerState = playerState) {
    if (!nextState.current) nextPlayerState = 'idle';
    if (nextState === state && nextPlayerState === playerState) return;
    state = nextState;
    playerState = nextPlayerState;
    currentSnapshot = freeze({ rev: ++rev, ...state, playerState });
    persist();
    publish('state', currentSnapshot);
  }

  function authorize({ url, remoteAddress = '127.0.0.1' }) {
    const local = LOCAL_ADDRESSES.has(remoteAddress);
    let parsed, pathname;
    try {
      parsed = new URL(url, 'http://localhost');
      pathname = decodeURIComponent(parsed.pathname);
    } catch { return { ok: false, status: 404, error: 'not_found' }; }
    if (!local && ['/api/remote-info', '/api/qr.svg'].includes(pathname)) {
      return { ok: false, status: 403, error: 'local_only' };
    }
    if (!local && pathname.startsWith('/api/') && parsed.searchParams.get('k') !== key) {
      return { ok: false, status: 401, error: 'bad_key' };
    }
    return { ok: true, local };
  }

  const remoteInfo = () => {
    const address = getLanAddress();
    return address ? { available: true, url: `http://${address}:${port}/remote?k=${encodeURIComponent(key)}` }
      : { available: false, url: null };
  };

  function drainEmbedJobs() {
    while (embedActive < 6 && embedJobs.length) {
      const { id, resolve } = embedJobs.shift();
      embedActive++;
      void checkEmbeddable(id, { fetchImpl, referer: `http://localhost:${port}/` }).then(result => {
        if (result !== null) {
          embedCache.set(id, { result, created: now() });
          if (embedCache.size > 2000) embedCache.delete(embedCache.keys().next().value);
        }
        embedInFlight.delete(id);
        embedActive--;
        resolve(result);
        drainEmbedJobs();
      });
    }
  }

  function embeddable(id) {
    const cached = embedCache.get(id);
    if (cached && now() - cached.created < 6 * 60 * 60 * 1000) return Promise.resolve(cached.result);
    embedCache.delete(id);
    if (embedInFlight.has(id)) return embedInFlight.get(id);
    const pending = new Promise(resolve => embedJobs.push({ id, resolve }));
    embedInFlight.set(id, pending);
    drainEmbedJobs();
    return pending;
  }

  function command(headers, body, local) {
    if (Buffer.byteLength(body) > 16 * 1024) return json(413, { error: 'too_large' });
    const contentType = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
    if (typeof contentType !== 'string' || !/^application\/json\s*(?:;|$)/i.test(contentType)) {
      return json(415, { error: 'bad_content_type' });
    }
    let cmd;
    try { cmd = JSON.parse(body); } catch { return json(400, { error: 'bad_command' }); }
    if (!local && ['clearQueue', 'clearHistory', 'report'].includes(cmd?.type)) return json(403, { error: 'local_only' });
    if (cmd?.type === 'control') {
      if (!['toggle', 'restart'].includes(cmd.action)) return json(400, { error: 'bad_command' });
      publish('control', { action: cmd.action });
    } else if (cmd?.type === 'report') {
      if (!PLAYER_STATES.has(cmd.playerState)) return json(400, { error: 'bad_command' });
      update(state, cmd.playerState);
    } else {
      try { update(applyCommand(state, cmd)); } catch (error) {
        if (error.code === 'bad_command') return json(400, { error: 'bad_command' });
        throw error;
      }
    }
    return json(200, { ok: true, rev });
  }

  async function respond({ method, url, headers = {}, body = '', remoteAddress = '127.0.0.1' }) {
    // Inspect the original path before URL can collapse dot segments.
    let pathname;
    let parsed;
    try {
      pathname = decodeURIComponent(url.split(/[?#]/, 1)[0]);
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')
        || pathname.split('/').some(part => part === '..' || part === '.')) return notFound();
      parsed = new URL(url, 'http://localhost');
    } catch {
      return notFound();
    }
    const access = authorize({ url, remoteAddress });
    if (!access.ok) return json(access.status, { error: access.error });
    if (pathname === '/api/command' && method === 'POST') return command(headers, body, access.local);
    if (method !== 'GET' && method !== 'HEAD') {
      return { status: 405, headers: { Allow: pathname === '/api/command' ? 'POST' : 'GET, HEAD' }, body: 'Method not allowed' };
    }
    if (pathname === '/api/command') return { status: 405, headers: { Allow: 'POST' }, body: 'Method not allowed' };
    if (!access.local && (pathname === '/' || pathname === '/index.html')) {
      return { status: 302, headers: { Location: `/remote${parsed.search}` }, body: '' };
    }
    if (pathname === '/api/state') return json(200, currentSnapshot);
    if (pathname === '/api/embeddable') {
      const rawIds = parsed.searchParams.get('ids')?.split(',') ?? [];
      const ids = [...new Set(rawIds)];
      if (!ids.length || ids.length > 30 || ids.some(id => !/^[\w-]{11}$/.test(id))) {
        return json(400, { error: 'bad_ids' });
      }
      const entries = await Promise.all(ids.map(async id => [id, await embeddable(id)]));
      return json(200, Object.fromEntries(entries));
    }
    if (pathname === '/api/remote-info') return json(200, remoteInfo());
    if (pathname === '/api/qr.svg') {
      const info = remoteInfo();
      return info.available ? { status: 200, headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-cache' }, body: qrSvg(info.url) }
        : json(404, { error: 'no_lan' });
    }
    if (pathname === '/api/search') {
      const rawQuery = parsed.searchParams.get('q');
      try {
        const query = normalizeQuery(rawQuery);
        const cached = cache.get(query);
        if (cached && now() - cached.created < 600_000) return json(200, cached.result);
        cache.delete(query);
        const result = await searchYouTube(rawQuery, { fetchImpl });
        cache.set(query, { result, created: now() });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        return json(200, result);
      } catch (error) {
        if (error.code === 'missing_query') return json(400, { error: 'missing_query' });
        if (error.code === 'upstream_failed') return json(502, { error: 'upstream_failed' });
        throw error;
      }
    }
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname === '/remote' ? '/remote.html' : pathname}`);
    if (!inside(root, file)) return notFound();
    try {
      const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(file)]);
      if (!inside(actualRoot, actualFile)) return notFound();
      return {
        status: 200,
        headers: { 'Content-Type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' },
        body: await readFile(actualFile),
      };
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'ELOOP'].includes(error.code)) return notFound();
      throw error;
    }
  }

  return {
    authorize,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => currentSnapshot,
    async handle(request) {
      const response = await respond(request);
      return request.method === 'HEAD' ? { ...response, body: '' } : response;
    },
  };
}
