import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { createGoogleAuth } from '../lib/google-auth.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const clientEmail = 'service@example.iam.gserviceaccount.com';
const options = { clientEmail, privateKey: pem };
const tokenResponse = token => new Response(JSON.stringify({ access_token: token, expires_in: 3600 }));

test('assertion เป็น RS256 ที่ตรวจลายเซ็นได้ พร้อม claims, form และ escaped newlines', async () => {
  const auth = createGoogleAuth({ ...options, privateKey: pem.replaceAll('\n', '\\n'), now: () => 1_700_000_000_123,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.equal(init.method, 'POST');
      assert.equal(new Headers(init.headers).get('content-type'), 'application/x-www-form-urlencoded');
      assert.ok(init.signal instanceof AbortSignal);
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const [head, body, signature] = form.get('assertion').split('.');
      assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'RS256', typ: 'JWT' });
      assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')), { iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
        aud: 'https://oauth2.googleapis.com/token', iat: 1_700_000_000, exp: 1_700_003_600 });
      assert.equal(createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, Buffer.from(signature, 'base64url')), true);
      return tokenResponse('token');
    } });
  assert.equal(await auth.getAccessToken(), 'token');
});

test('แคช, refresh ก่อนหมดอายุ 5 นาที, รวม concurrent requests และ invalidate', async () => {
  let time = 0, calls = 0;
  const auth = createGoogleAuth({ ...options, now: () => time, fetchImpl: async () => tokenResponse(`token-${++calls}`) });
  assert.deepEqual(await Promise.all([auth.getAccessToken(), auth.getAccessToken()]), ['token-1', 'token-1']);
  assert.equal(await auth.getAccessToken(), 'token-1');
  time = 55 * 60_000 - 1;
  assert.equal(await auth.getAccessToken(), 'token-1');
  time = 56 * 60_000;
  assert.equal(await auth.getAccessToken(), 'token-2');
  auth.invalidate();
  assert.equal(await auth.getAccessToken(), 'token-3');
  assert.equal(calls, 3);
});

test('แลกโทเคนล้มแล้วลองครั้งต่อไปได้ และไม่เปิดเผยข้อมูลลับใน error', async () => {
  for (const failure of [() => new Response('private details', { status: 500 }),
    () => { throw new Error('private details'); }, () => new Response('{}'),
    () => new Response('{'), () => new Response('{"access_token":"x","expires_in":0}')]) {
    let calls = 0;
    const auth = createGoogleAuth({ ...options, fetchImpl: async () => ++calls === 1 ? failure() : tokenResponse('ok') });
    await assert.rejects(auth.getAccessToken(), error => error.code === 'store_failed' && !error.message.includes('private details'));
    assert.equal(await auth.getAccessToken(), 'ok');
  }
});

test('invalidate ระหว่างแลกโทเคนไม่แคชผลเก่า', async () => {
  let finish, calls = 0;
  const auth = createGoogleAuth({ ...options, fetchImpl: () => ++calls === 1
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(tokenResponse('new')) });
  const old = auth.getAccessToken();
  auth.invalidate();
  assert.equal(await auth.getAccessToken(), 'new');
  finish(tokenResponse('old'));
  assert.equal(await old, 'old');
  assert.equal(await auth.getAccessToken(), 'new');
});

test('fetch โยน synchronously แล้วไม่ค้าง promise ที่ล้มเหลวใน cache', async () => {
  let calls = 0;
  const auth = createGoogleAuth({ ...options, fetchImpl: () => {
    if (++calls === 1) throw new Error('connection unavailable');
    return Promise.resolve(tokenResponse('recovered'));
  } });
  await assert.rejects(auth.getAccessToken(), { code: 'store_failed' });
  assert.equal(await auth.getAccessToken(), 'recovered');
  assert.equal(calls, 2);
});
