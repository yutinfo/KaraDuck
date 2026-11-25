import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStreamEvent,
  toSnapshot,
  controlStamp,
  createControlGate,
} from '../public/js/room-merge.js';
import { createSync } from '../public/js/sync.js';

const SONG = {
  id: 'dQw4w9WgXcQ',
  qid: 'q-1',
  title: 'Test Song',
  channel: 'Test Channel',
  duration: '3:32',
  durationSec: 212,
  thumbnail: '',
};

const Q_JSON = JSON.stringify({
  rev: 3,
  name: 'บ้านใหญ่',
  guestEpoch: 2,
  ownerEpoch: 4,
  current: SONG,
  queue: [],
  history: [],
});

const Q_IDLE_JSON = JSON.stringify({
  rev: 1,
  name: 'บ้านใหญ่',
  guestEpoch: 2,
  ownerEpoch: 4,
  current: null,
  queue: [],
  history: [],
});

const ROOM_ID = 'ABCDEFGHJKLMNPQR';
const SIG = 'a'.repeat(22);
const GUEST_TOKEN = `${ROOM_ID}.g2.${SIG}`;
const OWNER_TOKEN = `${ROOM_ID}.o4.${SIG}`;

test('put ที่ / แล้ว put ที่ /p/c', () => {
  let room = applyStreamEvent(null, 'put', { path: '/', data: { q: Q_JSON, p: { s: 'playing' } } });
  const next = applyStreamEvent(room, 'put', { path: '/p/c', data: { a: 'toggle', t: 5 } });
  assert.equal(controlStamp(next), 5);
  assert.equal(controlStamp(room), null);
  assert.equal(toSnapshot(next).playerState, 'playing');
});

test('ห้องถูกลบ', () => {
  assert.equal(applyStreamEvent({ q: Q_JSON }, 'put', { path: '/', data: null }), null);
});

test('ไม่มีเพลงปัจจุบัน playerState เป็น idle', () => {
  const room = applyStreamEvent(null, 'put', { path: '/', data: { q: Q_IDLE_JSON, p: { s: 'playing' } } });
  const snap = toSnapshot(room);
  assert.equal(snap.current, null);
  assert.equal(snap.playerState, 'idle');
});

test('ต่อใหม่แล้วไม่ทำคำสั่งควบคุมย้อนหลัง', () => {
  const gate = createControlGate();
  const at = (t) => ({ q: Q_JSON, p: { c: { a: 'toggle', t } } });
  gate.opened();
  assert.equal(gate.next(at(5)), null);
  assert.equal(gate.next(at(9)), 'toggle');
  assert.equal(gate.next(at(9)), null);
  gate.opened();
  assert.equal(gate.next(at(12)), null);
  assert.equal(gate.next(at(15)), 'toggle');
});

test('patch ที่ /p รวมคีย์โดยไม่แก้วัตถุเดิม', () => {
  const room = applyStreamEvent(null, 'put', { path: '/', data: { q: Q_JSON, p: { s: 'playing' } } });
  const patched = applyStreamEvent(room, 'patch', {
    path: '/p',
    data: { c: { a: 'restart', t: 42 } },
  });
  assert.equal(room.p.c, undefined);
  assert.equal(patched.p.s, 'playing');
  assert.deepEqual(patched.p.c, { a: 'restart', t: 42 });
  assert.equal(controlStamp(patched), 42);
});

test('put ที่ /q, /p, /p/s อัปเดตเฉพาะตำแหน่งนั้นโดยไม่แก้วัตถุเดิม', () => {
  const room = applyStreamEvent(null, 'put', { path: '/', data: { q: Q_IDLE_JSON, p: { s: 'idle' } } });
  const withQ = applyStreamEvent(room, 'put', { path: '/q', data: Q_JSON });
  const withS = applyStreamEvent(withQ, 'put', { path: '/p/s', data: 'paused' });
  const withP = applyStreamEvent(withS, 'put', { path: '/p', data: { s: 'buffering' } });

  assert.equal(toSnapshot(room).rev, 1);
  assert.equal(toSnapshot(withQ).rev, 3);
  assert.equal(toSnapshot(withS).playerState, 'paused');
  assert.equal(toSnapshot(withP).playerState, 'buffering');
});

test('toSnapshot คืน guestEpoch และ ownerEpoch จาก q และคืน null เมื่อ q ไม่ถูกต้อง', () => {
  const snap = toSnapshot({ q: Q_JSON, p: { s: 'playing' } });
  assert.equal(snap.rev, 3);
  assert.equal(snap.name, 'บ้านใหญ่');
  assert.equal(snap.guestEpoch, 2);
  assert.equal(snap.ownerEpoch, 4);
  assert.equal(snap.current.id, SONG.id);
  assert.equal(snap.playerState, 'playing');

  assert.equal(toSnapshot(null), null);
  assert.equal(toSnapshot({}), null);
  assert.equal(toSnapshot({ q: 'not-json' }), null);
  assert.equal(toSnapshot({ q: '[]' }), null);
  assert.equal(toSnapshot({ q: '{"rev":-1,"guestEpoch":1,"ownerEpoch":1}' }), null);
  assert.equal(toSnapshot({ q: '{"rev":0,"guestEpoch":0,"ownerEpoch":1}' }), null);
});

