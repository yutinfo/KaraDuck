import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { createIdTokenVerifier } from '../lib/firebase-id-token.mjs';

const cert = await readFile(new URL('./fixtures/idtoken-cert.pem', import.meta.url), 'utf8');
const key = await readFile(new URL('./fixtures/idtoken-key.pem', import.meta.url), 'utf8');
const at = 1_800_000_000_000;
const claims = { aud: 'karaduck-3935d', iss: 'https://securetoken.google.com/karaduck-3935d',
  sub: 'user-123', exp: at / 1000 + 3600, iat: at / 1000, auth_time: at / 1000,
  email: 'owner@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
function token(overrides = {}, header = {}) {
  const parts = [{ alg: 'RS256', kid: 'test', ...header }, { ...claims, ...overrides }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url'));
  return `${parts.join('.')}.${createSign('RSA-SHA256').update(parts.join('.')).sign(key).toString('base64url')}`;
}
const response = (keys = { test: cert }, cache = 'public, max-age=120') => new Response(JSON.stringify(keys), { headers: cache === null ? {} : { 'Cache-Control': cache } });
const verifier = (options = {}) => createIdTokenVerifier({ projectId: claims.aud, now: () => at, fetchImpl: async () => response(), ...options });

test('valid RS256 Firebase token returns the verified claims', async () => {
  assert.deepEqual(await verifier().verify(token()), claims);
});

test('rejects wrong signature, JWT shape, algorithm, kid and claim boundaries', async () => {
  const valid = token();
  const parts = valid.split('.');
  const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1;
  const invalid = [null, '', 'a.b', 'a.b.c.d', '%.e30.eA', 'null.e30.eA',
    `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`,
    token({}, { alg: 'none' }), token({}, { alg: 'HS256' }), token({}, { kid: 'unknown' }), token({}, { kid: '' }),
    token({ aud: 'other' }), token({ iss: 'other' }), token({ exp: at / 1000 }), token({ exp: at / 1000 - 1 }),
    token({ sub: '' }), token({ sub: null }), token({ sub: ' ' }), token({ exp: '9999999999' }),
    token({ iat: at / 1000 + 61 }), token({ auth_time: at / 1000 + 61 }),
    token({ iat: null }), token({ auth_time: '1800000000' }),
  ];
  const instance = verifier();
  for (const input of invalid) assert.equal(await instance.verify(input), null, String(input));
  assert.ok(await instance.verify(token({ iat: at / 1000 + 60, auth_time: at / 1000 + 60 })));
});

test('network, HTTP, JSON and PEM errors fail closed without throwing', async () => {
  for (const fetchImpl of [async () => { throw new Error('offline'); }, async () => new Response('', { status: 500 }),
    async () => new Response('{'), async () => response({ test: 'bad PEM' }), async () => response({}), async () => response(null)]) {
    assert.equal(await verifier({ fetchImpl }).verify(token()), null);
  }
  assert.equal(await verifier({ projectId: undefined }).verify(token()), null);
});

test('caches certificates by max-age, refreshes on expiry, deduplicates requests', async () => {
  let time = at, calls = 0;
  const instance = verifier({ now: () => time, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    assert.ok(init.signal instanceof AbortSignal);
    return response();
  } });
  assert.ok((await Promise.all([instance.verify(token()), instance.verify(token())])).every(Boolean));
  time += 119_999;
  assert.ok(await instance.verify(token())); assert.equal(calls, 1);
  time++;
  assert.ok(await instance.verify(token())); assert.equal(calls, 2);
});

test('missing cache header defaults to one hour', async () => {
  let time = at, calls = 0;
  const instance = verifier({ now: () => time, fetchImpl: async () => { calls++; return response({ test: cert }, null); } });
  await instance.verify(token()); time += 3_599_999;
  await instance.verify(token()); assert.equal(calls, 1);
  time++;
  await instance.verify(token()); assert.equal(calls, 2);
});

test('unknown kid forces at most one refresh in 60 seconds, accepts rotated certificates', async () => {
  let time = at, calls = 0;
  const instance = verifier({ now: () => time, fetchImpl: async () => {
    calls++;
    return response(calls === 1 ? { test: cert } : { test: cert, rotated: cert }, 'max-age=3600');
  } });
  await instance.verify(token());
  assert.ok(await instance.verify(token({}, { kid: 'rotated' })));
  assert.equal(calls, 2);
  for (let i = 0; i < 10; i++) assert.equal(await instance.verify(token({}, { kid: `bad-${i}` })), null);
  assert.equal(calls, 2);
  time += 59_999;
  assert.equal(await instance.verify(token({}, { kid: 'bad' })), null);
  assert.equal(calls, 2);
  time++;
  assert.equal(await instance.verify(token({}, { kid: 'bad' })), null);
  assert.equal(calls, 3);
});

test('an unknown kid on an empty cache fetches only once, then throttles misses', async () => {
  let calls = 0;
  const instance = verifier({ fetchImpl: async () => { calls++; return response(); } });
  for (let i = 0; i < 3; i++) assert.equal(await instance.verify(token({}, { kid: 'bad' })), null);
  assert.equal(calls, 1);
});

test('certificate fetch times out after five seconds and aborts the request', async () => {
  let signal;
  const instance = verifier({ fetchImpl: async (_, init) => { signal = init.signal; return new Promise(() => {}); } });
  assert.equal(await instance.verify(token()), null);
  assert.equal(signal.aborted, true);
});
