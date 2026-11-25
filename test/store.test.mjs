import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createState,
  enqueue,
  enqueueNext,
  playNow,
  playFromQueue,
  advance,
  remove,
  move,
  moveToTop,
  clearQueue,
  clearHistory,
  totalDurationSec,
  formatDuration,
  serialize,
  deserialize,
} from '../public/js/store.js';

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj)) {
      deepFreeze(value);
    }
  }
  return obj;
}

function makeSong(index) {
  const id = `songID000${String(index).padStart(2, '0')}`;
  return deepFreeze({
    id,
    title: `เพลงที่ ${index}`,
    channel: `ช่อง ${index}`,
    duration: formatDuration(180 + index),
    durationSec: 180 + index,
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  });
}

function makeCounterQid(prefix = 'q') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe('store.js', () => {
  it('preserves trimmed by in current, queue, history and serialization', () => {
    const qid = makeCounterQid();
    let state = enqueue(createState(), { ...makeSong(1), by: '  แนน  ' }, qid);
    state = enqueue(state, { ...makeSong(2), by: '  บอล  ' }, qid);
    assert.equal(state.current.by, 'แนน');
    assert.equal(state.queue[0].by, 'บอล');
    assert.deepEqual(deserialize(serialize(state)), state);
    state = advance(deepFreeze(state));
    assert.equal(state.current.by, 'บอล');
    assert.equal(state.history[0].by, 'แนน');
    state = advance(deepFreeze(state));
    assert.deepEqual(state.history.map(song => song.by), ['บอล', 'แนน']);
    assert.deepEqual(deserialize(serialize(state)), state);
  });

  it('omits blank/non-string by and caps names at 20 on enqueue and deserialize', () => {
    for (const by of ['  ', 123, null, undefined, 'ก'.repeat(30)]) {
      const song = { ...makeSong(1), by };
      const current = enqueue(createState(), song).current;
      const restored = deserialize(JSON.stringify({ current: { ...song, qid: 'q' }, queue: [song], history: [song] }));
      for (const item of [current, restored.current, restored.queue[0], restored.history[0]]) {
        if (typeof by === 'string' && by.trim()) assert.equal(item.by, 'ก'.repeat(20));
        else assert.equal(Object.hasOwn(item, 'by'), false);
      }
    }
  });

  it('enqueue sets current when idle and appends to queue with unique qids when playing', () => {
    const qid = makeCounterQid();
    const s0 = deepFreeze(createState());
    const songA = makeSong(1);

    const s1 = deepFreeze(enqueue(s0, songA, qid));
    assert.equal(s1.current.id, songA.id);
    assert.equal(s1.current.qid, 'q-1');
    assert.equal(s1.queue.length, 0);

    const s2 = deepFreeze(enqueue(s1, songA, qid));
    assert.equal(s2.current.qid, 'q-1');
    assert.equal(s2.queue.length, 1);
    assert.equal(s2.queue[0].id, songA.id);
    assert.equal(s2.queue[0].qid, 'q-2');
    assert.notEqual(s2.queue[0].qid, s2.current.qid);

    const s3 = deepFreeze(enqueue(s2, songA, qid));
    assert.equal(s3.queue.length, 2);
    assert.notEqual(s3.queue[0].qid, s3.queue[1].qid);

    // Default randomUUID works without custom makeQid
    const s4 = enqueue(s3, songA);
    assert.equal(typeof s4.queue[2].qid, 'string');
    assert.ok(s4.queue[2].qid.length > 0);
    assert.notEqual(s4.queue[2].qid, s4.queue[1].qid);
  });

  it('enqueueNext sets current when idle and inserts at index 0 when playing', () => {
    const qid = makeCounterQid();
    const s0 = deepFreeze(createState());
    const s1 = deepFreeze(enqueueNext(s0, makeSong(1), qid));
    assert.equal(s1.current.id, makeSong(1).id);
    assert.equal(s1.queue.length, 0);

    const s2 = deepFreeze(enqueue(s1, makeSong(2), qid));
    const s3 = deepFreeze(enqueueNext(s2, makeSong(3), qid));
    assert.deepEqual(
      s3.queue.map((item) => item.id),
      [makeSong(3).id, makeSong(2).id]
    );
  });

  it('playNow moves previous current to history[0] without touching queue', () => {
    const qid = makeCounterQid();
    let s = deepFreeze(createState());
    s = deepFreeze(enqueue(s, makeSong(1), qid));
    s = deepFreeze(enqueue(s, makeSong(2), qid));

    const sNext = deepFreeze(playNow(s, makeSong(3), qid));
    assert.equal(sNext.current.id, makeSong(3).id);
    assert.deepEqual(
      sNext.queue.map((item) => item.id),
      [makeSong(2).id]
    );
    assert.equal(sNext.history.length, 1);
    assert.equal(sNext.history[0].id, makeSong(1).id);
    assert.equal('qid' in sNext.history[0], false);
  });

  it('playFromQueue pulls middle item to current, preserves rest order, and returns same ref if qid missing', () => {
    const qid = makeCounterQid();
    let s = deepFreeze(createState());
    s = deepFreeze(enqueue(s, makeSong(1), qid)); // q-1 current
    s = deepFreeze(enqueue(s, makeSong(2), qid)); // q-2
    s = deepFreeze(enqueue(s, makeSong(3), qid)); // q-3
    s = deepFreeze(enqueue(s, makeSong(4), qid)); // q-4

    const unchanged = playFromQueue(s, 'non-existent');
    assert.equal(unchanged, s);

    const picked = deepFreeze(playFromQueue(s, 'q-3'));
    assert.equal(picked.current.qid, 'q-3');
    assert.equal(picked.current.id, makeSong(3).id);
    assert.deepEqual(
      picked.queue.map((item) => item.qid),
      ['q-2', 'q-4']
    );
    assert.equal(picked.history[0].id, makeSong(1).id);
  });

  it('advance steps through queue, clears current when empty, and supports skipHistory', () => {
    const qid = makeCounterQid();
    let s = deepFreeze(createState());
    s = deepFreeze(enqueue(s, makeSong(1), qid));
    s = deepFreeze(enqueue(s, makeSong(2), qid));
    s = deepFreeze(enqueue(s, makeSong(3), qid));

    const s1 = deepFreeze(advance(s));
    assert.equal(s1.current.id, makeSong(2).id);
    assert.deepEqual(s1.queue.map((i) => i.id), [makeSong(3).id]);
    assert.deepEqual(s1.history.map((i) => i.id), [makeSong(1).id]);

    const s2 = deepFreeze(advance(s1, { skipHistory: true }));
    assert.equal(s2.current.id, makeSong(3).id);
    assert.equal(s2.queue.length, 0);
    assert.deepEqual(s2.history.map((i) => i.id), [makeSong(1).id]);

    const s3 = deepFreeze(advance(s2));
    assert.equal(s3.current, null);
    assert.equal(s3.queue.length, 0);
    assert.deepEqual(s3.history.map((i) => i.id), [makeSong(3).id, makeSong(1).id]);
  });

  it('history deduplicates by id (moving duplicate to front) and caps at 30 items', () => {
    const qid = makeCounterQid();
    let s = deepFreeze(createState());
    for (let i = 1; i <= 35; i += 1) {
      s = deepFreeze(playNow(s, makeSong(i), qid));
    }
    // 34 songs have moved to history, capped at 30 (newest is 34, oldest is 5)
    assert.equal(s.history.length, 30);
    assert.equal(s.history[0].id, makeSong(34).id);
    assert.equal(s.history[29].id, makeSong(5).id);

    // Re-playing song 10 then advancing moves song 10 to front without increasing count
    s = deepFreeze(playNow(s, makeSong(10), qid));
    s = deepFreeze(advance(s));
    assert.equal(s.history.length, 30);
    assert.equal(s.history[0].id, makeSong(10).id);
    assert.equal(s.history.filter((h) => h.id === makeSong(10).id).length, 1);
  });

  it('move, moveToTop, remove, clearQueue, clearHistory work immutably', () => {
    const qid = makeCounterQid();
    let s = deepFreeze(createState());
    s = deepFreeze(enqueue(s, makeSong(1), qid)); // current q-1
    s = deepFreeze(enqueue(s, makeSong(2), qid)); // q-2
    s = deepFreeze(enqueue(s, makeSong(3), qid)); // q-3
    s = deepFreeze(enqueue(s, makeSong(4), qid)); // q-4

    // move +1
    const mDown = deepFreeze(move(s, 'q-2', 1));
    assert.deepEqual(mDown.queue.map((i) => i.qid), ['q-3', 'q-2', 'q-4']);

    // move -1
    const mUp = deepFreeze(move(mDown, 'q-4', -1));
    assert.deepEqual(mUp.queue.map((i) => i.qid), ['q-3', 'q-4', 'q-2']);

    // move beyond bounds clamps to edge
    const mClampEnd = deepFreeze(move(s, 'q-2', 99));
    assert.deepEqual(mClampEnd.queue.map((i) => i.qid), ['q-3', 'q-4', 'q-2']);

    const mClampStart = deepFreeze(move(s, 'q-4', -99));
    assert.deepEqual(mClampStart.queue.map((i) => i.qid), ['q-4', 'q-2', 'q-3']);

    // move already at edge or missing qid returns same state
    assert.equal(move(s, 'q-2', -1), s);
    assert.equal(move(s, 'missing', 1), s);

    // moveToTop
    const topped = deepFreeze(moveToTop(s, 'q-4'));
    assert.deepEqual(topped.queue.map((i) => i.qid), ['q-4', 'q-2', 'q-3']);
    assert.equal(moveToTop(s, 'q-2'), s);
    assert.equal(moveToTop(s, 'missing'), s);

    // remove
    const removed = deepFreeze(remove(s, 'q-3'));
    assert.deepEqual(removed.queue.map((i) => i.qid), ['q-2', 'q-4']);
    assert.equal(remove(s, 'missing'), s);

    // clearQueue does not touch current
    const clearedQ = deepFreeze(clearQueue(s));
    assert.equal(clearedQ.current.qid, 'q-1');
    assert.deepEqual(clearedQ.queue, []);

    // clearHistory clears only history
    const withHist = deepFreeze(playNow(s, makeSong(5), qid));
    assert.equal(withHist.history.length, 1);
    const clearedH = deepFreeze(clearHistory(withHist));
    assert.equal(clearedH.current.id, makeSong(5).id);
    assert.equal(clearedH.queue.length, 3);
    assert.deepEqual(clearedH.history, []);
  });

  it('totalDurationSec sums queue only and formatDuration formats edge cases', () => {
    const qid = makeCounterQid();
    let s = deepFreeze(createState());
    assert.equal(totalDurationSec(s), 0);

    s = deepFreeze(enqueue(s, { ...makeSong(1), durationSec: 300 }, qid)); // current (excluded)
    s = deepFreeze(enqueue(s, { ...makeSong(2), durationSec: 268 }, qid));
    s = deepFreeze(enqueue(s, { ...makeSong(3), durationSec: 132 }, qid));
    assert.equal(totalDurationSec(s), 400);

    assert.equal(formatDuration(268), '4:28');
    assert.equal(formatDuration(3723), '1:02:03');
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(59), '0:59');
  });

  it('serialize/deserialize roundtrips valid state and sanitizes corrupt inputs', () => {
    const qid = makeCounterQid();
    let s = createState();
    s = enqueue(s, makeSong(1), qid);
    s = enqueue(s, makeSong(2), qid);
    s = playNow(s, makeSong(3), qid);
    deepFreeze(s);

    const roundtripped = deserialize(serialize(s));
    assert.deepEqual(roundtripped, s);

    // Broken JSON / non-objects
    assert.deepEqual(deserialize('{bad'), createState());
    assert.deepEqual(deserialize('null'), createState());
    assert.deepEqual(deserialize('[]'), createState());
    assert.deepEqual(deserialize('"text"'), createState());

    // Invalid IDs / missing titles dropped; history capped at 30
    const badPayload = JSON.stringify({
      current: { id: 'short', title: 'Invalid current', qid: 'c1' },
      queue: [
        { id: 'k6ngeWkYjI8', title: 'Valid 1', channel: 'Ch', duration: '4:28', durationSec: 268, thumbnail: '', qid: 'ok-1' },
        { id: 'bad!id12345', title: 'Bad chars', qid: 'bad-1' },
        { id: 'ZNRypr6GRZE', title: '   ', qid: 'bad-2' },
        { id: '_u4Amb_Mr2E', title: 'Valid 2', channel: 'Ch2', duration: '4:36', durationSec: 276, thumbnail: '' },
      ],
      history: Array.from({ length: 35 }, (_, idx) => ({
        id: `histID000${String(idx).padStart(2, '0')}`,
        title: `History ${idx}`,
        channel: 'Ch',
        duration: '3:00',
        durationSec: 180,
        thumbnail: '',
        qid: `should-be-stripped-${idx}`,
      })),
    });

    const cleaned = deserialize(badPayload);
    assert.equal(cleaned.current, null);
    assert.equal(cleaned.queue.length, 2);
    assert.deepEqual(cleaned.queue.map((i) => i.id), ['k6ngeWkYjI8', '_u4Amb_Mr2E']);
    assert.equal(cleaned.queue[0].qid, 'ok-1');
    assert.ok(typeof cleaned.queue[1].qid === 'string' && cleaned.queue[1].qid.length > 0);
    assert.equal(cleaned.history.length, 30);
    assert.equal('qid' in cleaned.history[0], false);
  });
});
