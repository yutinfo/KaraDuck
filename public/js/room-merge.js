import { deserialize } from './store.js';

const ACTIVE_PLAYER_STATES = new Set(['playing', 'paused', 'buffering']);
const VALID_CONTROL_ACTIONS = new Set(['toggle', 'restart']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = cloneValue(v);
  }
  return out;
}

function setAtPath(obj, segments, value) {
  const base = isPlainObject(obj) ? { ...obj } : {};
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    if (value === null || value === undefined) {
      delete base[head];
    } else {
      base[head] = cloneValue(value);
    }
    return base;
  }
  base[head] = setAtPath(base[head], rest, value);
  return base;
}

function patchAtPath(obj, segments, patchData) {
  if (segments.length === 0) {
    let next = isPlainObject(obj) ? { ...obj } : {};
    for (const [key, value] of Object.entries(patchData)) {
      if (key.includes('/')) {
        const subSegments = key.split('/').filter(Boolean);
        if (subSegments.length > 0) {
          next = setAtPath(next, subSegments, value);
        }
      } else if (value === null || value === undefined) {
        delete next[key];
      } else {
        next[key] = cloneValue(value);
      }
    }
    return next;
  }
  const base = isPlainObject(obj) ? { ...obj } : {};
  const [head, ...rest] = segments;
  base[head] = patchAtPath(base[head], rest, patchData);
  return base;
}

export function applyStreamEvent(room, type, { path, data } = {}) {
  if (typeof path !== 'string') {
    return room;
  }
  const segments = path.split('/').filter(Boolean);

  if (type === 'put') {
    if (segments.length === 0) {
      if (data === null || data === undefined) {
        return null;
      }
      return isPlainObject(data) ? cloneValue(data) : null;
    }
    return setAtPath(room, segments, data);
  }

  if (type === 'patch') {
    if (!isPlainObject(data)) {
      return room;
    }
    return patchAtPath(room, segments, data);
  }

  return room;
}

export function toSnapshot(room) {
  if (!isPlainObject(room) || typeof room.q !== 'string') {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(room.q);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  if (
    !Number.isInteger(parsed.rev) ||
    parsed.rev < 0 ||
    !Number.isInteger(parsed.guestEpoch) ||
    parsed.guestEpoch < 1 ||
    !Number.isInteger(parsed.ownerEpoch) ||
    parsed.ownerEpoch < 1
  ) {
    return null;
  }

  const { current, queue, history } = deserialize(room.q);
  const rawPlayerState = room.p?.s;
  const playerState =
    current && ACTIVE_PLAYER_STATES.has(rawPlayerState) ? rawPlayerState : 'idle';

  return {
    rev: parsed.rev,
    name: typeof parsed.name === 'string' ? parsed.name : '',
    guestEpoch: parsed.guestEpoch,
    ownerEpoch: parsed.ownerEpoch,
    current,
    queue,
    history,
    playerState,
  };
}

export function controlStamp(room) {
  const stamp = room?.p?.c?.t;
  return typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : null;
}

export function createControlGate() {
  let baselinePending = true;
  let lastStamp = null;

  return {
    opened() {
      baselinePending = true;
    },
    next(room) {
      const stamp = controlStamp(room);
      if (baselinePending) {
        baselinePending = false;
        lastStamp = stamp;
        return null;
      }
      if (stamp === null) {
        lastStamp = null;
        return null;
      }
      if (stamp === lastStamp) {
        return null;
      }
      lastStamp = stamp;
      const action = room?.p?.c?.a;
      return VALID_CONTROL_ACTIONS.has(action) ? action : null;
    },
  };
}
