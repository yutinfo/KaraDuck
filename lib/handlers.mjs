import { timingSafeEqual } from 'node:crypto';
import { bearerToken, verifyToken, signToken, makeRoomId as defaultMakeRoomId } from './tokens.mjs';
import { cleanRoomName, newRoomDoc, encodeRoomDoc, decodeRoomDoc } from './room-doc.mjs';
import { checkAccess, runCommand } from './room-service.mjs';
import { createYouTubeCache } from './yt-cache.mjs';
import { qrSvg } from './qr.mjs';

const validRoomId = id => typeof id === 'string' && /^[A-HJ-NP-Z2-9]{16}$/.test(id);
const json = (status, value, headers = {}) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(value) });
const error = (status, code) => json(status, { error: code });
const methodError = allowed => json(405, { error: 'method_not_allowed' }, { Allow: allowed.join(', ') });

async function parseBody(request) {
  if (typeof request.headers?.['content-type'] !== 'string'
    || !/^application\/json\s*(?:;|$)/i.test(request.headers['content-type'])) {
    return { response: error(415, 'bad_content_type') };
  }
  // The HTTP adapter supplies a lazy promise so authentication precedes streaming.
  const body = await request.body;
  if (typeof body !== 'string') return { response: error(400, 'bad_command') };
  if (Buffer.byteLength(body) > 16 * 1024) return { response: error(413, 'too_large') };
  try { return { value: JSON.parse(body) }; } catch { return { response: error(400, 'bad_command') }; }
}

export function createHandlers({ store, secret, adminKey, mode, dbUrl, origin, referer,
  fetchImpl = fetch, now = Date.now, searchDisabled = false, makeRoomId = defaultMakeRoomId, makeQid }) {
  const cache = createYouTubeCache({ fetchImpl, now });
  const ownerLink = (request, roomId, epoch) => `${origin(request)}/#o=${signToken(secret, { roomId, role: 'o', epoch })}`;
  const protect = (allowed, handle, needsRoom = true) => guarded(async request => {
    const auth = verifyToken(secret, bearerToken(request.headers ?? {}));
    if (!auth) return error(401, 'bad_token');
    if (!allowed.includes(request.method)) return methodError(allowed);
    if (!needsRoom) return handle(request, auth);
    const access = await checkAccess({ store, auth });
    return access.ok ? handle(request, auth, access.doc) : error(access.status, access.error);
  });
  function guarded(handle) {
    return async request => {
      let response;
      try { response = await handle(request); } catch (cause) {
        response = cause.code === 'too_large' ? error(413, 'too_large') : error(502, 'store_failed');
      }
      return request.method === 'HEAD' ? { ...response, body: '' } : response;
    };
  }

  return {
    config: guarded(async request => ['GET', 'HEAD'].includes(request.method)
      ? json(200, { mode, db: dbUrl, origin: origin(request) }) : methodError(['GET', 'HEAD'])),
    room: protect(['GET', 'HEAD'], async (request, auth, doc) => {
      const body = { roomId: auth.roomId, name: doc.name, role: auth.role };
      if (auth.role === 'o') {
        body.guestUrl = `${origin(request)}/remote#g=${signToken(secret, { roomId: auth.roomId, role: 'g', epoch: doc.guestEpoch })}`;
        try { body.qrSvg = qrSvg(body.guestUrl); } catch (cause) {
          if (cause.code !== 'too_long') throw cause;
          body.qrSvg = null;
        }
      }
      return json(200, body);
    }),
    command: protect(['POST'], async (request, auth) => {
      const parsed = await parseBody(request);
      if (parsed.response) return parsed.response;
      const result = await runCommand({ store, auth, cmd: parsed.value, now, makeQid });
      return json(result.status, result.body);
    }, false),
    search: protect(['GET', 'HEAD'], async request => {
      if (searchDisabled) return error(503, 'search_disabled');
      try {
        return json(200, await cache.search(new URL(request.url, 'http://localhost').searchParams.get('q')));
      } catch (cause) {
        if (cause.code === 'missing_query') return error(400, 'missing_query');
        if (cause.code === 'upstream_failed') return error(502, 'upstream_failed');
        throw cause;
      }
    }),
    embeddable: protect(['GET', 'HEAD'], async request => {
      if (searchDisabled) return error(503, 'search_disabled');
      const ids = [...new Set(new URL(request.url, 'http://localhost').searchParams.get('ids')?.split(',') ?? [])];
      if (!ids.length || ids.length > 30 || ids.some(id => !/^[\w-]{11}$/.test(id))) return error(400, 'bad_ids');
      return json(200, await cache.embeddable(ids, referer(request)));
    }),
    admin: guarded(async request => {
      if (!adminKey) return error(503, 'admin_disabled');
      const supplied = Buffer.from(bearerToken(request.headers ?? {}) ?? '');
      const expected = Buffer.from(adminKey);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return error(401, 'bad_admin_key');
      if (request.method !== 'POST') return methodError(['POST']);
      const parsed = await parseBody(request);
      if (parsed.response) return parsed.response;
      const cmd = parsed.value;
      if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return error(400, 'bad_command');
      if (cmd.action === 'create') {
        const name = cleanRoomName(cmd.name);
        if (name === null) return error(400, 'bad_name');
        for (let attempt = 0; attempt < 5; attempt++) {
          const roomId = makeRoomId();
          if (await store.writeQueue(roomId, encodeRoomDoc(newRoomDoc(name)), 'null_etag')) {
            return json(200, { roomId, ownerUrl: ownerLink(request, roomId, 1) });
          }
        }
        return error(503, 'busy');
      }
      if (cmd.action === 'list') {
        const rooms = [];
        for (const roomId of await store.listRooms()) {
          const { text } = await store.readQueue(roomId);
          if (text === null) continue; // Deleted while listing.
          const doc = decodeRoomDoc(text);
          if (!doc) throw new Error('Invalid room document');
          rooms.push({ roomId, name: doc.name, rev: doc.rev, queueLength: doc.queue.length });
        }
        return json(200, { rooms });
      }
      if (!['delete', 'rotateOwner'].includes(cmd.action) || !validRoomId(cmd.roomId)) return error(400, 'bad_command');
      if (cmd.action === 'delete') {
        await store.deleteRoom(cmd.roomId);
        return json(200, { ok: true });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const { text, etag } = await store.readQueue(cmd.roomId);
        if (text === null) return error(404, 'no_room');
        const doc = decodeRoomDoc(text);
        if (!doc) throw new Error('Invalid room document');
        if (doc.ownerEpoch >= 999999999 || !Number.isSafeInteger(doc.rev + 1)) return error(503, 'busy');
        const next = { ...doc, ownerEpoch: doc.ownerEpoch + 1, rev: doc.rev + 1 };
        if (await store.writeQueue(cmd.roomId, encodeRoomDoc(next), etag)) {
          return json(200, { roomId: cmd.roomId, ownerUrl: ownerLink(request, cmd.roomId, next.ownerEpoch) });
        }
      }
      return error(503, 'busy');
    }),
  };
}
