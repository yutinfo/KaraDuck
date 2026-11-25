import test from 'node:test';
import assert from 'node:assert/strict';
import { takeToken, forgetToken } from '../public/js/session.js';
import * as api from '../public/js/api.js';

const ROOM_A = 'ABCDEFGHJKLMNPQR';
const ROOM_B = 'STUVWXYZ23456789';
const SIG_A = 'a'.repeat(22);
const SIG_B = 'b'.repeat(22);
const OWNER_A = `${ROOM_A}.o1.${SIG_A}`;
const OWNER_B = `${ROOM_B}.o2.${SIG_B}`;
const GUEST_A = `${ROOM_A}.g1.${SIG_A}`;
const GUEST_B = `${ROOM_B}.g3.${SIG_B}`;

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    dump() {
      return Object.fromEntries(map);
    },
  };
}

function makeHistory() {
  const calls = [];
  return {
    calls,
    replaceState(state, title, url) {
      calls.push({ state, title, url });
    },
  };
}

function makeThrowingStorage() {
  return {
    getItem() {
      throw new Error('storage disabled');
    },
    setItem() {
      throw new Error('storage disabled');
    },
    removeItem() {
      throw new Error('storage disabled');
    },
  };
}

test('takeToken("o") reads #o=<owner token>, stores it, and strips hash via replaceState', () => {
  const storage = makeStorage();
  const history = makeHistory();
  const location = { pathname: '/', search: '?tab=queue', hash: `#o=${OWNER_A}` };

  const result = takeToken('o', { location, history, storage });
  assert.deepEqual(result, { token: OWNER_A, roomId: ROOM_A });
  assert.equal(storage.getItem('karaoke.token.o'), OWNER_A);
  assert.equal(history.calls.length, 1);
  assert.equal(history.calls[0].url, '/?tab=queue');
  assert.ok(!history.calls[0].url.includes('#'));
});

test('takeToken("g") reads #g=<guest token>, stores it, and strips hash', () => {
  const storage = makeStorage();
  const history = makeHistory();
  const location = { pathname: '/remote', search: '', hash: `#g=${GUEST_A}` };

  const result = takeToken('g', { location, history, storage });
  assert.deepEqual(result, { token: GUEST_A, roomId: ROOM_A });
  assert.equal(storage.getItem('karaoke.token.g'), GUEST_A);
  assert.equal(history.calls.length, 1);
  assert.equal(history.calls[0].url, '/remote');
});

test('takeToken overwrites older stored token when hash has a new token', () => {
  const storage = makeStorage({ 'karaoke.token.o': OWNER_A });
  const history = makeHistory();
  const location = { pathname: '/', search: '', hash: `#o=${OWNER_B}` };

  const result = takeToken('o', { location, history, storage });
  assert.deepEqual(result, { token: OWNER_B, roomId: ROOM_B });
  assert.equal(storage.getItem('karaoke.token.o'), OWNER_B);
  assert.equal(history.calls.length, 1);
});

test('takeToken reads from storage when hash has no token for the requested role', () => {
  const storage = makeStorage({ 'karaoke.token.g': GUEST_B });
  const history = makeHistory();
  const location = { pathname: '/remote', search: '', hash: '' };

  const result = takeToken('g', { location, history, storage });
  assert.deepEqual(result, { token: GUEST_B, roomId: ROOM_B });
  assert.equal(history.calls.length, 0);
});

test('takeToken("o") rejects guest token in #o= and does not store it', () => {
  const storage = makeStorage();
  const history = makeHistory();
  const location = { pathname: '/', search: '', hash: `#o=${GUEST_A}` };

  const result = takeToken('o', { location, history, storage });
  assert.equal(result, null);
  assert.equal(storage.getItem('karaoke.token.o'), null);
});

test('takeToken("o") rejects malformed tokens and wrong-role stored tokens', () => {
  const badTokens = [
    '',
    'not-a-token',
    'ABCDEFGHJKLMNPQR.o0.' + SIG_A,
    'ABCDEFGHJKLMNPQR.o01.' + SIG_A,
    'ABCDEFGHJKLMNPQR.o1.short',
    'INVALID01IOOOOOO.o1.' + SIG_A,
    GUEST_A,
  ];
  for (const bad of badTokens) {
    const storage = makeStorage();
    const history = makeHistory();
    assert.equal(
      takeToken('o', { location: { pathname: '/', search: '', hash: `#o=${bad}` }, history, storage }),
      null,
    );
    assert.equal(storage.getItem('karaoke.token.o'), null);

    const stored = makeStorage({ 'karaoke.token.o': bad });
    assert.equal(
      takeToken('o', { location: { pathname: '/', search: '', hash: '' }, history, storage: stored }),
      null,
    );
  }
});

