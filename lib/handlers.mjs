import { timingSafeEqual } from 'node:crypto';
import { ROOM_ID_PATTERN, bearerToken, verifyToken, signToken, makeRoomId as defaultMakeRoomId } from './tokens.mjs';
import { cleanRoomName, newRoomDoc, encodeRoomDoc, decodeRoomDoc } from './room-doc.mjs';
import { checkAccess, runCommand, decodeMeta, updateMeta, pinForRoom, issueRoomPin, removeRoomPins } from './room-service.mjs';
import { createYouTubeCache } from './yt-cache.mjs';
import { qrSvg } from './qr.mjs';
import { MAX_ROOMS, CREATES_PER_HOUR, IDLE_MS, SEARCHES_PER_HOUR, JOIN_FAILS_PER_MINUTE, hourOf, minuteOf } from './limits.mjs';
import { json, error, methodError } from './http-response.mjs';

const limits = { maxRooms: MAX_ROOMS, createsPerHour: CREATES_PER_HOUR, idleHours: 24, searchesPerHour: SEARCHES_PER_HOUR };

async function parseBody(request) {
  if (typeof request.headers?.['content-type'] !== 'string'
    || !/^application\/json\s*(?:;|$)/i.test(request.headers['content-type'])) {
    return { response: error(415, 'bad_content_type') };
  }
  if (Number(request.headers?.['content-length']) > 16 * 1024) return { response: error(413, 'too_large') };
  // The HTTP adapter supplies a lazy promise so authentication precedes streaming.
  const body = await request.body;
  if (typeof body !== 'string') return { response: error(400, 'bad_command') };
  if (Buffer.byteLength(body) > 16 * 1024) return { response: error(413, 'too_large') };
  try { return { value: JSON.parse(body) }; } catch { return { response: error(400, 'bad_command') }; }
}

