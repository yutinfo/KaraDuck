import test from 'node:test';
import assert from 'node:assert/strict';
import { createRtdbStore } from '../lib/store-rtdb.mjs';

const dbUrl = 'https://karaduck-3935d-default-rtdb.asia-southeast1.firebasedatabase.app';
const roomId = 'ABCDEFGHJKLMNPQR';
function setup(responses) {
  const calls = [];
  let invalidations = 0;
  const store = createRtdbStore({ dbUrl: `${dbUrl}/`, auth: {
    getAccessToken: async () => `token-${invalidations}`, invalidate: () => invalidations++,
  }, fetchImpl: async (url, init) => {
    calls.push({ url, ...init, headers: new Headers(init.headers) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'unexpected fetch');
    return next;
  } });
  return { store, calls, invalidations: () => invalidations };
}
const json = (value, init) => new Response(JSON.stringify(value), init);

test('readQueue ขอ ETag และคืนข้อความ JSON string เดิมรวมทั้ง null', async () => {
  const text = '{"queue":[],"current":null}';
  const { store, calls } = setup([json(text, { headers: { ETag: '"rev1"' } }), json(null, { headers: { ETag: 'null_etag' } })]);
  assert.deepEqual(await store.readQueue(roomId), { text, etag: '"rev1"' });
  assert.deepEqual(await store.readQueue(roomId), { text: null, etag: 'null_etag' });
  assert.equal(calls[0].url, `${dbUrl}/rooms/${roomId}/q.json`);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.get('x-firebase-etag'), 'true');
  for (const call of calls) {
    assert.equal(call.headers.get('authorization'), 'Bearer token-0');
    assert.ok(call.signal instanceof AbortSignal);
  }
});

test('writeQueue ส่ง if-match และ JSON string ครอบข้อความ, 200 true / 412 false', async () => {
  const { store, calls } = setup([json('ok'), json(null, { status: 412 })]);
  const text = '{"queue":[]}';
  assert.equal(await store.writeQueue(roomId, text, '"old"'), true);
  assert.equal(await store.writeQueue(roomId, text, 'null_etag'), false);
  assert.equal(calls[0].url, `${dbUrl}/rooms/${roomId}/q.json`);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].headers.get('if-match'), '"old"');
  assert.equal(calls[1].headers.get('if-match'), 'null_etag');
  assert.equal(calls[0].headers.get('content-type'), 'application/json');
  assert.equal(calls[0].body, JSON.stringify(text));
});

test('writePlayer ทั้ง s/c, deleteRoom และ shallow list รวม null', async () => {
  const { store, calls } = setup([json('paused'), json({ a: 'toggle', t: 1 }), json(null), json({ [roomId]: true, SECOND: true }), json(null)]);
  await store.writePlayer(roomId, 's', 'paused');
  await store.writePlayer(roomId, 'c', { a: 'toggle', t: 1 });
  await store.deleteRoom(roomId);
  assert.deepEqual(await store.listRooms(), [roomId, 'SECOND']);
  assert.deepEqual(await store.listRooms(), []);
  assert.deepEqual(calls.map(c => [c.method, c.url]), [
    ['PUT', `${dbUrl}/rooms/${roomId}/p/s.json`], ['PUT', `${dbUrl}/rooms/${roomId}/p/c.json`],
    ['DELETE', `${dbUrl}/rooms/${roomId}.json`], ['GET', `${dbUrl}/rooms.json?shallow=true`], ['GET', `${dbUrl}/rooms.json?shallow=true`],
  ]);
  assert.equal(calls[0].body, '"paused"');
  assert.deepEqual(JSON.parse(calls[1].body), { a: 'toggle', t: 1 });
  for (const call of calls) {
    assert.equal(call.headers.get('authorization'), 'Bearer token-0');
    assert.ok(call.signal instanceof AbortSignal);
  }
  await assert.rejects(store.writePlayer(roomId, 'q', 'bad'));
  assert.equal(calls.length, 5);
});

test('401 invalidate แล้ว retry หนึ่งครั้งด้วยโทเคนใหม่และคำขอเดิม', async () => {
  const { store, calls, invalidations } = setup([json(null, { status: 401 }), json('saved')]);
  assert.equal(await store.writeQueue(roomId, 'saved', '"old"'), true);
  assert.equal(invalidations(), 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.get('authorization'), 'Bearer token-1');
  assert.equal(calls[1].headers.get('if-match'), '"old"');
  assert.equal(calls[1].body, calls[0].body);
});

test('401 ซ้ำไม่วน, 500/network/timeout/JSON เสีย/ETag หาย เป็น store_failed', async () => {
  for (const responses of [[json(null, { status: 401 }), json(null, { status: 401 })],
    [json(null, { status: 500 })], [new Error('secret')], [new DOMException('timeout', 'TimeoutError')],
    [new Response('{', { headers: { ETag: 'x' } })], [json('no etag')], [json({ bad: true }, { headers: { ETag: 'x' } })]]) {
    const { store, calls } = setup(responses);
    await assert.rejects(store.readQueue(roomId), error => error.code === 'store_failed' && !error.message.includes('secret'));
    assert.ok(calls.length <= 2);
  }
});

test('auth ล้มเป็น store_failed โดยไม่ fetch', async () => {
  const store = createRtdbStore({ dbUrl, auth: { getAccessToken: async () => { throw new Error('private'); } }, fetchImpl: () => assert.fail('fetch') });
  await assert.rejects(store.listRooms(), { code: 'store_failed' });
});

test('ทุก operation ตั้ง timeout 5000ms และเมื่อ signal abort คืน store_failed', async t => {
  let signals = 0;
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 5000);
    signals++;
    return AbortSignal.abort(new DOMException('timeout', 'TimeoutError'));
  });
  const store = createRtdbStore({ dbUrl, auth: { getAccessToken: async () => 'token' },
    fetchImpl: async (_url, { signal }) => { signal.throwIfAborted(); assert.fail('signal did not abort'); } });
  for (const operation of [() => store.readQueue(roomId), () => store.writeQueue(roomId, 'q', 'null_etag'),
    () => store.writePlayer(roomId, 's', 'idle'), () => store.deleteRoom(roomId), () => store.listRooms()]) {
    await assert.rejects(operation(), { code: 'store_failed' });
  }
  assert.equal(signals, 5);
});
