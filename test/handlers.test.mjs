import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../lib/handlers.mjs';
import { createFileStore } from '../lib/store-file.mjs';
import { newRoomDoc, encodeRoomDoc, decodeRoomDoc } from '../lib/room-doc.mjs';
import { signToken, verifyToken } from '../lib/tokens.mjs';

const roomId = 'ABCDEFGHJKLMNPQR', secret = 'secret';
const token = role => signToken(secret, { roomId, role, epoch: 1 });
const auth = role => ({ authorization: `Bearer ${token(role)}` });
const value = r => JSON.parse(r.body);
async function setup(options = {}) {
  const store = createFileStore();
  await store.writeQueue(roomId, encodeRoomDoc(newRoomDoc('บ้าน')), 'null_etag');
  return { store, handlers: createHandlers({ store, secret, adminKey: 'admin', mode: 'cloud', dbUrl: 'https://example.firebasedatabase.app', origin: () => 'https://karaoke.test', referer: () => 'https://karaoke.test/', fetchImpl: () => assert.fail('unexpected fetch'), ...options }) };
}
function request(endpoint, { role = 'g', method = 'GET', body, ...extra } = {}) {
  return { method, url: `/api/${endpoint}`, headers: { ...auth(role), 'content-type': 'application/json' }, body: JSON.stringify(body), ...extra };
}
const adminReq = body => request('admin', { method: 'POST', body, headers: { authorization: 'Bearer admin', 'content-type': 'application/json' } });

