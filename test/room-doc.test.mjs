import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRoomName, newRoomDoc, encodeRoomDoc, decodeRoomDoc } from '../lib/room-doc.mjs';
import { deserialize } from '../public/js/store.js';

test('cleanRoomName trims names and accepts only 1–40 characters', () => {
  assert.equal(cleanRoomName('  บ้าน  '), 'บ้าน');
  assert.equal(cleanRoomName(' ก '), 'ก');
  assert.equal(cleanRoomName(` ${'ก'.repeat(40)} `), 'ก'.repeat(40));
  for (const raw of ['', ' \n\t ', 'ก'.repeat(41), null, undefined, 42, {}, []]) {
    assert.equal(cleanRoomName(raw), null);
  }
});

test('newRoomDoc creates independent empty room documents and roundtrips exactly', () => {
  const doc = newRoomDoc('บ้าน', 123);
  assert.deepEqual(doc, { rev: 0, name: 'บ้าน', guestEpoch: 1, ownerEpoch: 1, createdAt: 123, updatedAt: 123, current: null, queue: [], history: [] });
  assert.equal(encodeRoomDoc(doc), JSON.stringify(doc));
  assert.deepEqual(decodeRoomDoc(encodeRoomDoc(doc)), doc);
  const other = newRoomDoc('อีกบ้าน');
  doc.queue.push({ id: 'unrelated' });
  doc.history.push({ id: 'unrelated' });
  assert.deepEqual(other.queue, []);
  assert.deepEqual(other.history, []);
});

test('decodeRoomDoc rejects invalid JSON objects, revisions and token epochs', () => {
  const valid = newRoomDoc('บ้าน');
  for (const text of ['[]', 'x', '{"rev":-1}', 'null', '42', '"บ้าน"', '', null, undefined, valid]) {
    assert.equal(decodeRoomDoc(text), null);
  }
  for (const rev of [-1, 1.5, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(decodeRoomDoc(JSON.stringify({ ...valid, rev })), null);
  }
  const noRev = { ...valid };
  delete noRev.rev;
  assert.equal(decodeRoomDoc(JSON.stringify(noRev)), null);
  for (const field of ['guestEpoch', 'ownerEpoch']) {
    for (const value of [0, -1, 1.5, '1', null, 1000000000]) {
      assert.equal(decodeRoomDoc(JSON.stringify({ ...valid, [field]: value })), null);
    }
    const missing = { ...valid };
    delete missing[field];
    assert.equal(decodeRoomDoc(JSON.stringify(missing)), null);
  }
  const boundary = { ...valid, rev: Number.MAX_SAFE_INTEGER, guestEpoch: 999999999, ownerEpoch: 999999999 };
  assert.deepEqual(decodeRoomDoc(JSON.stringify(boundary)), boundary);
});

test('decodeRoomDoc validates room names and drops unrelated metadata', () => {
  const doc = newRoomDoc('บ้าน');
  for (const name of [null, '', '  ', 42, 'ก'.repeat(41)]) {
    assert.equal(decodeRoomDoc(JSON.stringify({ ...doc, name })), null);
  }
  assert.deepEqual(decodeRoomDoc(JSON.stringify({ ...doc, name: ' บ้าน ', extra: 'ignored' })), doc);
});

test('decodeRoomDoc delegates song cleanup, qid uniqueness and history cap to store.deserialize', () => {
  const song = { id: 'k6ngeWkYjI8', title: 'ลูกอม', qid: 'current', by: '  แนน  ' };
  const raw = {
    ...newRoomDoc('บ้าน'), rev: 8, guestEpoch: 3, ownerEpoch: 2,
    current: song,
    queue: [{ ...song, qid: 'queue' }, { id: 'bad', title: 'invalid' }, null],
    history: Array.from({ length: 35 }, (_, n) => ({ id: `histID000${String(n).padStart(2, '0')}`, title: `เพลง ${n}`, qid: 'removed' })),
  };
  const text = JSON.stringify(raw);
  const clean = decodeRoomDoc(text);
  assert.deepEqual(clean, { rev: 8, name: 'บ้าน', guestEpoch: 3, ownerEpoch: 2, createdAt: raw.createdAt, updatedAt: raw.updatedAt, ...deserialize(text) });
  assert.equal(clean.current.by, 'แนน');
  assert.equal(clean.queue.length, 1);
  assert.equal(clean.history.length, 30);
  assert.equal(Object.hasOwn(clean.history[0], 'qid'), false);
  const duplicate = decodeRoomDoc(JSON.stringify({ ...raw, queue: [song, song] }));
  assert.equal(new Set([duplicate.current.qid, ...duplicate.queue.map(item => item.qid)]).size, 3);
});

test('legacy or invalid timestamps decode to zero without invalidating old room documents', () => {
  for (const field of ['createdAt', 'updatedAt']) {
    for (const value of [undefined, null, -1, 1.5, '123', {}, []]) {
      const raw = { ...newRoomDoc('บ้าน', 123), [field]: value };
      const doc = decodeRoomDoc(JSON.stringify(raw));
      assert.equal(doc[field], 0);
      assert.equal(doc[field === 'createdAt' ? 'updatedAt' : 'createdAt'], 123);
    }
  }
  assert.equal(decodeRoomDoc(encodeRoomDoc(newRoomDoc('บ้าน', 0))).updatedAt, 0);
});