export function createHandlers({ store, secret, adminKey, adminEmails = [], verifyIdToken, firebase = null, mode, dbUrl, origin, referer,
  fetchImpl = fetch, now = Date.now, searchDisabled = false, createDisabled = false, makeRoomId = defaultMakeRoomId, makeQid, makePin }) {
  const cache = createYouTubeCache({ fetchImpl, now });
  let createCache;
  const enabled = meta => meta.createEnabled && !createDisabled;
  async function createEnabled() {
    const at = now();
    if (createCache && at >= createCache.at && at - createCache.at < 30_000) return createCache.value;
    let value = false;
    try { value = enabled(decodeMeta((await store.readMeta()).text)); } catch { /* Fail closed. */ }
    createCache = { at, value };
    return value;
  }
  async function activeRooms() {
    const rooms = [];
    const at = now();
    for (const roomId of await store.listRooms()) {
      const { text } = await store.readQueue(roomId);
      if (text === null) continue;
      const doc = decodeRoomDoc(text);
      if (!doc) throw new Error('Invalid room document');
      if (doc.updatedAt > 0 && at - doc.updatedAt > IDLE_MS) {
        try {
          await store.deleteRoom(roomId);
          await removeRoomPins(store, roomId);
          continue;
        } catch { /* Keep counting a room we could not delete. */ }
      }
      rooms.push({ roomId, name: doc.name, rev: doc.rev, queueLength: doc.queue.length,
        current: doc.current?.title ?? null, createdAt: doc.createdAt, updatedAt: doc.updatedAt });
    }
    return rooms;
  }
  async function createRoom(name) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const roomId = makeRoomId();
      if (await store.writeQueue(roomId, encodeRoomDoc(newRoomDoc(name, now())), 'null_etag')) {
        await issueRoomPin({ store, roomId, makePin });
        return roomId;
      }
    }
    return null;
  }
  async function recordJoinFailure() {
    try {
      await updateMeta(store, meta => {
        const minute = minuteOf(now());
        const fails = meta.join.minute === minute ? meta.join.fails : 0;
        return { next: { ...meta, join: { minute, fails: fails + 1 } } };
      }, 3);
    } catch { /* An accounting failure still returns no_such_pin. */ }
  }
  async function searchBudget(roomId) {
    try {
      const hour = hourOf(now());
      const text = await store.readUsage(roomId);
      const usage = text === null ? null : JSON.parse(text);
      const searches = usage?.hour === hour && Number.isSafeInteger(usage.searches) && usage.searches >= 0 ? usage.searches : 0;
      if (searches >= SEARCHES_PER_HOUR) return false;
      await store.writeUsage(roomId, JSON.stringify({ hour, searches: searches + 1 }));
    } catch { /* Accounting failures must not prevent searches. */ }
    return true;
  }
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
      ? json(200, { mode, db: dbUrl, origin: origin(request), createEnabled: await createEnabled(), firebase }) : methodError(['GET', 'HEAD'])),
    rooms: guarded(async request => {
      if (request.method !== 'POST') return methodError(['POST']);
      const parsed = await parseBody(request);
      if (parsed.response) return parsed.response;
      const name = cleanRoomName(parsed.value?.name);
      if (name === null) return error(400, 'bad_name');
      if (createDisabled) return error(403, 'create_disabled');
      for (let attempt = 0; attempt < 5; attempt++) {
        const { text, etag } = await store.readMeta();
        const meta = decodeMeta(text);
        if (!enabled(meta)) return error(403, 'create_disabled');
        if ((await activeRooms()).length >= MAX_ROOMS) return error(503, 'rooms_full');
        const hour = hourOf(now());
        const creates = meta.hour === hour ? meta.creates : 0;
        if (creates >= CREATES_PER_HOUR) return error(429, 'too_many_rooms');
        if (!await store.writeMeta(JSON.stringify({ ...meta, hour, creates: creates + 1 }), etag)) continue;
        const roomId = await createRoom(name);
        if (!roomId) return error(503, 'busy');
        const ownerToken = signToken(secret, { roomId, role: 'o', epoch: 1 });
        return json(200, { roomId, name, ownerToken, ownerUrl: `${origin(request)}/#o=${ownerToken}` });
      }
      return error(503, 'busy');
    }),
    join: guarded(async request => {
      if (request.method !== 'POST') return methodError(['POST']);
      const parsed = await parseBody(request);
      if (parsed.response) return parsed.response;
      const pin = parsed.value?.pin;
      if (typeof pin !== 'string' || pin.length !== 6 || !/^\d{6}$/.test(pin)) return error(400, 'bad_pin');
      const meta = decodeMeta((await store.readMeta()).text);
      if (meta.join.minute === minuteOf(now()) && meta.join.fails >= JOIN_FAILS_PER_MINUTE) return error(429, 'too_many_attempts');
      const roomId = meta.pins[pin];
      if (roomId !== undefined) {
        const { text } = await store.readQueue(roomId);
        if (text !== null) {
          const doc = decodeRoomDoc(text);
          if (!doc) throw new Error('Invalid room document');
          return json(200, { roomId, name: doc.name, guestToken: signToken(secret, { roomId, role: 'g', epoch: doc.guestEpoch }) });
        }
        await removeRoomPins(store, roomId);
      }
      await recordJoinFailure();
      return error(404, 'no_such_pin');
    }),
    room: protect(['GET', 'HEAD'], async (request, auth, doc) => {
      const body = { roomId: auth.roomId, name: doc.name, role: auth.role };
      if (auth.role === 'o') {
        body.pin = await issueRoomPin({ store, roomId: auth.roomId, makePin });
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
      const result = await runCommand({ store, auth, cmd: parsed.value, now, makeQid, makePin });
      return json(result.status, result.body);
    }, false),
    search: protect(['GET', 'HEAD'], async (request, auth) => {
      if (!await searchBudget(auth.roomId)) return error(429, 'search_budget');
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
      const googleEnabled = adminEmails.length > 0 && typeof verifyIdToken === 'function';
      if (!adminKey && !googleEnabled) return error(503, 'admin_disabled');
      const token = bearerToken(request.headers ?? {});
      const supplied = Buffer.from(token ?? '');
      const expected = Buffer.from(adminKey ?? '');
      const keyMatches = Boolean(adminKey) && supplied.length === expected.length && timingSafeEqual(supplied, expected);
      if (!keyMatches) {
        let claims;
        try { claims = googleEnabled && token ? await verifyIdToken(token) : null; } catch { claims = null; }
        if (!claims) return error(401, 'bad_admin_key');
        if (claims.email_verified !== true || claims.firebase?.sign_in_provider !== 'google.com'
          || typeof claims.email !== 'string' || !adminEmails.includes(claims.email.toLowerCase())) return error(403, 'not_admin');
      }
      if (request.method !== 'POST') return methodError(['POST']);
      const parsed = await parseBody(request);
      if (parsed.response) return parsed.response;
      const cmd = parsed.value;
      if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return error(400, 'bad_command');
      if (cmd.action === 'create') {
        const name = cleanRoomName(cmd.name);
        if (name === null) return error(400, 'bad_name');
        const roomId = await createRoom(name);
        return roomId ? json(200, { roomId, ownerUrl: ownerLink(request, roomId, 1) }) : error(503, 'busy');
      }
      if (cmd.action === 'list') {
        const rooms = await activeRooms();
        const meta = decodeMeta((await store.readMeta()).text);
        return json(200, { createEnabled: enabled(meta), limits, rooms: rooms.map(room => ({ ...room, pin: pinForRoom(meta, room.roomId) })) });
      }
      if (cmd.action === 'setCreate') {
        if (typeof cmd.enabled !== 'boolean') return error(400, 'bad_command');
        const meta = await updateMeta(store, current => {
          const next = { ...current, createEnabled: cmd.enabled };
          return { next, result: next };
        });
        if (!meta) return error(503, 'busy');
        createCache = undefined;
        return json(200, { createEnabled: enabled(meta) });
      }
      if (!['delete', 'rotateOwner'].includes(cmd.action) || typeof cmd.roomId !== 'string' || !ROOM_ID_PATTERN.test(cmd.roomId)) return error(400, 'bad_command');
      if (cmd.action === 'delete') {
        await store.deleteRoom(cmd.roomId);
        await removeRoomPins(store, cmd.roomId);
        return json(200, { ok: true });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const { text, etag } = await store.readQueue(cmd.roomId);
        if (text === null) return error(404, 'no_room');
        const doc = decodeRoomDoc(text);
        if (!doc) throw new Error('Invalid room document');
        if (doc.ownerEpoch >= 999999999 || !Number.isSafeInteger(doc.rev + 1)) return error(503, 'busy');
        const next = { ...doc, ownerEpoch: doc.ownerEpoch + 1, rev: doc.rev + 1, updatedAt: now() };
        if (await store.writeQueue(cmd.roomId, encodeRoomDoc(next), etag)) {
          return json(200, { roomId: cmd.roomId, ownerUrl: ownerLink(request, cmd.roomId, next.ownerEpoch) });
        }
      }
      return error(503, 'busy');
    }),
  };
}
