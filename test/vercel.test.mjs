import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { webHandler } from '../lib/vercel.mjs';
import { SECURITY_HEADERS } from '../lib/security-headers.mjs';
import { signToken } from '../lib/tokens.mjs';
import { newRoomDoc, encodeRoomDoc } from '../lib/room-doc.mjs';

const roomId = 'ABCDEFGHJKLMNPQR';
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const baseEnv = { FIREBASE_DB_URL: 'https://karaduck-3935d-default-rtdb.asia-southeast1.firebasedatabase.app/',
  FIREBASE_CLIENT_EMAIL: 'service@example.test', FIREBASE_PRIVATE_KEY: privateKey, ROOM_SECRET: 'room-secret', ADMIN_KEY: 'admin-test' };
const noFetch = () => assert.fail('unexpected network');
const req = (path, init) => new Request(`https://karaoke.test/api/${path}`, init);
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test' }, body: JSON.stringify(body) });
const json = value => new Response(JSON.stringify(value), { headers: { ETag: '"rev"' } });

test('config env ครบ: cloud, URL ตัด slash, origin จาก host, headers และไม่ fetch', async () => {
  const handler = webHandler('config', { env: { ...baseEnv }, fetchImpl: noFetch });
  const r = await handler(req('config', { headers: { Host: 'custom.test' } }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { mode: 'cloud', db: baseEnv.FIREBASE_DB_URL.slice(0, -1), origin: 'https://custom.test' });
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers.get(key), value);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.has('access-control-allow-origin'), false);
  const head = await handler(req('config', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('ขาด env บังคับแต่ละตัว ทุก route ได้ 503 โดยไม่อ่าน body/ไม่ fetch/ไม่ throw ตอนโหลด', async () => {
  for (const key of Object.keys(baseEnv)) {
    const env = { ...baseEnv, [key]: '' };
    for (const name of ['config', 'room', 'command', 'search', 'embeddable', 'admin']) {
      const handler = webHandler(name, { env, fetchImpl: noFetch });
      const request = req(name, post({}));
      Object.defineProperty(request, 'body', { get: () => assert.fail('body read') });
      const r = await handler(request);
      assert.equal(r.status, 503, `${key}: ${name}`);
      assert.deepEqual(await r.json(), { error: 'not_configured' });
    }
  }
});

test('content-length เกิน 16KB ได้ 413 ก่อนอ่าน body และ fetch', async () => {
  const request = req('admin', { ...post({}), headers: { ...post({}).headers, 'content-length': '20000' } });
  Object.defineProperty(request, 'body', { get: () => assert.fail('body read') });
  const r = await webHandler('admin', { env: { ...baseEnv }, fetchImpl: noFetch })(request);
  assert.equal(r.status, 413);
  assert.deepEqual(await r.json(), { error: 'too_large' });
});

test('token ผิดไม่อ่าน body แม้ content type ถูกต้อง', async () => {
  for (const name of ['admin', 'command']) {
    const request = req(name, { ...post({}), headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' } });
    Object.defineProperty(request, 'body', { get: () => assert.fail('body read') });
    const r = await webHandler(name, { env: { ...baseEnv }, fetchImpl: noFetch })(request);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: name === 'admin' ? 'bad_admin_key' : 'bad_token' });
  }
});

test('อ่าน body แบบจำกัด byte โดยไม่ต้องมี content-length และยกเลิก stream เมื่อเกิน', async () => {
  let cancelled = false;
  const request = req('admin', post({}));
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('ก'.repeat(5500))); }, cancel() { cancelled = true; } });
  Object.defineProperty(request, 'body', { value: stream });
  const r = await webHandler('admin', { env: { ...baseEnv }, fetchImpl: noFetch })(request);
  assert.equal(r.status, 413);
  assert.deepEqual(await r.json(), { error: 'too_large' });
  assert.equal(cancelled, true);
});

test('body ขนาด 16KB พอดีผ่าน และ UTF-8 แบ่งทีละ byte ยังอ่านชื่อไทยได้', async () => {
  const savedNames = [];
  const fetchImpl = async (url, init) => {
    if (url.includes('oauth2')) return json({ access_token: 'access', expires_in: 3600 });
    savedNames.push(JSON.parse(JSON.parse(init.body)).name);
    return json(null);
  };
  const handler = webHandler('admin', { env: { ...baseEnv }, fetchImpl });
  const text = JSON.stringify({ action: 'create', name: 'บ้าน' });
  const padded = text + ' '.repeat(16 * 1024 - Buffer.byteLength(text));
  const r = await handler(req('admin', { ...post({}), body: padded }));
  assert.equal(r.status, 200);
  const request = req('admin', post({}));
  const bytes = new TextEncoder().encode(text);
  let index = 0;
  Object.defineProperty(request, 'body', { value: new ReadableStream({ pull(controller) {
    if (index === bytes.length) controller.close();
    else controller.enqueue(bytes.slice(index, ++index));
  } }) });
  assert.equal((await handler(request)).status, 200);
  assert.deepEqual(savedNames, ['บ้าน', 'บ้าน']);
});

