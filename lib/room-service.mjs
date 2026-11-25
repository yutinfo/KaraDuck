import { randomUUID } from 'node:crypto';
import { decodeRoomDoc, encodeRoomDoc } from './room-doc.mjs';
import { applyCommand } from '../public/js/commands.js';

const failure = (status, error) => ({ status, body: { error } });
const ownerCommands = new Set(['clearQueue', 'clearHistory', 'report', 'rotateGuest', 'closeRoom']);

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

export async function runCommand({ store, auth, cmd, now = Date.now, makeQid = randomUUID }) {
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const access = await checkAccess({ store, auth });
      if (!access.ok) return failure(access.status, access.error);
      const { doc, etag } = access;
      if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return failure(400, 'bad_command');
      if (auth.role !== 'o' && ownerCommands.has(cmd.type)) return failure(403, 'owner_only');
      if (cmd.type === 'closeRoom') {
        await store.deleteRoom(auth.roomId);
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
        return { status: 200, body: { ok: true, rev: next.rev } };
      }
    }
    return failure(503, 'busy');
  } catch {
    return failure(502, 'store_failed');
  }
}
