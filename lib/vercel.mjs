import { createGoogleAuth } from './google-auth.mjs';
import { createRtdbStore } from './store-rtdb.mjs';
import { createHandlers } from './handlers.mjs';
import { SECURITY_HEADERS } from './security-headers.mjs';

const required = ['FIREBASE_DB_URL', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'ROOM_SECRET', 'ADMIN_KEY'];
// All six entry points share one store, token cache and YouTube cache per instance.
const instances = new WeakMap();
const tooLarge = () => Object.assign(new Error('too_large'), { code: 'too_large' });

function handlersFor(env, fetchImpl) {
  let byFetch = instances.get(env);
  if (!byFetch) instances.set(env, byFetch = new WeakMap());
  if (!byFetch.has(fetchImpl)) {
    const dbUrl = env.FIREBASE_DB_URL.replace(/\/+$/, '');
    const auth = createGoogleAuth({ clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY, fetchImpl });
    const store = createRtdbStore({ dbUrl, auth, fetchImpl });
    const publicOrigin = env.PUBLIC_ORIGIN?.replace(/\/+$/, '');
    const origin = request => publicOrigin || `https://${request.headers.host}`;
    byFetch.set(fetchImpl, createHandlers({ store, secret: env.ROOM_SECRET, adminKey: env.ADMIN_KEY,
      mode: 'cloud', dbUrl, origin, referer: request => `${origin(request)}/`,
      searchDisabled: env.SEARCH_DISABLED === '1', fetchImpl }));
  }
  return byFetch.get(fetchImpl);
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

export function webHandler(name, { env = process.env, fetchImpl = fetch } = {}) {
  return async request => {
    const respond = ({ status, headers = {}, body }) => new Response(request.method === 'HEAD' ? null : body,
      { status, headers: { ...headers, ...SECURITY_HEADERS } });
    const error = (status, code) => respond({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: code }) });
    if (required.some(key => typeof env[key] !== 'string' || !env[key].trim())) return error(503, 'not_configured');
    if (Number(request.headers.get('content-length')) > 16 * 1024) return error(413, 'too_large');
    try {
      const handlers = handlersFor(env, fetchImpl);
      if (!Object.hasOwn(handlers, name)) return error(404, 'not_found');
      const url = new URL(request.url);
      const headers = Object.fromEntries([...request.headers].map(([key, value]) => [key.toLowerCase(), value]));
      headers.host ??= url.host;
      let body;
      const internal = { method: request.method, url: `${url.pathname}${url.search}`, headers,
        get body() { return request.method === 'POST' ? body ??= readBody(request) : ''; } };
      return respond(await handlers[name](internal));
    } catch (cause) {
      return cause.code === 'too_large' ? error(413, 'too_large') : error(502, 'store_failed');
    }
  };
}