test('admin แปลง headers เป็นตัวเล็ก, lazy body, ใช้ store/auth ร่วมกันต่อ instance', async () => {
  const env = { ...baseEnv, PUBLIC_ORIGIN: 'https://public.test/' };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return url.includes('oauth2') ? json({ access_token: 'access', expires_in: 3600 }) : json(null);
  };
  const handler = webHandler('admin', { env, fetchImpl });
  for (let i = 0; i < 2; i++) {
    const r = await handler(req('admin', { ...post({ action: 'create', name: 'บ้าน' }), headers: { Authorization: 'Bearer admin-test', 'Content-Type': 'application/json' } }));
    assert.equal(r.status, 200);
    const result = await r.json();
    assert.match(result.ownerUrl, /^https:\/\/public\.test\/#o=/);
  }
  const list = await webHandler('admin', { env, fetchImpl })(req('admin', post({ action: 'list' })));
  assert.equal(list.status, 200);
  assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1);
  assert.equal(calls.filter(c => c.init.method === 'PUT').length, 2);
});

test('ส่ง pathname พร้อม query ให้ handler และ SEARCH_DISABLED ปิดทั้งสองเส้นทาง', async () => {
  const env = { ...baseEnv };
  const auth = { authorization: `Bearer ${signToken(env.ROOM_SECRET, { roomId, role: 'g', epoch: 1 })}` };
  const doc = encodeRoomDoc(newRoomDoc('บ้าน'));
  const fetchImpl = async url => url.includes('oauth2') ? json({ access_token: 'access', expires_in: 3600 }) : json(doc);
  const response = await webHandler('embeddable', { env, fetchImpl })(req('embeddable?ids=bad', { headers: auth }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'bad_ids' });
  const disabledEnv = { ...env, SEARCH_DISABLED: '1' };
  for (const route of ['search?q=song', 'embeddable?ids=abcdefghijk']) {
    const r = await webHandler(route.split('?')[0], { env: disabledEnv, fetchImpl })(req(route, { headers: auth }));
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'search_disabled' });
  }
});

test('referer ใช้ origin จริงพร้อม slash และ upstream ล้มตอบ JSON store_failed', async () => {
  const env = { ...baseEnv, PUBLIC_ORIGIN: 'https://public.test' };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2')) return json({ access_token: 'access', expires_in: 3600 });
    if (url.includes('firebasedatabase')) return json(encodeRoomDoc(newRoomDoc('บ้าน')));
    return new Response(await readFile(new URL('./fixtures/embed-ok.html', import.meta.url), 'utf8'));
  };
  const token = signToken(env.ROOM_SECRET, { roomId, role: 'g', epoch: 1 });
  const r = await webHandler('embeddable', { env, fetchImpl })(req('embeddable?ids=abcdefghijk', { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(r.status, 200);
  const youtube = calls.find(c => c.url.includes('youtube.com'));
  assert.equal(new Headers(youtube.init.headers).get('referer'), 'https://public.test/');
  const failed = await webHandler('admin', { env: { ...baseEnv }, fetchImpl: async () => { throw new Error('secret'); } })(req('admin', post({ action: 'list' })));
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'store_failed' });
});

test('vercel.json จำกัดไฟล์นิ่งเป็น public, config และ headers ตรงสัญญา', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.regions, ['sin1']);
  assert.equal(config.cleanUrls, true);
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.buildCommand, '');
  assert.equal(config.framework, null);
  assert.equal(config.functions['api/*.js'].maxDuration, 15);
  assert.equal(config.functions['api/*.js'].includeFiles, 'public/js/{store,commands}.js');
  assert.equal(config.headers[0].source, '/(.*)');
  assert.deepEqual(Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value])), SECURITY_HEADERS);
  assert.equal(config.rewrites, undefined);
});

test('database.rules.json อนุญาตอ่านเฉพาะห้อง ปิดอ่านรายชื่อและเขียน', async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url), 'utf8')),
    { rules: { '.read': false, '.write': false, rooms: { $room: { '.read': true } } } });
});

test('api มี 6 ไฟล์ เป็น thin wrappers ส่งออกเฉพาะเมธอดที่กำหนดและ import ไม่ throw', async () => {
  const methods = { config: 'GET', room: 'GET', command: 'POST', search: 'GET', embeddable: 'GET', admin: 'POST' };
  assert.deepEqual((await readdir(new URL('../api/', import.meta.url))).sort(), Object.keys(methods).map(k => `${k}.js`).sort());
  for (const [name, method] of Object.entries(methods)) {
    const url = new URL(`../api/${name}.js`, import.meta.url);
    assert.equal((await readFile(url, 'utf8')).trim(), `import { webHandler } from '../lib/vercel.mjs';\nexport const ${method} = webHandler('${name}');`);
    const module = await import(url);
    assert.deepEqual(Object.keys(module), [method]);
    assert.equal(typeof module[method], 'function');
  }
});
