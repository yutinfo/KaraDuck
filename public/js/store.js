export const STORAGE_KEY = 'karaoke.state.v1';
export const MAX_QUEUE = 200;

const VIDEO_ID_RE = /^[\w-]{11}$/;
const MAX_HISTORY = 30;

function defaultMakeQid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDurationSec(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function formatDuration(sec) {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function toSong(item) {
  const durationSec = normalizeDurationSec(item.durationSec);
  const duration = typeof item.duration === 'string' && item.duration.length > 0
    ? item.duration
    : formatDuration(durationSec);
  return {
    id: String(item.id),
    title: String(item.title),
    channel: typeof item.channel === 'string' ? item.channel : '',
    duration,
    durationSec,
    thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : '',
    ...(typeof item.by === 'string' && item.by.trim()
      ? { by: item.by.trim().slice(0, 20) } : {}),
  };
}

function toQueueItem(song, makeQid = defaultMakeQid) {
  const base = toSong(song);
  return {
    ...base,
    qid: String(makeQid()),
  };
}

function pushHistory(history, song) {
  const entry = toSong(song);
  const filtered = history.filter((item) => item.id !== entry.id);
  return [entry, ...filtered].slice(0, MAX_HISTORY);
}

function isValidSongLike(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.id === 'string' &&
    VIDEO_ID_RE.test(value.id) &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0
  );
}

export function createState() {
  return {
    current: null,
    queue: [],
    history: [],
  };
}

export function enqueue(state, song, makeQid = defaultMakeQid) {
  if (state.queue.length >= MAX_QUEUE) {
    throw Object.assign(new Error('queue_full'), { code: 'queue_full' });
  }
  const item = toQueueItem(song, makeQid);
  if (!state.current) {
    return {
      current: item,
      queue: [...state.queue],
      history: [...state.history],
    };
  }
  return {
    current: state.current,
    queue: [...state.queue, item],
    history: [...state.history],
  };
}

export function enqueueNext(state, song, makeQid = defaultMakeQid) {
  if (state.queue.length >= MAX_QUEUE) {
    throw Object.assign(new Error('queue_full'), { code: 'queue_full' });
  }
  const item = toQueueItem(song, makeQid);
  if (!state.current) {
    return {
      current: item,
      queue: [...state.queue],
      history: [...state.history],
    };
  }
  return {
    current: state.current,
    queue: [item, ...state.queue],
    history: [...state.history],
  };
}

export function playNow(state, song, makeQid = defaultMakeQid) {
  const item = toQueueItem(song, makeQid);
  const history = state.current
    ? pushHistory(state.history, state.current)
    : [...state.history];
  return {
    current: item,
    queue: [...state.queue],
    history,
  };
}

export function playFromQueue(state, qid) {
  const index = state.queue.findIndex((item) => item.qid === qid);
  if (index === -1) {
    return state;
  }
  const picked = state.queue[index];
  const queue = [
    ...state.queue.slice(0, index),
    ...state.queue.slice(index + 1),
  ];
  const history = state.current
    ? pushHistory(state.history, state.current)
    : [...state.history];
  return {
    current: picked,
    queue,
    history,
  };
}

export function advance(state, { skipHistory = false } = {}) {
  if (!state.current && state.queue.length === 0) {
    return state;
  }
  const history = !skipHistory && state.current
    ? pushHistory(state.history, state.current)
    : [...state.history];
  const [nextCurrent = null, ...nextQueue] = state.queue;
  return {
    current: nextCurrent,
    queue: nextQueue,
    history,
  };
}

export function remove(state, qid) {
  const index = state.queue.findIndex((item) => item.qid === qid);
  if (index === -1) {
    return state;
  }
  return {
    current: state.current,
    queue: [
      ...state.queue.slice(0, index),
      ...state.queue.slice(index + 1),
    ],
    history: [...state.history],
  };
}

export function move(state, qid, delta) {
  const index = state.queue.findIndex((item) => item.qid === qid);
  if (index === -1) {
    return state;
  }
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  const target = Math.max(0, Math.min(state.queue.length - 1, index + step));
  if (target === index) {
    return state;
  }
  const queue = [...state.queue];
  const [moved] = queue.splice(index, 1);
  queue.splice(target, 0, moved);
  return {
    current: state.current,
    queue,
    history: [...state.history],
  };
}

export function moveTo(state, qid, beforeQid) {
  const validQid = value => typeof value === 'string' && value.length >= 1 && value.length <= 64;
  if (!validQid(qid) || (beforeQid !== null && !validQid(beforeQid))) {
    throw Object.assign(new Error('bad_command'), { code: 'bad_command' });
  }
  const index = state.queue.findIndex(item => item.qid === qid);
  const before = beforeQid === null ? state.queue.length : state.queue.findIndex(item => item.qid === beforeQid);
  if (index === -1 || before === -1 || index === before || index + 1 === before) return state;
  const queue = [...state.queue];
  const [item] = queue.splice(index, 1);
  queue.splice(before > index ? before - 1 : before, 0, item);
  return { current: state.current, queue, history: [...state.history] };
}

export function moveToTop(state, qid) {
  const index = state.queue.findIndex((item) => item.qid === qid);
  if (index === -1 || index === 0) {
    return state;
  }
  const queue = [
    state.queue[index],
    ...state.queue.slice(0, index),
    ...state.queue.slice(index + 1),
  ];
  return {
    current: state.current,
    queue,
    history: [...state.history],
  };
}

export function clearQueue(state) {
  return {
    current: state.current,
    queue: [],
    history: [...state.history],
  };
}

export function clearHistory(state) {
  return {
    current: state.current,
    queue: [...state.queue],
    history: [],
  };
}

export function totalDurationSec(state) {
  if (!state || !Array.isArray(state.queue)) {
    return 0;
  }
  return state.queue.reduce((sum, item) => sum + normalizeDurationSec(item?.durationSec), 0);
}

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(str) {
  if (typeof str !== 'string') {
    return createState();
  }
  let parsed;
  try {
    parsed = JSON.parse(str);
  } catch {
    return createState();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return createState();
  }

  const usedQids = new Set();
  const makeUniqueQid = (rawQid) => {
    if (typeof rawQid === 'string' && rawQid.length > 0 && !usedQids.has(rawQid)) {
      usedQids.add(rawQid);
      return rawQid;
    }
    let next = defaultMakeQid();
    while (usedQids.has(next)) {
      next = defaultMakeQid();
    }
    usedQids.add(next);
    return next;
  };

  const current = isValidSongLike(parsed.current)
    ? { ...toSong(parsed.current), qid: makeUniqueQid(parsed.current.qid) }
    : null;

  const queue = Array.isArray(parsed.queue)
    ? parsed.queue
        .filter(isValidSongLike)
        .map((item) => ({ ...toSong(item), qid: makeUniqueQid(item.qid) }))
    : [];

  const seenHistoryIds = new Set();
  const history = [];
  if (Array.isArray(parsed.history)) {
    for (const item of parsed.history) {
      if (!isValidSongLike(item) || seenHistoryIds.has(item.id)) {
        continue;
      }
      seenHistoryIds.add(item.id);
      history.push(toSong(item));
      if (history.length >= MAX_HISTORY) {
        break;
      }
    }
  }

  return { current, queue, history };
}
