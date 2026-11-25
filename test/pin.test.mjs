import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../lib/handlers.mjs';
import { createFileStore } from '../lib/store-file.mjs';
import { newRoomDoc, encodeRoomDoc } from '../lib/room-doc.mjs';
import { signToken, verifyToken } from '../lib/tokens.mjs';
import { JOIN_FAILS_PER_MINUTE, IDLE_MS, minuteOf } from '../lib/limits.mjs';

const roomId = 'ABCDEFGHJKLMNPQR', otherId = 'BCDEFGHJKLMNPQRS', secret = 'pin-test';
const value = response => JSON.parse(response.body);
const request = (body, token) => ({ method: 'POST', headers: {
  'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
}, body: JSON.stringify(body) });
function setup(options = {}) {
  const store = options.store ?? createFileStore();
  let time = 3_600_000, pin = 0;
  const handlers = createHandlers({ store, secret, adminKey: 'admin', origin: () => 'https://karaoke.test',
    now: () => time, makeRoomId: () => roomId, makePin: () => String(++pin).padStart(6, '0'),
    fetchImpl: () => assert.fail('unexpected network'), ...options });
  const token = (id = roomId, role = 'o', epoch = 1) => signToken(secret, { roomId: id, role, epoch });
  return { store, handlers, token, now: () => time, advance: ms => { time += ms; },
    create: () => handlers.rooms(request({ name: 'บ้าน' })),
    admin: body => handlers.admin(request(body, 'admin')),
    room: (bearer = token()) => handlers.room({ method: 'GET', headers: { authorization: `Bearer ${bearer}` } }),
    join: pin => handlers.join(request({ pin })),
    command: type => handlers.command(request({ type }, token())),
  };
}
const metaOf = async store => JSON.parse((await store.readMeta()).text);
async function setMeta(store, update) {
  const { text, etag } = await store.readMeta();
  assert.equal(await store.writeMeta(JSON.stringify({ createEnabled: true, hour: 0, creates: 0,
    ...(text === null ? {} : JSON.parse(text)), ...update }), etag), true);
}
const expectError = (response, status, error) => {
  assert.equal(response.status, status);
  assert.deepEqual(value(response), { error });
};
async function seed(f, id = roomId) {
  await f.store.writeQueue(id, encodeRoomDoc(newRoomDoc('บ้านเก่า', f.now())), 'null_etag');
}

test('PIN budget and clock-minute boundaries match the contract', () => {
  assert.equal(JOIN_FAILS_PER_MINUTE, 30);
  assert.equal(minuteOf(59_999), 0);
  assert.equal(minuteOf(60_000), 1);
});

test('public creation immediately assigns a six-digit PIN visible only to the owner', async () => {
  const f = setup();
  const created = await f.create();
  assert.equal(created.status, 200);
  const meta = await metaOf(f.store);
  assert.deepEqual(meta.pins, { '000001': roomId });
  const owner = await f.room(value(created).ownerToken);
  assert.equal(owner.status, 200);
  assert.match(value(owner).pin, /^\d{6}$/);
  assert.equal(value(owner).pin, '000001');
  const guest = await f.room(f.token(roomId, 'g'));
  assert.equal(guest.status, 200);
  assert.equal(Object.hasOwn(value(guest), 'pin'), false);
  assert.equal(Object.hasOwn(JSON.parse((await f.store.readQueue(roomId)).text), 'pin'), false);
});

test('correct PIN returns a usable guest token for that room and never counts a failure', async () => {
  const f = setup();
  await f.create();
  const before = await f.store.readMeta();
  const joined = await f.join('000001');
  assert.equal(joined.status, 200);
  assert.deepEqual(verifyToken(secret, value(joined).guestToken), { roomId, role: 'g', epoch: 1 });
  assert.equal(value(joined).name, 'บ้าน');
  assert.equal(value(joined).roomId, roomId);
  assert.deepEqual(value(await f.room(value(joined).guestToken)), { roomId, role: 'g', name: 'บ้าน' });
  assert.deepEqual(await f.store.readMeta(), before);
});

