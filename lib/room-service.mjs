import { randomInt, randomUUID } from 'node:crypto';
import { decodeRoomDoc, encodeRoomDoc } from './room-doc.mjs';
import { applyCommand } from '../public/js/commands.js';

const failure = (status, error) => ({ status, body: { error } });
const ownerCommands = new Set(['clearQueue', 'clearHistory', 'report', 'rotateGuest', 'closeRoom']);

export function decodeMeta(text) {
  const meta = text === null ? { createEnabled: true, hour: 0, creates: 0 } : JSON.parse(text);
  if (!meta || typeof meta.createEnabled !== 'boolean' || !Number.isSafeInteger(meta.hour) || meta.hour < 0
    || !Number.isSafeInteger(meta.creates) || meta.creates < 0) throw new Error('Invalid meta');
  const pins = meta.pins ?? {};
  const join = meta.join ?? { minute: 0, fails: 0 };
  if (typeof pins !== 'object' || Array.isArray(pins)
    || Object.entries(pins).some(([pin, id]) => !/^\d{6}$/.test(pin) || pin.length !== 6 || typeof id !== 'string')
    || !Number.isSafeInteger(join.minute) || join.minute < 0
    || !Number.isSafeInteger(join.fails) || join.fails < 0) throw new Error('Invalid meta');
  return { ...meta, pins, join };
}

export const pinForRoom = (meta, roomId) => Object.keys(meta.pins).find(pin => meta.pins[pin] === roomId) ?? null;
const defaultMakePin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// Recompute from fresh metadata after a conflict; callers choose failure policy.
export async function updateMeta(store, edit, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { text, etag } = await store.readMeta();
    const { next, result } = edit(decodeMeta(text));
    if (next === undefined || await store.writeMeta(JSON.stringify(next), etag)) return result;
  }
  return null;
}

// A replacement excludes every existing PIN, including the room's previous one.
export async function issueRoomPin({ store, roomId, makePin = defaultMakePin, replace = false }) {
  try {
    return await updateMeta(store, meta => {
      const existing = pinForRoom(meta, roomId);
      if (existing !== null && !replace) return { result: existing };
      let pin = null;
      for (let draw = 0; draw < 20; draw++) {
        const candidate = makePin();
        if (typeof candidate === 'string' && candidate.length === 6 && /^\d{6}$/.test(candidate)
          && !Object.hasOwn(meta.pins, candidate)) { pin = candidate; break; }
      }
      if (pin === null) return { result: null };
      const pins = Object.fromEntries(Object.entries(meta.pins).filter(([, id]) => id !== roomId));
      pins[pin] = roomId;
      return { next: { ...meta, pins }, result: pin };
    });
  } catch { /* PIN availability must not fail room creation or owner reads. */ return null; }
}

export async function removeRoomPins(store, roomId) {
  try {
    return await updateMeta(store, meta => {
      const pins = Object.fromEntries(Object.entries(meta.pins).filter(([, id]) => id !== roomId));
      return Object.keys(pins).length === Object.keys(meta.pins).length
        ? { result: true } : { next: { ...meta, pins }, result: true };
    }) ?? false;
  } catch { /* Deletion is best effort; rotation must check the result. */ return false; }
}

export async function checkAccess({ store, auth }) {
  const { text, etag } = await store.readQueue(auth.roomId);
  if (text === null) return { ok: false, status: 404, error: 'no_room' };
  const doc = decodeRoomDoc(text);
  if (!doc) throw new Error('Invalid room document');
  if (auth.epoch !== doc[auth.role === 'o' ? 'ownerEpoch' : 'guestEpoch']) {
    return { ok: false, status: 401, error: 'stale_token' };
  }
  return { ok: true, doc, etag };
}

export async function runCommand({ store, auth, cmd, now = Date.now, makeQid = randomUUID, makePin }) {
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const access = await checkAccess({ store, auth });
      if (!access.ok) return failure(access.status, access.error);
      const { doc, etag } = access;
      if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return failure(400, 'bad_command');
      if (auth.role !== 'o' && ownerCommands.has(cmd.type)) return failure(403, 'owner_only');
      if (cmd.type === 'closeRoom') {
        await store.deleteRoom(auth.roomId);
        await removeRoomPins(store, auth.roomId);
        return { status: 200, body: { ok: true, closed: true } };
      }
      if (cmd.type === 'control' || cmd.type === 'report') {
        if (cmd.type === 'control') {
          if (!['toggle', 'restart'].includes(cmd.action)) return failure(400, 'bad_command');
          await store.writePlayer(auth.roomId, 'c', { a: cmd.action, t: now() });
        } else {
          if (!['playing', 'paused', 'buffering', 'idle'].includes(cmd.playerState)) return failure(400, 'bad_command');
          await store.writePlayer(auth.roomId, 's', cmd.playerState);
        }
        return { status: 200, body: { ok: true, rev: doc.rev } };
      }
      let next;
      if (cmd.type === 'rotateGuest') {
        if (doc.guestEpoch >= 999999999) return failure(503, 'busy');
        next = { ...doc, guestEpoch: doc.guestEpoch + 1 };
      } else {
        try {
          next = applyCommand(doc, cmd, { makeQid });
        } catch (error) {
          if (error.code === 'bad_command') return failure(400, 'bad_command');
          if (error.code === 'queue_full') return failure(409, 'queue_full');
          throw error;
        }
      }
      if (next === doc) return { status: 200, body: { ok: true, rev: doc.rev } };
      if (!Number.isSafeInteger(doc.rev + 1)) return failure(503, 'busy');
      // applyCommand returns the queue state; retain the room metadata explicitly.
      next = { ...doc, ...next, rev: doc.rev + 1, updatedAt: now() };
      if (await store.writeQueue(auth.roomId, encodeRoomDoc(next), etag)) {
        if (cmd.type === 'rotateGuest') {
          const pin = await issueRoomPin({ store, roomId: auth.roomId, makePin, replace: true });
          if (pin === null && !await removeRoomPins(store, auth.roomId)) return failure(503, 'busy');
        }
        return { status: 200, body: { ok: true, rev: next.rev } };
      }
    }
    return failure(503, 'busy');
  } catch {
    return failure(502, 'store_failed');
  }
}