function createFakeEventSourceClass() {
  const instances = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      this.listeners = new Map();
      this.onopen = null;
      this.onerror = null;
      instances.push(this);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    emit(type, data) {
      const list = this.listeners.get(type) || [];
      for (const fn of list) fn({ data });
    }
    close() {
      this.closed = true;
    }
  }
  return { FakeEventSource, instances };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('sync.start fetches config and room, opens EventSource, handles put/patch/control/reconnect', async () => {
  const origFetch = globalThis.fetch;
  const origES = globalThis.EventSource;
  const { FakeEventSource, instances } = createFakeEventSourceClass();
  const fetched = [];

  globalThis.EventSource = FakeEventSource;
  globalThis.fetch = async (url, options = {}) => {
    fetched.push({ url, options });
    if (url === '/api/config') {
      return { status: 200, async json() { return { mode: 'local', db: '/local-db', origin: 'http://localhost:8792' }; } };
    }
    if (url === '/api/room') {
      return { status: 200, async json() { return { roomId: ROOM_ID, name: 'บ้านใหญ่', role: 'o', guestUrl: 'http://x', qrSvg: '<svg/>' }; } };
    }
    if (url === '/api/command') {
      return { status: 200, async json() { return { ok: true, rev: 4 }; } };
    }
    throw new Error(`unexpected ${url}`);
  };

  try {
    const statuses = [];
    const rooms = [];
    const states = [];
    const controls = [];

    const sync = createSync({
      token: OWNER_TOKEN,
      roomId: ROOM_ID,
      onStatus: (s) => statuses.push(s),
      onRoom: (r) => rooms.push(r),
      onState: (s) => states.push(s),
      onControl: (a) => controls.push(a),
    });

    sync.start();
    await flushMicrotasks();

    assert.equal(fetched[0].url, '/api/config');
    assert.equal(fetched[1].url, '/api/room');
    assert.equal(fetched[1].options.headers.Authorization, `Bearer ${OWNER_TOKEN}`);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].name, 'บ้านใหญ่');

    assert.equal(instances.length, 1);
    const es = instances[0];
    assert.equal(es.url, `/local-db/rooms/${ROOM_ID}.json`);

    es.onopen?.();
    assert.deepEqual(statuses, ['online']);

    // Initial baseline put with existing control stamp should NOT fire onControl
    es.emit('put', JSON.stringify({ path: '/', data: { q: Q_JSON, p: { s: 'playing', c: { a: 'toggle', t: 5 } } } }));
    assert.equal(states.length, 1);
    assert.deepEqual(controls, []);

    // New control stamp fires onControl
    es.emit('put', JSON.stringify({ path: '/p/c', data: { a: 'restart', t: 10 } }));
    assert.deepEqual(controls, ['restart']);

    // keep-alive does nothing
    es.emit('keep-alive', 'null');
    assert.deepEqual(controls, ['restart']);

    // Reconnect: onopen resets baseline so stale command during disconnect is ignored
    es.onerror?.();
    assert.equal(statuses.at(-1), 'offline');
    es.onopen?.();
    es.emit('put', JSON.stringify({ path: '/', data: { q: Q_JSON, p: { s: 'playing', c: { a: 'toggle', t: 20 } } } }));
    assert.deepEqual(controls, ['restart']);

    // send uses Authorization header and no token in URL
    const res = await sync.send({ type: 'skip' });
    assert.deepEqual(res, { ok: true, rev: 4 });
    assert.equal(fetched[2].url, '/api/command');
    assert.equal(fetched[2].options.headers.Authorization, `Bearer ${OWNER_TOKEN}`);

    sync.stop();
    assert.equal(es.closed, true);
  } finally {
    globalThis.fetch = origFetch;
    globalThis.EventSource = origES;
  }
});

test('sync handles 401 bad_key, 404 gone, and 500 offline+EventSource during preflight', async () => {
  const origFetch = globalThis.fetch;
  const origES = globalThis.EventSource;

  for (const [roomStatus, expectedStatus, expectStream] of [
    [401, 'bad_key', false],
    [404, 'gone', false],
    [502, 'offline', true],
  ]) {
    const { FakeEventSource, instances } = createFakeEventSourceClass();
    globalThis.EventSource = FakeEventSource;
    globalThis.fetch = async (url) => {
      if (url === '/api/config') {
        return { status: 200, async json() { return { mode: 'cloud', db: 'https://demo.firebasedatabase.app/' }; } };
      }
      return { status: roomStatus, async json() { return { error: 'err' }; } };
    };

    try {
      const statuses = [];
      const sync = createSync({
        token: GUEST_TOKEN,
        roomId: ROOM_ID,
        onStatus: (s) => statuses.push(s),
      });
      sync.start();
      await flushMicrotasks();

      assert.deepEqual(statuses, [expectedStatus]);
      assert.equal(instances.length, expectStream ? 1 : 0);
      if (expectStream) {
        assert.equal(instances[0].url, `https://demo.firebasedatabase.app/rooms/${ROOM_ID}.json`);
      }
      sync.stop();
    } finally {
      globalThis.fetch = origFetch;
      globalThis.EventSource = origES;
    }
  }
});