for (const pin of ['12345', 'abcdef', '๑๒๓๔๕๖', 123456, null, {}, '123456\n']) {
  test(`invalid PIN ${JSON.stringify(pin)} returns bad_pin without touching the store`, async () => {
    let touched = false;
    const f = setup({ store: new Proxy({}, { get() { touched = true; throw new Error('unexpected store'); } }) });
    expectError(await f.join(pin), 400, 'bad_pin');
    assert.equal(touched, false);
  });
}

test('join validates method, content type, JSON and advertised/actual body size before store access', async () => {
  let touched = false;
  const f = setup({ store: new Proxy({}, { get() { touched = true; throw new Error('unexpected store'); } }) });
  expectError(await f.handlers.join({ method: 'GET', headers: {} }), 405, 'method_not_allowed');
  expectError(await f.handlers.join({ ...request({}), headers: {} }), 415, 'bad_content_type');
  expectError(await f.handlers.join({ ...request({}), body: '{' }), 400, 'bad_command');
  expectError(await f.handlers.join({ ...request({}), body: 'ก'.repeat(5500) }), 413, 'too_large');
  const large = { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '20000' },
    get body() { assert.fail('oversized body read'); } };
  expectError(await f.handlers.join(large), 413, 'too_large');
  expectError(await f.handlers.join(request({})), 400, 'bad_pin');
  assert.equal(touched, false);
});

test('missing PIN returns no_such_pin and increases the current minute failure counter', async () => {
  const f = setup();
  expectError(await f.join('999999'), 404, 'no_such_pin');
  assert.deepEqual((await metaOf(f.store)).join, { minute: minuteOf(f.now()), fails: 1 });
  expectError(await f.join('999999'), 404, 'no_such_pin');
  assert.equal((await metaOf(f.store)).join.fails, 2);
});

test('after 30 failures even a correct PIN is blocked; the next minute permits it and resets failed attempts', async () => {
  const f = setup();
  await f.create();
  for (let n = 0; n < 30; n++) expectError(await f.join('999999'), 404, 'no_such_pin');
  const before = await f.store.readMeta();
  expectError(await f.join('000001'), 429, 'too_many_attempts');
  assert.deepEqual(await f.store.readMeta(), before);
  // Links and QR tokens remain usable while the PIN budget is exhausted.
  assert.equal((await f.room(f.token(roomId, 'g'))).status, 200);
  f.advance(59_999);
  expectError(await f.join('000001'), 429, 'too_many_attempts');
  f.advance(1);
  assert.equal((await f.join('000001')).status, 200);
  expectError(await f.join('999999'), 404, 'no_such_pin');
  assert.deepEqual((await metaOf(f.store)).join, { minute: minuteOf(f.now()), fails: 1 });
});

test('two rooms receive different PINs when the injected generator initially collides', async () => {
  const pins = ['000001', '000001', '000002'];
  let id = 0;
  const f = setup({ makePin: () => pins.shift(), makeRoomId: () => [roomId, otherId][id++] });
  assert.equal((await f.create()).status, 200);
  assert.equal((await f.create()).status, 200);
  assert.deepEqual((await metaOf(f.store)).pins, { '000001': roomId, '000002': otherId });
  assert.equal(pins.length, 0);
});

test('rotateGuest revokes the old PIN and tokens; the replacement signs the new guestEpoch', async () => {
  const f = setup();
  await f.create();
  const oldToken = value(await f.join('000001')).guestToken;
  assert.equal((await f.command('rotateGuest')).status, 200);
  expectError(await f.join('000001'), 404, 'no_such_pin');
  const next = await f.join('000002');
  assert.equal(next.status, 200);
  assert.deepEqual(verifyToken(secret, value(next).guestToken), { roomId, role: 'g', epoch: 2 });
  assert.equal((await f.room(value(next).guestToken)).status, 200);
  expectError(await f.room(oldToken), 401, 'stale_token');
  assert.deepEqual((await metaOf(f.store)).pins, { '000002': roomId });
});

for (const action of ['closeRoom', 'delete', 'expire-list', 'expire-create']) {
  test(`${action} removes the room PIN and it can no longer join`, async () => {
    const f = setup();
    await f.create();
    if (action === 'closeRoom') assert.equal((await f.command(action)).status, 200);
    if (action === 'delete') assert.equal((await f.admin({ action, roomId })).status, 200);
    if (action.startsWith('expire')) {
      f.advance(IDLE_MS + 1);
      assert.equal((await (action === 'expire-list' ? f.admin({ action: 'list' }) : f.create())).status, 200);
    }
    assert.equal(Object.hasOwn((await metaOf(f.store)).pins, '000001'), false);
    expectError(await f.join('000001'), 404, 'no_such_pin');
  });
}