test('takeToken falls back to in-memory storage when storage throws on all methods', () => {
  const storage = makeThrowingStorage();
  const history = makeHistory();
  try {
    const first = takeToken('o', {
      location: { pathname: '/', search: '', hash: `#o=${OWNER_A}` },
      history,
      storage,
    });
    assert.deepEqual(first, { token: OWNER_A, roomId: ROOM_A });
    assert.equal(history.calls.length, 1);

    const second = takeToken('o', {
      location: { pathname: '/', search: '', hash: '' },
      history,
      storage,
    });
    assert.deepEqual(second, { token: OWNER_A, roomId: ROOM_A });
  } finally {
    forgetToken('o', { storage });
  }
});

test('forgetToken removes token from storage and memory fallback', () => {
  const storage = makeStorage({ 'karaoke.token.g': GUEST_A });
  forgetToken('g', { storage });
  assert.equal(storage.getItem('karaoke.token.g'), null);

  const throwing = makeThrowingStorage();
  takeToken('g', {
    location: { pathname: '/remote', search: '', hash: `#g=${GUEST_A}` },
    history: makeHistory(),
    storage: throwing,
  });
  forgetToken('g', { storage: throwing });
  assert.equal(
    takeToken('g', {
      location: { pathname: '/remote', search: '', hash: '' },
      history: makeHistory(),
      storage: throwing,
    }),
    null,
  );
});

test('api exports search, fetchEmbeddable, getRoom and removes getRemoteInfo', () => {
  assert.equal(typeof api.search, 'function');
  assert.equal(typeof api.fetchEmbeddable, 'function');
  assert.equal(typeof api.getRoom, 'function');
  assert.equal('getRemoteInfo' in api, false);
});

test('api.search, fetchEmbeddable, and getRoom send Authorization header and never put token in URL', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.startsWith('/api/search')) {
      return {
        status: 200,
        async json() {
          return { query: 'test', items: [{ id: 'dQw4w9WgXcQ', title: 'Song' }] };
        },
      };
    }
    if (url.startsWith('/api/embeddable')) {
      return {
        status: 200,
        async json() {
          return { dQw4w9WgXcQ: true };
        },
      };
    }
    if (url === '/api/room') {
      return {
        status: 200,
        async json() {
          return { roomId: ROOM_A, name: 'บ้าน', role: 'o', guestUrl: 'https://x/remote#g=...', qrSvg: '<svg/>' };
        },
      };
    }
    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const searchRes = await api.search('karaoke', { token: OWNER_A });
    assert.equal(searchRes.query, 'test');
    assert.equal(searchRes.items.length, 1);

    const embedRes = await api.fetchEmbeddable(['dQw4w9WgXcQ'], { token: GUEST_A });
    assert.deepEqual(embedRes, { dQw4w9WgXcQ: true });

    const roomRes = await api.getRoom({ token: OWNER_A });
    assert.equal(roomRes.roomId, ROOM_A);
    assert.equal(roomRes.name, 'บ้าน');
    assert.equal(roomRes.role, 'o');
    assert.equal(roomRes.qrSvg, '<svg/>');

    assert.equal(requests.length, 3);
    assert.equal(requests[0].url, '/api/search?q=karaoke');
    assert.equal(requests[0].options.headers.Authorization, `Bearer ${OWNER_A}`);
    assert.equal(requests[1].url, '/api/embeddable?ids=dQw4w9WgXcQ');
    assert.equal(requests[1].options.headers.Authorization, `Bearer ${GUEST_A}`);
    assert.equal(requests[2].url, '/api/room');
    assert.equal(requests[2].options.headers.Authorization, `Bearer ${OWNER_A}`);
    for (const req of requests) {
      assert.ok(!req.url.includes(OWNER_A));
      assert.ok(!req.url.includes(GUEST_A));
      assert.ok(!req.url.includes('k='));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('api.getRoom throws error with code and status on non-200 response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 401,
    async json() {
      return { error: 'stale_token' };
    },
  });

  try {
    await assert.rejects(
      () => api.getRoom({ token: GUEST_A }),
      (err) => err.code === 'stale_token' && err.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
