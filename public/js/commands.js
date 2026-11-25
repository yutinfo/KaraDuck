import * as store from './store.js';

const badCommand = () => Object.assign(new Error('bad_command'), { code: 'bad_command' });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validQid = value => typeof value === 'string' && value.length >= 1 && value.length <= 64;

export function sanitizeSong(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || !/^[\w-]{11}$/.test(raw.id)
    || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.trim().length > 300) {
    throw badCommand();
  }
  const durationSec = Number.isInteger(raw.durationSec) && raw.durationSec >= 0 && raw.durationSec <= 86400
    ? raw.durationSec : 0;
  return {
    id: raw.id,
    title: raw.title.trim(),
    channel: typeof raw.channel === 'string' ? raw.channel.slice(0, 100) : '',
    durationSec,
    duration: store.formatDuration(durationSec),
    thumbnail: `https://i.ytimg.com/vi/${raw.id}/mqdefault.jpg`,
    ...(typeof raw.by === 'string' && raw.by.trim() ? { by: raw.by.trim().slice(0, 20) } : {}),
  };
}

export function applyCommand(state, cmd, { makeQid } = {}) {
  if (!isObject(cmd)) throw badCommand();
  switch (cmd.type) {
    case 'enqueue':
    case 'enqueueNext':
    case 'playNow':
      return store[cmd.type](state, sanitizeSong(cmd.song), makeQid);
    case 'playFromQueue':
    case 'remove':
    case 'moveToTop':
      if (!validQid(cmd.qid)) throw badCommand();
      return store[cmd.type](state, cmd.qid);
    case 'moveTo':
      if (!validQid(cmd.qid) || (cmd.beforeQid !== null && !validQid(cmd.beforeQid))) throw badCommand();
      return store.moveTo(state, cmd.qid, cmd.beforeQid);
    case 'move':
      if (!validQid(cmd.qid) || !Number.isInteger(cmd.delta) || cmd.delta === 0
        || cmd.delta < -50 || cmd.delta > 50) throw badCommand();
      return store.move(state, cmd.qid, cmd.delta);
    case 'advance':
      if ((cmd.qid !== undefined && !validQid(cmd.qid))
        || (cmd.skipHistory !== undefined && typeof cmd.skipHistory !== 'boolean')) throw badCommand();
      if (cmd.qid !== undefined && cmd.qid !== state.current?.qid) return state;
      return store.advance(state, { skipHistory: cmd.skipHistory });
    case 'clearQueue':
      return state.queue.length ? store.clearQueue(state) : state;
    case 'clearHistory':
      return state.history.length ? store.clearHistory(state) : state;
    default:
      throw badCommand();
  }
}
