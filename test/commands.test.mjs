import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../public/js/store.js';
import { applyCommand, sanitizeSong } from '../public/js/commands.js';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const song = n => ({ id: `songID0000${n}`, title: ` เพลง ${n} `, durationSec: 268, by: '  คนร้อง  ' });
function setup() {
  let counter = 0;
  const options = { makeQid: () => `q${++counter}` };
  let state = createState();
  for (let i = 1; i <= 4; i++) state = applyCommand(freeze(state), freeze({ type: 'enqueue', song: song(i) }), options);
  return { state: freeze(state), options };
}

test('all song commands create fresh safe songs and queue ids without mutating frozen inputs', () => {
  for (const type of ['enqueue', 'enqueueNext', 'playNow']) {
    const { state, options } = setup();
    const cmd = freeze({ type, song: { ...song(5), qid: 'untrusted', extra: { nested: true } } });
    const next = applyCommand(state, cmd, options);
    assert.equal(state.current.qid, 'q1');
    assert.deepEqual(state.queue.map(item => item.qid), ['q2', 'q3', 'q4']);
    if (type === 'enqueue') assert.deepEqual(next.queue.map(item => item.qid), ['q2', 'q3', 'q4', 'q5']);
    if (type === 'enqueueNext') assert.deepEqual(next.queue.map(item => item.qid), ['q5', 'q2', 'q3', 'q4']);
    if (type === 'playNow') {
      assert.equal(next.current.qid, 'q5');
      assert.equal(next.history[0].id, state.current.id);
      assert.deepEqual(next.queue, state.queue);
    }
    const inserted = type === 'playNow' ? next.current : next.queue.find(item => item.qid === 'q5');
    assert.equal(inserted.by, 'คนร้อง');
    assert.equal(inserted.title, 'เพลง 5');
    assert.equal(Object.hasOwn(inserted, 'extra'), false);
    assert.notEqual(inserted, cmd.song);
    const idle = applyCommand(freeze(createState()), cmd, options);
    assert.equal(idle.current.id, song(5).id);
    assert.deepEqual(idle.queue, []);
  }
});

test('queue selection, removal, move and moveToTop follow the command table', () => {
  const { state } = setup();
  const cases = [
    [{ type: 'playFromQueue', qid: 'q3' }, ['q2', 'q4'], 'q3'],
    [{ type: 'remove', qid: 'q3' }, ['q2', 'q4'], 'q1'],
    [{ type: 'move', qid: 'q2', delta: 1 }, ['q3', 'q2', 'q4'], 'q1'],
    [{ type: 'move', qid: 'q4', delta: -50 }, ['q4', 'q2', 'q3'], 'q1'],
    [{ type: 'move', qid: 'q2', delta: 50 }, ['q3', 'q4', 'q2'], 'q1'],
    [{ type: 'moveToTop', qid: 'q4' }, ['q4', 'q2', 'q3'], 'q1'],
  ];
  for (const [cmd, queue, current] of cases) {
    const next = applyCommand(state, freeze(cmd));
    assert.deepEqual(next.queue.map(item => item.qid), queue);
    assert.equal(next.current.qid, current);
    if (cmd.type === 'playFromQueue') assert.equal(next.history[0].id, state.current.id);
  }
});

test('advance guards stale qid, records history, supports skipHistory and drains queue', () => {
  let { state } = setup();
  assert.equal(applyCommand(state, freeze({ type: 'advance', qid: 'stale' })), state);
  let next = applyCommand(state, freeze({ type: 'advance', qid: 'q1' }));
  assert.equal(next.current.qid, 'q2');
  assert.equal(next.history[0].id, state.current.id);
  assert.equal(applyCommand(freeze(next), { type: 'advance', qid: 'q1' }), next);
  next = applyCommand(next, freeze({ type: 'advance', skipHistory: true }));
  assert.equal(next.current.qid, 'q3');
  assert.equal(next.history.length, 1);
  next = applyCommand(next, { type: 'advance' });
  next = applyCommand(next, { type: 'advance' });
  assert.equal(next.current, null);
  assert.equal(next.queue.length, 0);
  assert.equal(applyCommand(freeze(next), { type: 'advance' }), next);
});

