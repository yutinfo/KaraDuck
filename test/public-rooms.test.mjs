import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHandlers } from '../lib/handlers.mjs';
import { createFileStore } from '../lib/store-file.mjs';
import { newRoomDoc, encodeRoomDoc, decodeRoomDoc } from '../lib/room-doc.mjs';
import { signToken } from '../lib/tokens.mjs';
import { MAX_ROOMS, CREATES_PER_HOUR, IDLE_MS, SEARCHES_PER_HOUR, hourOf } from '../lib/limits.mjs';

const sample = JSON.parse(await readFile(new URL('./fixtures/search-sample.json', import.meta.url), 'utf8'));
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const idOf = n => 'A'.repeat(14) + alphabet[Math.floor(n / alphabet.length)] + alphabet[n % alphabet.length];
const secret = 'public-rooms-test';
const limits = { maxRooms: 30, createsPerHour: 20, idleHours: 24, searchesPerHour: 120 };
const value = response => JSON.parse(response.body);
const request = (endpoint, { body, token, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) => ({
  method, url: `/api/${endpoint}`, headers: { 'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body),
});
function setup(options = {}) {
  const store = options.store ?? createFileStore(); // No file: in-memory implementation with real ETags.
  let time = 10 * 3_600_000, next = 100, fetches = 0;
  const handlers = createHandlers({ store, secret, adminKey: 'admin', mode: 'local', dbUrl: '/local-db',
    origin: () => 'https://karaoke.test', referer: () => 'https://karaoke.test/', now: () => time,
    makeRoomId: () => idOf(next++), fetchImpl: async () => { fetches++; return { ok: true, json: async () => sample }; }, ...options });
  const call = (endpoint, args) => handlers[endpoint](request(endpoint, args));
  return { store, call, handlers, now: () => time, advance: ms => { time += ms; }, fetches: () => fetches,
    create: (name = 'บ้าน') => call('rooms', { body: { name } }),
    admin: body => call('admin', { body, token: 'admin' }),
    token: (roomId, role = 'o', epoch = 1) => signToken(secret, { roomId, role, epoch }),
  };
}
async function seed(f, count, at = f.now()) {
  for (let n = 0; n < count; n++) await f.store.writeQueue(idOf(n), encodeRoomDoc(newRoomDoc(`ห้อง ${n}`, at)), 'null_etag');
}
async function expectError(response, status, error) {
  assert.equal(response.status, status);
  assert.deepEqual(value(response), { error });
}

test('limits and clock-hour boundaries match the public contract', () => {
  assert.deepEqual([MAX_ROOMS, CREATES_PER_HOUR, IDLE_MS, SEARCHES_PER_HOUR], [30, 20, 86400000, 120]);
  assert.equal(hourOf(3599999), 0);
  assert.equal(hourOf(3600000), 1);
});

test('public creation requires no token, trims the name and returns a usable owner token', async () => {
  const f = setup();
  const response = await f.create(' บ้านใหม่ ');
  assert.equal(response.status, 200);
  const created = value(response);
  assert.deepEqual(Object.keys(created).sort(), ['roomId', 'name', 'ownerToken', 'ownerUrl'].sort());
  assert.equal(created.name, 'บ้านใหม่');
  assert.equal(created.ownerUrl, `https://karaoke.test/#o=${created.ownerToken}`);
  const room = await f.call('room', { token: created.ownerToken });
  assert.equal(room.status, 200);
  assert.equal(value(room).role, 'o');
  const doc = decodeRoomDoc((await f.store.readQueue(created.roomId)).text);
  assert.equal(doc.createdAt, f.now());
  assert.equal(doc.updatedAt, f.now());
});

test('empty, missing or overlong names return bad_name before switch/store checks', async () => {
  const f = setup({ createDisabled: true, store: new Proxy({}, { get() { assert.fail('store before name'); } }) });
  for (const name of ['', ' ', 'ก'.repeat(41), null, 42]) await expectError(await f.create(name), 400, 'bad_name');
  await expectError(await f.call('rooms', { body: {} }), 400, 'bad_name');
  await expectError(await f.call('rooms', { body: null }), 400, 'bad_name');
});

test('public route checks method, JSON content type, byte size and malformed JSON before name', async () => {
  const f = setup({ createDisabled: true });
  await expectError(await f.call('rooms'), 405, 'method_not_allowed');
  await expectError(await f.handlers.rooms({ ...request('rooms', { body: {} }), headers: {} }), 415, 'bad_content_type');
  await expectError(await f.handlers.rooms({ ...request('rooms', { body: {} }), body: '{' }), 400, 'bad_command');
  await expectError(await f.handlers.rooms({ ...request('rooms', { body: {} }), body: 'ก'.repeat(5462) }), 413, 'too_large');
  await expectError(await f.handlers.rooms({ method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '20000' },
    get body() { assert.fail('oversized body read'); } }), 413, 'too_large');
});

test('30 active rooms returns rooms_full before the hourly limit and does not charge meta', async () => {
  const f = setup();
  await seed(f, 30);
  await f.store.writeMeta(JSON.stringify({ createEnabled: true, hour: hourOf(f.now()), creates: 20 }), 'null_etag');
  await expectError(await f.create(), 503, 'rooms_full');
  assert.equal(JSON.parse((await f.store.readMeta()).text).creates, 20);
});

test('20 public creates exhaust the hour; the next clock hour permits another room', async () => {
  const f = setup();
  for (let n = 0; n < 20; n++) assert.equal((await f.create()).status, 200);
  await expectError(await f.create(), 429, 'too_many_rooms');
  f.advance(3_600_000);
  assert.equal((await f.create()).status, 200);
  assert.deepEqual(JSON.parse((await f.store.readMeta()).text), { createEnabled: true, hour: hourOf(f.now()), creates: 1 });
});

test('expired rooms and usage are collected before the room count on public creation', async () => {
  const f = setup();
  await seed(f, 30);
  await f.store.writeUsage(idOf(0), JSON.stringify({ hour: 0, searches: 1 }));
  f.advance(IDLE_MS + 1);
  assert.equal((await f.create()).status, 200);
  assert.equal((await f.store.listRooms()).length, 1);
  assert.equal((await f.store.readQueue(idOf(0))).text, null);
  assert.equal(await f.store.readUsage(idOf(0)), null);
});

test('updatedAt zero survives 30 days and an old token still accesses the legacy room', async () => {
  const f = setup();
  const legacy = newRoomDoc('บ้านเก่า');
  delete legacy.createdAt;
  delete legacy.updatedAt;
  await f.store.writeQueue(idOf(0), JSON.stringify(legacy), 'null_etag');
  f.advance(30 * 86400000);
  assert.equal((await f.create()).status, 200);
  assert.equal((await f.call('room', { token: f.token(idOf(0)) })).status, 200);
  const doc = decodeRoomDoc((await f.store.readQueue(idOf(0))).text);
  assert.equal(doc.updatedAt, 0);
  assert.equal(doc.createdAt, 0);
});

test('expiration is strictly greater than 24 hours', async () => {
  const f = setup();
  await seed(f, 1);
  f.advance(IDLE_MS);
  assert.equal(value(await f.admin({ action: 'list' })).rooms.length, 1);
  f.advance(1);
  assert.equal(value(await f.admin({ action: 'list' })).rooms.length, 0);
});

test('one failed deletion does not prevent cleanup of other rooms or public creation', async () => {
  const store = createFileStore();
  const f = setup({ store: { ...store, deleteRoom: async id => { if (id === idOf(0)) throw new Error('offline'); await store.deleteRoom(id); } } });
  await seed(f, 2);
  f.advance(IDLE_MS + 1);
  assert.equal((await f.create()).status, 200);
  assert.notEqual((await store.readQueue(idOf(0))).text, null);
  assert.equal((await store.readQueue(idOf(1))).text, null);
  assert.equal((await f.admin({ action: 'list' })).status, 200);
});

test('setCreate false blocks public creation and config reports false after cache expiry', async () => {
  const f = setup();
  assert.equal(value(await f.call('config')).createEnabled, true);
  assert.deepEqual(value(await f.admin({ action: 'setCreate', enabled: false })), { createEnabled: false });
  await expectError(await f.create(), 403, 'create_disabled');
  f.advance(30_000);
  assert.equal(value(await f.call('config')).createEnabled, false);
  assert.deepEqual(value(await f.admin({ action: 'setCreate', enabled: true })), { createEnabled: true });
  assert.equal((await f.create()).status, 200);
});

test('createDisabled forces 403 even when the database switch is enabled', async () => {
  const f = setup({ createDisabled: true });
  await f.admin({ action: 'setCreate', enabled: true });
  await expectError(await f.create(), 403, 'create_disabled');
  assert.equal(value(await f.call('config')).createEnabled, false);
  assert.equal(value(await f.admin({ action: 'list' })).createEnabled, false);
});

test('config caches for less than 30 seconds using injected time; unreadable meta fails closed', async () => {
  const store = createFileStore();
  let reads = 0, broken = false;
  const f = setup({ store: { ...store, readMeta: async () => { reads++; if (broken) throw new Error('offline'); return store.readMeta(); } } });
  assert.equal(value(await f.call('config')).createEnabled, true);
  await store.writeMeta(JSON.stringify({ createEnabled: false, hour: 0, creates: 0 }), 'null_etag');
  f.advance(29_999);
  assert.equal(value(await f.call('config')).createEnabled, true);
  assert.equal(reads, 1);
  f.advance(1);
  assert.equal(value(await f.call('config')).createEnabled, false);
  assert.equal(reads, 2);
  broken = true;
  f.advance(30_000);
  const response = await f.call('config');
  assert.equal(response.status, 200);
  assert.equal(value(response).createEnabled, false);
});

test('owner closeRoom deletes room and usage and returns closed true', async () => {
  const f = setup();
  await seed(f, 1);
  await f.store.writeUsage(idOf(0), '{"hour":0,"searches":3}');
  const response = await f.call('command', { body: { type: 'closeRoom' }, token: f.token(idOf(0)) });
  assert.equal(response.status, 200);
  assert.deepEqual(value(response), { ok: true, closed: true });
  assert.equal((await f.store.readQueue(idOf(0))).text, null);
  assert.equal(await f.store.readUsage(idOf(0)), null);
});

test('guest closeRoom returns owner_only without deleting the room', async () => {
  const f = setup();
  await seed(f, 1);
  await expectError(await f.call('command', { body: { type: 'closeRoom' }, token: f.token(idOf(0), 'g') }), 403, 'owner_only');
  assert.equal((await f.store.listRooms()).length, 1);
});

test('stale guest and owner tokens return stale_token before closeRoom permission checks', async () => {
  const f = setup();
  await f.store.writeQueue(idOf(0), encodeRoomDoc({ ...newRoomDoc('บ้าน', f.now()), ownerEpoch: 2, guestEpoch: 2 }), 'null_etag');
  for (const role of ['g', 'o']) await expectError(await f.call('command', { body: { type: 'closeRoom' }, token: f.token(idOf(0), role) }), 401, 'stale_token');
  assert.equal((await f.store.listRooms()).length, 1);
});

test('search 121 is blocked without fetching; the next hour resets the room budget', async () => {
  const f = setup();
  await seed(f, 1);
  const token = f.token(idOf(0), 'g');
  for (let n = 0; n < 120; n++) assert.equal((await f.handlers.search(request(`search?q=song${n}`, { token }))).status, 200);
  assert.equal(f.fetches(), 120);
  await expectError(await f.handlers.search(request('search?q=blocked', { token })), 429, 'search_budget');
  assert.equal(f.fetches(), 120);
  f.advance(3_600_000);
  assert.equal((await f.handlers.search(request('search?q=next-hour', { token }))).status, 200);
  assert.equal(f.fetches(), 121);
  assert.deepEqual(JSON.parse(await f.store.readUsage(idOf(0))), { hour: hourOf(f.now()), searches: 1 });
});

for (const method of ['readUsage', 'writeUsage']) test(`${method} failure allows searching`, async () => {
  const store = createFileStore();
  const f = setup({ store: { ...store, [method]: async () => { throw new Error('offline'); } } });
  await seed(f, 1);
  assert.equal((await f.handlers.search(request('search?q=song', { token: f.token(idOf(0)) }))).status, 200);
  assert.equal(f.fetches(), 1);
});

test('search counts cached and malformed queries only after successful authorization; embeddable never counts', async () => {
  const f = setup({ fetchImpl: async url => url.includes('/embed/') ? new Response('{"previewPlayabilityStatus":{"status":"OK"}}') : { ok: true, json: async () => sample } });
  await seed(f, 2);
  await expectError(await f.handlers.search(request('search?q=song')), 401, 'bad_token');
  await expectError(await f.handlers.search(request('search?q=song', { token: f.token(idOf(0), 'g', 2) })), 401, 'stale_token');
  assert.equal(await f.store.readUsage(idOf(0)), null);
  const token = f.token(idOf(0));
  for (let i = 0; i < 2; i++) assert.equal((await f.handlers.search(request('search?q=song', { token }))).status, 200);
  await expectError(await f.handlers.search(request('search?q=', { token })), 400, 'missing_query');
  assert.equal((await f.handlers.embeddable(request('embeddable?ids=k6ngeWkYjI8', { token }))).status, 200);
  assert.equal(JSON.parse(await f.store.readUsage(idOf(0))).searches, 3);
  assert.equal(await f.store.readUsage(idOf(1)), null);
});

test('admin list collects expired rooms and includes limits, switch, timestamps and current title', async () => {
  const f = setup();
  await seed(f, 1, 1);
  f.advance(IDLE_MS);
  await f.store.writeQueue(idOf(1), encodeRoomDoc({ ...newRoomDoc('ยังอยู่', f.now()), current: { id: 'k6ngeWkYjI8', title: 'ลูกอม', qid: 'current' } }), 'null_etag');
  const response = await f.admin({ action: 'list' });
  assert.equal(response.status, 200);
  assert.deepEqual(value(response), { createEnabled: true, limits, rooms: [{ roomId: idOf(1), name: 'ยังอยู่', rev: 0, queueLength: 0,
    current: 'ลูกอม', createdAt: f.now(), updatedAt: f.now() }] });
});

test('admin create bypasses room count, hourly ceiling and creation switch and stamps time', async () => {
  const f = setup({ createDisabled: true });
  await seed(f, 30);
  await f.store.writeMeta(JSON.stringify({ createEnabled: false, hour: hourOf(f.now()), creates: 20 }), 'null_etag');
  const response = await f.admin({ action: 'create', name: ' ห้องผู้ดูแล ' });
  assert.equal(response.status, 200);
  const doc = decodeRoomDoc((await f.store.readQueue(value(response).roomId)).text);
  assert.equal(doc.name, 'ห้องผู้ดูแล');
  assert.equal(doc.createdAt, f.now());
  assert.equal(doc.updatedAt, f.now());
  assert.equal((await f.store.listRooms()).length, 31);
  assert.equal(JSON.parse((await f.store.readMeta()).text).creates, 20);
});

test('public create retries meta ETag conflicts and commits meta before the room', async () => {
  const store = createFileStore();
  let writes = 0, queueWrites = 0;
  const f = setup({ store: { ...store, writeMeta: async (...args) => ++writes < 3 ? false : store.writeMeta(...args),
    writeQueue: async (...args) => { queueWrites++; assert.equal(JSON.parse((await store.readMeta()).text).creates, 1); return store.writeQueue(...args); } } });
  assert.equal((await f.create()).status, 200);
  assert.equal(writes, 3);
  assert.equal(queueWrites, 1);
});

for (const action of ['create', 'setCreate']) test(`${action} stops after 5 meta conflicts with busy`, async () => {
  const store = createFileStore();
  let writes = 0;
  const f = setup({ store: { ...store, writeMeta: async () => { writes++; return false; } } });
  await expectError(await (action === 'create' ? f.create() : f.admin({ action, enabled: false })), 503, 'busy');
  assert.equal(writes, 5);
  assert.deepEqual(await store.listRooms(), []);
});

test('setCreate retries preserve concurrent counter changes and requires a boolean', async () => {
  const store = createFileStore();
  let writes = 0;
  const f = setup({ store: { ...store, writeMeta: async (...args) => {
    if (++writes === 1) await store.writeMeta(JSON.stringify({ createEnabled: true, hour: 10, creates: 7 }), 'null_etag');
    return store.writeMeta(...args);
  } } });
  await expectError(await f.admin({ action: 'setCreate', enabled: 'false' }), 400, 'bad_command');
  assert.equal((await f.admin({ action: 'setCreate', enabled: false })).status, 200);
  assert.equal(writes, 2);
  assert.deepEqual(JSON.parse((await store.readMeta()).text), { createEnabled: false, hour: 10, creates: 7 });
});

test('concurrent public requests do not exceed the hourly allowance', async () => {
  const f = setup();
  await f.store.writeMeta(JSON.stringify({ createEnabled: true, hour: hourOf(f.now()), creates: 19 }), 'null_etag');
  const responses = await Promise.all([f.create(), f.create()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 429]);
  assert.equal(JSON.parse((await f.store.readMeta()).text).creates, 20);
});
