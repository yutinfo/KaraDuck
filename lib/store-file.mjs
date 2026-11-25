import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasQueue = room => room !== undefined && Object.hasOwn(room, 'q');

function decodeFile(text) {
  const saved = JSON.parse(text);
  if (!isObject(saved) || !isObject(saved.rooms)) throw new Error('Invalid room store');
  const rooms = new Map(Object.entries(saved.rooms));
  for (const room of rooms.values()) {
    if (!isObject(room) || !isObject(room.p)
      || (hasQueue(room) && (typeof room.q !== 'string' || typeof room.etag !== 'string'
        || !room.etag || room.etag === 'null_etag'))
      || Object.keys(room.p).some(field => field !== 's' && field !== 'c')) {
      throw new Error('Invalid saved room');
    }
  }
  return rooms;
}

export function createFileStore({ file, now = Date.now } = {}) {
  let rooms = new Map();
  const listeners = new Map();
  if (file) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') renameSync(file, `${file}.bad-${now()}`);
    }
    if (text !== undefined) {
      try {
        rooms = decodeFile(text);
      } catch {
        renameSync(file, `${file}.bad-${now()}`);
      }
    }
  }

  function commit(next) {
    if (file) {
      const text = JSON.stringify({ rooms: Object.fromEntries(next) });
      mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp-${randomUUID()}`;
      try {
        writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(temp, file);
      } finally {
        rmSync(temp, { force: true });
      }
    }
    rooms = next;
  }

  function publish(roomId, event) {
    for (const listener of [...(listeners.get(roomId) ?? [])]) {
      try {
        listener(structuredClone(event));
      } catch {
        // A disconnected or broken subscriber must not fail a committed write.
      }
    }
  }

  return {
    async readQueue(roomId) {
      const room = rooms.get(roomId);
      return hasQueue(room) ? { text: room.q, etag: room.etag } : { text: null, etag: 'null_etag' };
    },

    async writeQueue(roomId, text, etag) {
      const room = rooms.get(roomId);
      if (etag !== (hasQueue(room) ? room.etag : 'null_etag')) return false;
      if (typeof text !== 'string') throw new TypeError('Queue must be a string');
      const next = new Map(rooms);
      next.set(roomId, { q: text, p: room?.p ?? {}, etag: randomUUID() });
      // No await between the etag check and commit: concurrent calls cannot both win.
      commit(next);
      publish(roomId, { path: '/q', data: text });
      return true;
    },

    async writePlayer(roomId, field, value) {
      if (field !== 's' && field !== 'c') throw new TypeError('Invalid player field');
      // Player fields live outside /q, so they preserve the queue's etag.
      const data = structuredClone(value);
      const room = rooms.get(roomId);
      const next = new Map(rooms);
      next.set(roomId, { ...room, p: { ...room?.p, [field]: data } });
      commit(next);
      publish(roomId, { path: `/p/${field}`, data });
    },

    async deleteRoom(roomId) {
      const next = new Map(rooms);
      next.delete(roomId);
      commit(next);
      publish(roomId, { path: '/', data: null });
    },

    async listRooms() {
      return [...rooms.keys()].filter(roomId => hasQueue(rooms.get(roomId)));
    },

    readRoom(roomId) {
      const room = rooms.get(roomId);
      if (!room) return null;
      return structuredClone({ ...(hasQueue(room) ? { q: room.q } : {}), p: room.p });
    },

    subscribe(roomId, listener) {
      let group = listeners.get(roomId);
      if (!group) listeners.set(roomId, group = new Set());
      group.add(listener);
      return () => {
        group.delete(listener);
        if (group.size === 0 && listeners.get(roomId) === group) listeners.delete(roomId);
      };
    },
  };
}