test('legacy room and meta receive a stable PIN on the first owner read', async () => {
  const f = setup();
  await seed(f);
  await setMeta(f.store, { creates: 7 });
  const guestBefore = await f.store.readMeta();
  assert.equal((await f.room(f.token(roomId, 'g'))).status, 200);
  assert.deepEqual(await f.store.readMeta(), guestBefore);
  assert.equal(value(await f.room()).pin, '000001');
  const after = await f.store.readMeta();
  assert.equal(value(await f.room()).pin, '000001');
  assert.deepEqual(await f.store.readMeta(), after);
  assert.equal((await metaOf(f.store)).creates, 7);
  assert.deepEqual((await metaOf(f.store)).join, { minute: 0, fails: 0 });
});

test('setCreate and public/admin creation preserve PINs, join budget and extra meta keys', async () => {
  const f = setup({ makeRoomId: (() => { let i = 0; return () => [roomId, otherId][i++]; })() });
  await setMeta(f.store, { pins: { '555555': 'CDEFGHJKLMNPQRST' }, join: { minute: 60, fails: 8 }, extra: { retained: true } });
  assert.equal((await f.admin({ action: 'setCreate', enabled: false })).status, 200);
  assert.equal((await f.admin({ action: 'create', name: 'ผู้ดูแล' })).status, 200);
  assert.equal((await f.admin({ action: 'setCreate', enabled: true })).status, 200);
  assert.equal((await f.create()).status, 200);
  const meta = await metaOf(f.store);
  assert.deepEqual(meta.pins, { '555555': 'CDEFGHJKLMNPQRST', '000001': roomId, '000002': otherId });
  assert.deepEqual(meta.join, { minute: 60, fails: 8 });
  assert.deepEqual(meta.extra, { retained: true });
  assert.equal(meta.creates, 1);
});

for (const method of ['readMeta', 'writeMeta']) {
  test(`owner read still returns 200 with pin null when ${method} fails`, async () => {
    const store = createFileStore();
    const f = setup({ store: { ...store, [method]: async () => { throw new Error('private'); } } });
    await seed(f);
    const response = await f.room();
    assert.equal(response.status, 200);
    assert.equal(value(response).pin, null);
    assert.equal(typeof value(response).guestUrl, 'string');
  });
}

test('admin list includes assigned PINs and null for legacy rooms without creating a PIN', async () => {
  const f = setup();
  await f.admin({ action: 'create', name: 'ผู้ดูแล' });
  await seed(f, otherId);
  const response = await f.admin({ action: 'list' });
  assert.equal(response.status, 200);
  assert.deepEqual(value(response).rooms.map(({ roomId, pin }) => ({ roomId, pin })), [
    { roomId, pin: '000001' }, { roomId: otherId, pin: null },
  ]);
  assert.deepEqual((await metaOf(f.store)).pins, { '000001': roomId });
});

test('join detects an externally deleted room, releases its stale PIN and counts a failure', async () => {
  const f = setup();
  await f.create();
  await f.store.deleteRoom(roomId);
  expectError(await f.join('000001'), 404, 'no_such_pin');
  const meta = await metaOf(f.store);
  assert.deepEqual(meta.pins, {});
  assert.deepEqual(meta.join, { minute: minuteOf(f.now()), fails: 1 });
});

test('PIN generation stops after 20 collisions and creation succeeds with lazy retry available', async () => {
  let draws = 0, recover = false;
  const f = setup({ makePin: () => { draws++; return recover ? '000002' : '000001'; } });
  await setMeta(f.store, { pins: { '000001': otherId } });
  assert.equal((await f.create()).status, 200);
  assert.equal(draws, 20);
  assert.equal(value(await f.room()).pin, null);
  assert.equal(draws, 40);
  recover = true;
  assert.equal(value(await f.room()).pin, '000002');
});