test('ไม่มีโทเคนทุก protected handler ได้ bad_token ก่อนอ่าน body หรือเรียก store/fetch', async () => {
  const { handlers } = await setup({ store: new Proxy({}, { get() { assert.fail('store touched'); } }) });
  for (const name of ['room', 'command', 'search', 'embeddable']) {
    const req = { method: 'POST', url: `/api/${name}`, headers: {}, get body() { assert.fail('body touched'); } };
    const r = await handlers[name](req);
    assert.equal(r.status, 401);
    assert.deepEqual(value(r), { error: 'bad_token' });
  }
});
test('store.readQueue โยนได้ store_failed', async () => {
  const { handlers } = await setup({ store: { readQueue: async () => { throw new Error('secret'); } } });
  for (const name of ['room', 'command', 'search', 'embeddable']) {
    const r = await handlers[name](request(name, { method: name === 'command' ? 'POST' : 'GET', body: { type: 'clearQueue' } }));
    assert.equal(r.status, 502);
    assert.deepEqual(value(r), { error: 'store_failed' });
  }
});
test('room ของแขกไม่มี guestUrl', async () => {
  const { handlers } = await setup();
  assert.deepEqual(value(await handlers.room(request('room'))), { roomId, name: 'บ้าน', role: 'g' });
});
test('room เจ้าของมี guestUrl โทเคนบทบาท g และ QR', async () => {
  const { handlers } = await setup();
  const r = value(await handlers.room(request('room', { role: 'o' })));
  assert.deepEqual(verifyToken(secret, new URL(r.guestUrl).hash.slice(3)), { roomId, role: 'g', epoch: 1 });
  assert.match(r.qrSvg, /<svg/);
});
test('guestUrl ยาวเกิน QR ได้ qrSvg null', async () => {
  const { handlers } = await setup({ origin: () => `https://${'a'.repeat(150)}.test` });
  const r = value(await handlers.room(request('room', { role: 'o' })));
  assert.equal(typeof r.guestUrl, 'string');
  assert.equal(r.qrSvg, null);
});
test('admin สร้างห้อง ownerUrl เรียก room ได้', async () => {
  const nextId = 'BCDEFGHJKLMNPQRS';
  const { handlers } = await setup({ makeRoomId: () => nextId });
  const created = await handlers.admin(adminReq({ action: 'create', name: ' บ้านใหม่ ' }));
  assert.equal(created.status, 200);
  const data = value(created);
  assert.equal(data.roomId, nextId);
  const r = await handlers.room(request('room', { headers: { authorization: `Bearer ${new URL(data.ownerUrl).hash.slice(3)}` } }));
  assert.deepEqual({ ...value(r), guestUrl: undefined, qrSvg: undefined }, { roomId: nextId, name: 'บ้านใหม่', role: 'o', guestUrl: undefined, qrSvg: undefined });
});
test('rotateOwner ทำให้ลิงก์เก่าได้ stale_token และลิงก์ใหม่ใช้ได้', async () => {
  const { handlers } = await setup();
  const rotated = value(await handlers.admin(adminReq({ action: 'rotateOwner', roomId })));
  assert.equal((await handlers.room(request('room', { role: 'o' }))).status, 401);
  const claims = verifyToken(secret, new URL(rotated.ownerUrl).hash.slice(3));
  assert.deepEqual(claims, { roomId, role: 'o', epoch: 2 });
  assert.equal((await handlers.room(request('room', { headers: { authorization: `Bearer ${new URL(rotated.ownerUrl).hash.slice(3)}` } }))).status, 200);
});
test('search ไม่มีโทเคนไม่เรียก fetchImpl', async () => {
  let calls = 0;
  const { handlers } = await setup({ fetchImpl: () => { calls++; assert.fail('fetch'); } });
  assert.equal((await handlers.search(request('search?q=test', { headers: {} }))).status, 401);
  assert.equal(calls, 0);
});
test('config ไม่ต้องมีโทเคนและไม่มี CORS', async () => {
  const { handlers } = await setup();
  const r = await handlers.config({ method: 'GET', headers: {}, get body() { assert.fail('body'); } });
  assert.deepEqual(value(r), { mode: 'cloud', db: 'https://example.firebasedatabase.app', origin: 'https://karaoke.test' });
  assert.equal(Object.keys(r.headers).some(k => /access-control/i.test(k)), false);
});
test('command ตรวจ method, content type, byte limit และ JSON', async () => {
  const { handlers } = await setup();
  for (const [extra, status, error] of [
    [{ method: 'GET' }, 405, 'method_not_allowed'],
    [{ headers: auth('g') }, 415, 'bad_content_type'],
    [{ body: 'ก'.repeat(5462) }, 413, 'too_large'],
    [{ body: '{' }, 400, 'bad_command'],
  ]) {
    const r = await handlers.command({ ...request('command', { method: 'POST' }), ...extra });
    assert.equal(r.status, status);
    assert.deepEqual(value(r), { error });
  }
});
test('admin disabled และกุญแจผิดถูกปฏิเสธก่อนอ่าน body/store', async () => {
  for (const adminKey of ['', 'admin']) {
    const { handlers } = await setup({ adminKey, store: new Proxy({}, { get() { assert.fail('store'); } }) });
    const r = await handlers.admin({ method: 'POST', headers: { authorization: 'Bearer incorrect' }, get body() { assert.fail('body'); } });
    assert.equal(r.status, adminKey ? 401 : 503);
    assert.deepEqual(value(r), { error: adminKey ? 'bad_admin_key' : 'admin_disabled' });
  }
});
test('admin list/delete และชื่อ/action/roomId ที่ผิดรูป', async () => {
  const { handlers } = await setup();
  assert.deepEqual(value(await handlers.admin(adminReq({ action: 'list' }))), { rooms: [{ roomId, name: 'บ้าน', rev: 0, queueLength: 0 }] });
  for (const body of [{ action: 'create', name: ' ' }, { action: 'wrong' }, { action: 'delete', roomId: '../bad' }]) {
    assert.equal((await handlers.admin(adminReq(body))).status, 400);
  }
  assert.deepEqual(value(await handlers.admin(adminReq({ action: 'delete', roomId }))), { ok: true });
  assert.equal((await handlers.room(request('room'))).status, 404);
  assert.equal((await handlers.command(request('command', { method: 'POST', body: { type: 'control', action: 'toggle' } }))).status, 404);
});
test('searchDisabled ปิดทั้ง search/embeddable หลังตรวจห้อง', async () => {
  const { handlers, store } = await setup({ searchDisabled: true });
  for (const name of ['search', 'embeddable']) {
    assert.deepEqual(value(await handlers[name](request(name))), { error: 'search_disabled' });
  }
  await store.deleteRoom(roomId);
  assert.equal((await handlers.search(request('search'))).status, 404);
});
test('embeddable ตรวจ ids และส่ง referer ที่กำหนด', async () => {
  let calls = 0;
  const { handlers } = await setup({ fetchImpl: async (url, options) => {
    calls++;
    assert.equal(options.headers.Referer, 'https://karaoke.test/');
    return new Response('"preview": {"status":"OK"}');
  } });
  for (const ids of ['', 'bad', Array.from({ length: 31 }, (_, i) => String(i).padStart(11, '0')).join(',')]) {
    const r = await handlers.embeddable(request(`embeddable?ids=${ids}`));
    assert.deepEqual(value(r), { error: 'bad_ids' });
  }
  assert.equal(calls, 0);
  assert.deepEqual(value(await handlers.embeddable(request('embeddable?ids=k6ngeWkYjI8'))), { k6ngeWkYjI8: null });
  assert.equal(calls, 1);
});
test('search คงรหัส missing_query/upstream_failed และไม่แคชความล้มเหลว', async () => {
  let calls = 0;
  const { handlers } = await setup({ fetchImpl: async () => { calls++; throw new Error('private'); } });
  assert.deepEqual(value(await handlers.search(request('search?q=%20'))), { error: 'missing_query' });
  assert.equal(calls, 0);
  for (let i = 0; i < 2; i++) {
    const r = await handlers.search(request('search?q=test'));
    assert.equal(r.status, 502);
    assert.deepEqual(value(r), { error: 'upstream_failed' });
  }
  assert.equal(calls, 2);
});
test('admin rotateOwner retry ไม่ทับคำสั่งที่เขียนพร้อมกัน', async () => {
  const { store } = await setup();
  let conflict = true;
  const wrapped = { ...store, writeQueue: async (...args) => {
    if (conflict) {
      conflict = false;
      const old = await store.readQueue(roomId);
      const doc = decodeRoomDoc(old.text);
      await store.writeQueue(roomId, encodeRoomDoc({ ...doc, name: 'ชื่อใหม่', rev: doc.rev + 1 }), old.etag);
    }
    return store.writeQueue(...args);
  } };
  const { handlers } = await setup({ store: wrapped });
  assert.equal((await handlers.admin(adminReq({ action: 'rotateOwner', roomId }))).status, 200);
  const doc = decodeRoomDoc((await store.readQueue(roomId)).text);
  assert.equal(doc.name, 'ชื่อใหม่');
  assert.equal(doc.rev, 2);
  assert.equal(doc.ownerEpoch, 2);
});
