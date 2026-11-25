import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileStore } from '../lib/store-file.mjs';
import { newRoomDoc, encodeRoomDoc, decodeRoomDoc } from '../lib/room-doc.mjs';
import { checkAccess, runCommand } from '../lib/room-service.mjs';

const roomId = 'ABCDEFGHJKLMNPQR';
const guest = { roomId, role: 'g', epoch: 1 };
const owner = { ...guest, role: 'o' };
const SONG = { id: 'k6ngeWkYjI8', title: 'ลูกอม' };
async function setup(doc = { ...newRoomDoc('บ้าน'), current: { ...SONG, qid: 'playing' } }) {
  const store = createFileStore();
  await store.writeQueue(roomId, encodeRoomDoc(doc), 'null_etag');
  return store;
}
const read = async store => decodeRoomDoc((await store.readQueue(roomId)).text);
const run = (store, cmd, auth = guest, extra = {}) => runCommand({ store, auth, cmd, ...extra });

test('เขียนชนแล้วลองใหม่ เพลงเข้าคิวครบ', async () => {
  const store = await setup();
  let failures = 1;
  const flaky = { ...store, writeQueue: async (...a) => failures-- > 0 ? false : store.writeQueue(...a) };
  assert.equal((await run(flaky, { type: 'enqueue', song: SONG })).status, 200);
  assert.equal((await read(store)).queue.length, 1);
});
test('แขกสองคนเพิ่มพร้อมกันแล้วเพลงเข้าคิวทั้งสองเพลง', async () => {
  const store = await setup();
  const results = await Promise.all(['หนึ่ง', 'สอง'].map(title => run(store, { type: 'enqueue', song: { ...SONG, title } })));
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  const doc = await read(store);
  assert.deepEqual(doc.queue.map(s => s.title).sort(), ['สอง', 'หนึ่ง'].sort());
  assert.equal(doc.rev, 2);
  assert.equal(new Set(doc.queue.map(s => s.qid)).size, 2);
});
test('ชนเกิน 5 รอบตอบ busy', async () => {
  const store = await setup();
  let writes = 0;
  const result = await run({ ...store, writeQueue: async () => { writes++; return false; } }, { type: 'enqueue', song: SONG });
  assert.deepEqual(result, { status: 503, body: { error: 'busy' } });
  assert.equal(writes, 5);
});
test('โทเคนของห้อง ก ไม่เปลี่ยนห้อง ข แม้คำสั่งระบุ roomId', async () => {
  const store = await setup();
  const other = 'BCDEFGHJKLMNPQRS';
  await store.writeQueue(other, encodeRoomDoc(newRoomDoc('อีกบ้าน')), 'null_etag');
  await run(store, { type: 'enqueue', song: SONG, roomId: other });
  assert.equal(decodeRoomDoc((await store.readQueue(other)).text).rev, 0);
  assert.equal((await read(store)).queue.length, 1);
});
test('โทเคนแขกหลัง rotateGuest ได้ stale_token', async () => {
  const store = await setup();
  assert.deepEqual(await run(store, { type: 'rotateGuest' }, owner), { status: 200, body: { ok: true, rev: 1 } });
  assert.deepEqual(await checkAccess({ store, auth: guest }), { ok: false, status: 401, error: 'stale_token' });
  assert.equal((await checkAccess({ store, auth: owner })).ok, true);
});
for (const type of ['clearQueue', 'clearHistory', 'report', 'rotateGuest']) {
  test(`แขกส่ง ${type} ได้ owner_only`, async () => {
    assert.deepEqual(await run(await setup(), { type, playerState: 'playing' }), { status: 403, body: { error: 'owner_only' } });
  });
}
test('ห้องถูกลบ ทุกคำสั่งได้ no_room', async () => {
  const store = await setup();
  await store.deleteRoom(roomId);
  for (const cmd of [{ type: 'enqueue', song: SONG }, { type: 'control', action: 'toggle' }, { type: 'report', playerState: 'idle' }]) {
    assert.deepEqual(await run(store, cmd, owner), { status: 404, body: { error: 'no_room' } });
  }
});
test('control เขียน p/c และไม่เปลี่ยน rev', async () => {
  const store = await setup();
  assert.deepEqual(await run(store, { type: 'control', action: 'toggle' }, guest, { now: () => 123 }), { status: 200, body: { ok: true, rev: 0 } });
  assert.deepEqual(store.readRoom(roomId).p, { c: { a: 'toggle', t: 123 } });
  assert.equal((await read(store)).rev, 0);
});
test('report เจ้าของเขียน p/s โดยไม่เปลี่ยน rev', async () => {
  const store = await setup();
  assert.equal((await run(store, { type: 'report', playerState: 'playing' }, owner)).status, 200);
  assert.equal(store.readRoom(roomId).p.s, 'playing');
  assert.equal((await read(store)).rev, 0);
});
test('คำสั่งที่ไม่เปลี่ยนสถานะไม่เรียก writeQueue', async () => {
  const store = await setup();
  const result = await run({ ...store, writeQueue: () => assert.fail('unexpected write') }, { type: 'remove', qid: 'missing' });
  assert.deepEqual(result, { status: 200, body: { ok: true, rev: 0 } });
});
test('enqueue ตอนคิวเต็มได้ queue_full', async () => {
  const store = await setup({ ...newRoomDoc('บ้าน'), queue: Array.from({ length: 200 }, (_, i) => ({ ...SONG, qid: String(i) })) });
  assert.deepEqual(await run(store, { type: 'enqueue', song: SONG }), { status: 409, body: { error: 'queue_full' } });
});
test('คำสั่งผิดรูปได้ bad_command', async () => {
  const store = await setup();
  for (const cmd of [null, [], {}, { type: 'unknown' }, { type: 'control', action: 'invalid' }, { type: 'report', playerState: 'invalid' }]) {
    assert.deepEqual(await run(store, cmd, owner), { status: 400, body: { error: 'bad_command' } });
  }
});
test('enqueue ห้องว่างคงพฤติกรรมเดิมให้เพลงแรกเป็น current', async () => {
  const store = await setup(newRoomDoc('บ้าน'));
  assert.equal((await run(store, { type: 'enqueue', song: SONG })).status, 200);
  const doc = await read(store);
  assert.equal(doc.current.id, SONG.id);
  assert.equal(doc.queue.length, 0);
  assert.equal(doc.name, 'บ้าน');
  assert.equal(doc.guestEpoch, 1);
});
test('retry ตรวจรอบโทเคนใหม่ก่อนเขียน', async () => {
  const store = await setup();
  let writes = 0;
  const wrapped = { ...store, writeQueue: async (...args) => {
    writes++;
    await run(store, { type: 'rotateGuest' }, owner);
    return store.writeQueue(...args);
  } };
  assert.deepEqual(await run(wrapped, { type: 'enqueue', song: SONG }), { status: 401, body: { error: 'stale_token' } });
  assert.equal(writes, 1);
});
test('store failures ไม่เผยรายละเอียด', async () => {
  for (const method of ['readQueue', 'writeQueue', 'writePlayer']) {
    const store = await setup();
    const broken = { ...store, [method]: async () => { throw new Error('secret connection string'); } };
    const cmd = method === 'writePlayer' ? { type: 'control', action: 'restart' } : { type: 'enqueue', song: SONG };
    assert.deepEqual(await run(broken, cmd), { status: 502, body: { error: 'store_failed' } });
  }
});