test('PIN ETag conflicts retry at most five times and keep concurrent changes', async () => {
  const store = createFileStore();
  let writes = 0;
  const f = setup({ store: { ...store, writeMeta: async (...args) => {
    if (++writes === 1) await setMeta(store, { pins: { '000001': otherId }, extra: 'concurrent' });
    return store.writeMeta(...args);
  } } });
  await seed(f);
  assert.equal(value(await f.room()).pin, '000002');
  assert.equal(writes, 2);
  assert.deepEqual((await metaOf(store)).pins, { '000001': otherId, '000002': roomId });
  assert.equal((await metaOf(store)).extra, 'concurrent');
  let conflicts = 0;
  const blocked = setup({ store: { ...store, writeMeta: async () => { conflicts++; return false; } } });
  assert.equal(value(await blocked.room(blocked.token('CDEFGHJKLMNPQRST'))).error, 'no_room');
  await seed(blocked, 'CDEFGHJKLMNPQRST');
  assert.equal(value(await blocked.room(blocked.token('CDEFGHJKLMNPQRST'))).pin, null);
  assert.equal(conflicts, 5);
});

test('concurrent owner reads issue one stable PIN per room', async () => {
  const f = setup();
  await seed(f);
  const responses = await Promise.all([f.room(), f.room(), f.room()]);
  assert.deepEqual(responses.map(response => value(response).pin), ['000001', '000001', '000001']);
  assert.deepEqual((await metaOf(f.store)).pins, { '000001': roomId });
});

test('failure accounting retries ETags without losing a concurrent PIN or failure', async () => {
  const store = createFileStore();
  let writes = 0;
  const f = setup({ store: { ...store, writeMeta: async (...args) => {
    if (++writes === 1) await setMeta(store, { pins: { '000001': otherId }, join: { minute: 60, fails: 7 } });
    return store.writeMeta(...args);
  } } });
  expectError(await f.join('999999'), 404, 'no_such_pin');
  assert.equal(writes, 2);
  assert.deepEqual((await metaOf(store)).pins, { '000001': otherId });
  assert.deepEqual((await metaOf(store)).join, { minute: 60, fails: 8 });
});

for (const failure of ['conflict', 'throw']) {
  test(`failed join accounting (${failure}) still returns 404 and stops within three writes`, async () => {
    const store = createFileStore();
    let writes = 0;
    const f = setup({ store: { ...store, writeMeta: async () => {
      writes++;
      if (failure === 'throw') throw new Error('private');
      return false;
    } } });
    expectError(await f.join('999999'), 404, 'no_such_pin');
    assert.equal(writes, failure === 'throw' ? 1 : 3);
  });
}

test('join fails closed with store_failed when the PIN index cannot be read', async () => {
  const f = setup({ store: { readMeta: async () => { throw new Error('private'); } } });
  expectError(await f.join('000001'), 502, 'store_failed');
});

for (const action of ['create', 'admin-create']) {
  test(`${action} succeeds despite PIN metadata write failure`, async () => {
    const store = createFileStore();
    const f = setup({ store: { ...store, writeMeta: async (text, etag) => {
      if (Object.keys(JSON.parse(text).pins).length > 0) throw new Error('private');
      return store.writeMeta(text, etag);
    } } });
    const response = await (action === 'create' ? f.create() : f.admin({ action: 'create', name: 'บ้าน' }));
    assert.equal(response.status, 200);
    assert.notEqual((await store.readQueue(roomId)).text, null);
    assert.equal(value(await f.room()).pin, null);
  });
}

for (const action of ['closeRoom', 'delete', 'expire']) {
  test(`${action} succeeds even if PIN cleanup fails; stale PIN never grants access`, async () => {
    const store = createFileStore();
    let broken = false;
    const f = setup({ store: { ...store, writeMeta: async (...args) => {
      if (broken) throw new Error('private');
      return store.writeMeta(...args);
    } } });
    await f.create();
    broken = true;
    if (action === 'closeRoom') assert.equal((await f.command(action)).status, 200);
    if (action === 'delete') assert.equal((await f.admin({ action, roomId })).status, 200);
    if (action === 'expire') {
      f.advance(IDLE_MS + 1);
      assert.equal((await f.admin({ action: 'list' })).status, 200);
    }
    assert.equal((await store.readQueue(roomId)).text, null);
    expectError(await f.join('000001'), 404, 'no_such_pin');
    broken = false;
    expectError(await f.join('000001'), 404, 'no_such_pin');
    assert.deepEqual((await metaOf(store)).pins, {});
  });
}