test('clears preserve current and all commands with no effect preserve state identity', () => {
  const { state } = setup();
  const withHistory = freeze(applyCommand(state, { type: 'advance' }));
  const cleared = applyCommand(withHistory, { type: 'clearQueue' });
  assert.equal(cleared.current, withHistory.current);
  assert.deepEqual(cleared.queue, []);
  assert.deepEqual(cleared.history, withHistory.history);
  const noHistory = applyCommand(withHistory, { type: 'clearHistory' });
  assert.deepEqual(noHistory.history, []);
  assert.equal(noHistory.current, withHistory.current);
  assert.deepEqual(noHistory.queue, withHistory.queue);
  assert.equal(applyCommand(freeze(cleared), { type: 'clearQueue' }), cleared);
  assert.equal(applyCommand(freeze(noHistory), { type: 'clearHistory' }), noHistory);
  for (const cmd of [
    { type: 'playFromQueue', qid: 'absent' }, { type: 'remove', qid: 'absent' },
    { type: 'move', qid: 'absent', delta: 1 }, { type: 'moveToTop', qid: 'absent' },
    { type: 'moveToTop', qid: 'q2' }, { type: 'move', qid: 'q2', delta: -1 },
  ]) assert.equal(applyCommand(state, freeze(cmd)), state);
});

test('sanitizeSong ignores client thumbnail/duration/qid, enforces bounds and normalizes by', () => {
  const raw = freeze({ ...song(1), thumbnail: 'javascript:alert(1)', duration: 'forged', channel: 'a'.repeat(130), by: 'x'.repeat(30), qid: 'forged' });
  const clean = sanitizeSong(raw);
  assert.equal(clean.thumbnail, `https://i.ytimg.com/vi/${raw.id}/mqdefault.jpg`);
  assert.equal(clean.duration, '4:28');
  assert.equal(clean.channel.length, 100);
  assert.equal(clean.by, 'x'.repeat(20));
  assert.equal(Object.hasOwn(clean, 'qid'), false);
  for (const durationSec of [-1, 1.5, '1', null, Infinity, 86401]) {
    assert.equal(sanitizeSong({ ...song(1), durationSec }).durationSec, 0);
  }
  assert.equal(sanitizeSong({ ...song(1), durationSec: 86400 }).duration, '24:00:00');
  for (const by of ['  ', 5, null, undefined]) assert.equal(Object.hasOwn(sanitizeSong({ ...song(1), by }), 'by'), false);
  assert.equal(sanitizeSong({ ...song(1), channel: 42 }).channel, '');
  assert.equal(sanitizeSong({ ...song(1), title: 'x'.repeat(300) }).title.length, 300);
});

test('malformed commands, ids, titles, qids, deltas and advance options throw bad_command', () => {
  const { state } = setup();
  const invalid = [null, [], 42, 'enqueue', {}, { type: 'unknown' },
    ...[null, {}, { ...song(1), id: 'short' }, { ...song(1), id: 'bad!id12345' },
      { ...song(1), title: '' }, { ...song(1), title: '   ' }, { ...song(1), title: 42 },
      { ...song(1), title: 'x'.repeat(301) }].map(song => ({ type: 'enqueue', song })),
    ...[0, '1', 1.5, -51, 51, undefined].map(delta => ({ type: 'move', qid: 'q2', delta })),
    ...['playFromQueue', 'remove', 'moveToTop', 'advance'].flatMap(type => [null, '', 5, 'a'.repeat(65)].map(qid => ({ type, qid }))),
    { type: 'advance', skipHistory: 'true' }, { type: 'move', delta: 1 },
  ];
  for (const cmd of invalid) assert.throws(() => applyCommand(state, freeze(cmd)), { code: 'bad_command' }, JSON.stringify(cmd));
});