test('sync detects epoch rotation, room deletion, cancel, and auth_revoked on live stream', async () => {
  const origFetch = globalThis.fetch;
  const origES = globalThis.EventSource;

  async function openConnectedSync(token) {
    const { FakeEventSource, instances } = createFakeEventSourceClass();
    globalThis.EventSource = FakeEventSource;
    globalThis.fetch = async (url) => {
      if (url === '/api/config') {
        return { status: 200, async json() { return { mode: 'local', db: '/local-db' }; } };
      }
      return { status: 200, async json() { return { roomId: ROOM_ID, name: 'บ้านใหญ่', role: 'g' }; } };
    };
    const statuses = [];
    const sync = createSync({
      token,
      roomId: ROOM_ID,
      onStatus: (s) => statuses.push(s),
    });
    sync.start();
    await flushMicrotasks();
    const es = instances[0];
    es.onopen?.();
    return { sync, es, statuses };
  }

  try {
    // 1. Guest epoch rotated from 2 -> 3
    {
      const { sync, es, statuses } = await openConnectedSync(GUEST_TOKEN);
      const rotatedQ = JSON.stringify({ rev: 4, name: 'บ้านใหญ่', guestEpoch: 3, ownerEpoch: 4, current: null, queue: [], history: [] });
      es.emit('put', JSON.stringify({ path: '/', data: { q: rotatedQ } }));
      assert.equal(statuses.at(-1), 'bad_key');
      assert.equal(es.closed, true);
      sync.stop();
    }

    // 2. Owner epoch rotated from 4 -> 5
    {
      const { sync, es, statuses } = await openConnectedSync(OWNER_TOKEN);
      const rotatedQ = JSON.stringify({ rev: 4, name: 'บ้านใหญ่', guestEpoch: 2, ownerEpoch: 5, current: null, queue: [], history: [] });
      es.emit('put', JSON.stringify({ path: '/', data: { q: rotatedQ } }));
      assert.equal(statuses.at(-1), 'bad_key');
      assert.equal(es.closed, true);
      sync.stop();
    }

    // 3. Room deleted (put / null)
    {
      const { sync, es, statuses } = await openConnectedSync(GUEST_TOKEN);
      es.emit('put', JSON.stringify({ path: '/', data: null }));
      assert.equal(statuses.at(-1), 'gone');
      assert.equal(es.closed, true);
      sync.stop();
    }

    // 4. Stream cancel / auth_revoked
    for (const eventName of ['cancel', 'auth_revoked']) {
      const { sync, es, statuses } = await openConnectedSync(GUEST_TOKEN);
      es.emit(eventName, 'null');
      assert.equal(statuses.at(-1), 'gone');
      assert.equal(es.closed, true);
      sync.stop();
    }
  } finally {
    globalThis.fetch = origFetch;
    globalThis.EventSource = origES;
  }
});

test('sync retries by itself after a failed start, and after the server refuses the stream', async (t) => {
  const origFetch = globalThis.fetch;
  const origES = globalThis.EventSource;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const { FakeEventSource, instances } = createFakeEventSourceClass();
  globalThis.EventSource = FakeEventSource;
  let configCalls = 0;
  globalThis.fetch = async (url) => {
    if (url === '/api/config') {
      configCalls += 1;
      if (configCalls === 1) throw new TypeError('network down');
      return { status: 200, async json() { return { mode: 'local', db: '/local-db' }; } };
    }
    return { status: 200, async json() { return { roomId: ROOM_ID, name: 'บ้านใหญ่', role: 'g' }; } };
  };

  const statuses = [];
  const sync = createSync({ token: GUEST_TOKEN, roomId: ROOM_ID, onStatus: (s) => statuses.push(s) });
  try {
    sync.start();
    await settle();
    assert.deepEqual(statuses, ['offline']);
    assert.equal(instances.length, 0);

    t.mock.timers.tick(1000);
    await settle();
    assert.equal(instances.length, 1);

    // An HTTP error closes an EventSource for good (readyState 2): the page must reopen it.
    instances[0].readyState = 2;
    instances[0].onerror?.();
    t.mock.timers.tick(2000);
    await settle();
    assert.equal(instances.length, 2);
    assert.equal(configCalls, 3);
  } finally {
    sync.stop();
    globalThis.fetch = origFetch;
    globalThis.EventSource = origES;
  }
});
