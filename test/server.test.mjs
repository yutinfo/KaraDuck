import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalApp, createRequestHandler, findLanAddress } from '../server.mjs';

class Response extends EventEmitter {
  status = null;
  headers = {};
  chunks = [];
  headersSent = false;
  ended = false;
  writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }
  write(chunk) { this.chunks.push(chunk.toString()); return true; }
  end(chunk = '') { this.write(chunk); this.ended = true; }
  destroy() { this.emit('close'); }
  get body() { return this.chunks.join(''); }
}
const request = (method, url, headers = {}) => Object.assign(new PassThrough(), { method, url, headers });
const song = { id: 'k6ngeWkYjI8', title: 'ลูกอม' };
const value = r => JSON.parse(r.body);
async function setup(t, options = {}) {
  const temp = await mkdtemp(path.join(tmpdir(), 'karaoke-local-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const publicDir = path.join(temp, 'public'), dataDir = path.join(temp, 'data');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<h1>Karaoke</h1>');
  await writeFile(path.join(publicDir, 'remote.html'), '<h1>Remote</h1>');
  const appOptions = { publicDir, dataDir, port: 8792, getLanAddress: () => '192.168.1.23', fetchImpl: () => assert.fail('unexpected fetch'), ...options };
  const app = createLocalApp(appOptions);
  const { ownerLinks } = await app.ready;
  const token = new URL(ownerLinks[0]).hash.slice(3), roomId = token.split('.')[0];
  return { app, temp, dataDir, publicDir, appOptions, ownerLinks, token, roomId,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
}
const get = (f, url, method = 'GET') => f.app.handle({ method, url, headers: f.headers });
const command = (f, cmd) => f.app.handle({ method: 'POST', url: '/api/command', headers: f.headers, body: JSON.stringify(cmd) });
const streamUrl = f => `/local-db/rooms/${f.roomId}.json`;
const noTimers = { startInterval: () => 1, stopInterval: () => {} };
const secure = headers => {
  assert.match(headers['Content-Security-Policy'], /connect-src 'self' https:\/\/\*\.firebasedatabase\.app/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
};

test('เริ่มครั้งแรกได้ลิงก์เจ้าของห้อง บ้าน เรียก room ได้ 200', async t => {
  const f = await setup(t);
  assert.equal(f.ownerLinks.length, 1);
  assert.match(f.ownerLinks[0], /^http:\/\/localhost:8792\/#o=/);
  const r = await get(f, '/api/room');
  assert.equal(r.status, 200);
  assert.equal(value(r).name, 'บ้าน');
  assert.equal(value(r).role, 'o');
  assert.match(value(r).guestUrl, /^http:\/\/192\.168\.1\.23:8792\/remote#g=/);
  assert.deepEqual(value(await get(f, '/api/config')), { mode: 'local', db: '/local-db', origin: 'http://192.168.1.23:8792', createEnabled: true });
});
test('เริ่มครั้งที่สองได้ลิงก์เดิมและเก็บ secrets/rooms ด้วยสิทธิ์ 0600', async t => {
  const f = await setup(t);
  assert.deepEqual((await createLocalApp(f.appOptions).ready).ownerLinks, f.ownerLinks);
  for (const file of ['secrets.json', 'rooms.json']) assert.equal((await stat(path.join(f.dataDir, file))).mode & 0o777, 0o600);
});
test('ช่องฟังส่ง put / ก่อน แล้ว put /q หลัง enqueue และ keep-alive ทุก 25 วินาที', async t => {
  const f = await setup(t);
  let tick, stopped = 0;
  const handler = createRequestHandler(f.app, { startInterval(fn, delay) { assert.equal(delay, 25000); tick = fn; return 123; }, stopInterval(id) { assert.equal(id, 123); stopped++; } });
  const req = request('GET', streamUrl(f)), res = new Response();
  await handler(req, res);
  assert.equal(res.status, 200);
  const initial = JSON.parse(res.body.split('data: ')[1]);
  assert.equal(initial.path, '/');
  assert.equal(JSON.parse(initial.data.q).name, 'บ้าน');
  await command(f, { type: 'enqueue', song });
  const update = JSON.parse(res.chunks[1].split('data: ')[1]);
  assert.equal(update.path, '/q');
  assert.equal(JSON.parse(update.data).current.id, song.id);
  await command(f, { type: 'control', action: 'toggle' });
  assert.equal(JSON.parse(res.chunks[2].split('data: ')[1]).path, '/p/c');
  tick();
  assert.equal(res.chunks[3], 'event: keep-alive\ndata: null\n\n');
  res.emit('close'); res.emit('close');
  assert.equal(stopped, 1);
  assert.equal(res.listenerCount('close'), 0);
  assert.equal(res.listenerCount('error'), 0);
  await command(f, { type: 'enqueue', song });
  assert.equal(res.chunks.length, 4);
  req.destroy();
});
test('ลบห้องแล้วช่องฟังได้ put / null และคำสั่งตอบ no_room', async t => {
  const f = await setup(t);
  const res = new Response(), req = request('GET', streamUrl(f));
  await createRequestHandler(f.app, noTimers)(req, res);
  const { adminKey } = JSON.parse(await readFile(path.join(f.dataDir, 'secrets.json'), 'utf8'));
  const r = await f.app.handle({ method: 'POST', url: '/api/admin', headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete', roomId: f.roomId }) });
  assert.equal(r.status, 200);
  assert.equal(res.chunks[1], 'event: put\ndata: {"path":"/","data":null}\n\n');
  assert.deepEqual(value(await command(f, { type: 'enqueue', song })), { error: 'no_room' });
  res.emit('close'); req.destroy();
});
test('ช่องฟังที่ 51 ได้ 503 และคืนช่องหลังปิด', async t => {
  const f = await setup(t), connections = [];
  const handler = createRequestHandler(f.app, noTimers);
  for (let i = 0; i < 51; i++) {
    const req = request('GET', streamUrl(f)), res = new Response();
    await handler(req, res);
    connections.push({ req, res });
    assert.equal(res.status, i === 50 ? 503 : 200);
  }
  assert.deepEqual(value(connections[50].res), { error: 'too_many_streams' });
  connections[0].res.emit('close');
  const req = request('GET', streamUrl(f)), res = new Response();
  await handler(req, res);
  assert.equal(res.status, 200);
  connections.push({ req, res });
  for (const c of connections) { c.res.emit('close'); c.req.destroy(); }
});
test('ทุกคำตอบไฟล์นิ่ง API ช่องฟัง และข้อผิดพลาดมีหัวความปลอดภัย', async t => {
  const f = await setup(t);
  for (const url of ['/', '/remote', '/missing', '/api/config', '/api/room', '/api/unknown']) secure((await get(f, url)).headers);
  const handler = createRequestHandler(f.app, noTimers);
  for (const url of [streamUrl(f), '/local-db/rooms/invalid.json']) {
    const req = request('GET', url), res = new Response();
    await handler(req, res);
    secure(res.headers);
    assert.equal(res.status, url === streamUrl(f) ? 200 : 404);
    res.emit('close'); req.destroy();
  }
});
test('ไฟล์นิ่งกัน traversal แบบ raw และ encoded รวม malformed paths', async t => {
  const f = await setup(t);
  for (const url of ['/../server.mjs', '/%2e%2e/server.mjs', '/%2e%2e/%2e%2e/etc/passwd', '/%ZZ', '/%00', '/..%5cserver.mjs']) assert.equal((await get(f, url)).status, 404, url);
});
test('ไฟล์นิ่งปฏิเสธ symlink ที่ออกนอก publicDir', async t => {
  const f = await setup(t);
  await writeFile(path.join(f.temp, 'secret.txt'), 'secret');
  await symlink(path.join(f.temp, 'secret.txt'), path.join(f.publicDir, 'link.txt'));
  assert.equal((await get(f, '/link.txt')).status, 404);
});
test('POST Content-Length 20000 ได้ 413 ก่อนอ่าน body', async t => {
  const f = await setup(t);
  const req = request('POST', '/api/command', { ...f.headers, 'content-length': '20000' }), res = new Response();
  await createRequestHandler(f.app)(req, res);
  assert.equal(res.status, 413);
  assert.deepEqual(value(res), { error: 'too_large' });
  assert.equal(req.listenerCount('data'), 0);
  assert.equal(req.isPaused(), true);
  secure(res.headers); req.destroy();
});
test('ไม่สร้างหรือเปลี่ยนไฟล์ state.json เดิม', async t => {
  const f = await setup(t);
  assert.deepEqual((await readdir(f.dataDir)).sort(), ['rooms.json', 'secrets.json']);
  await writeFile(path.join(f.dataDir, 'state.json'), 'old state sentinel');
  const app = createLocalApp(f.appOptions);
  await app.ready;
  await command({ ...f, app }, { type: 'enqueue', song });
  assert.equal(await readFile(path.join(f.dataDir, 'state.json'), 'utf8'), 'old state sentinel');
});
test('HTTP adapter ไม่อ่าน POST ที่ไม่มีโทเคนหรือกุญแจ admin ผิด', async t => {
  const f = await setup(t), handler = createRequestHandler(f.app);
  for (const url of ['/api/command', '/api/admin']) {
    const req = request('POST', url), res = new Response();
    await handler(req, res);
    assert.equal(res.status, 401);
    assert.equal(req.listenerCount('data'), 0);
    req.destroy();
  }
});
test('HTTP adapter GET config เป็น local และ GET room ไม่มีโทเคนได้ 401', async t => {
  const f = await setup(t), handler = createRequestHandler(f.app);
  for (const [url, status, expected] of [
    ['/api/config', 200, { mode: 'local', db: '/local-db', origin: 'http://192.168.1.23:8792', createEnabled: true }],
    ['/api/room', 401, { error: 'bad_token' }],
  ]) {
    const req = request('GET', url), res = new Response();
    await handler(req, res);
    assert.equal(res.status, status);
    assert.deepEqual(value(res), expected);
    req.destroy();
  }
});
test('local embeddable ส่ง referer เป็น localhost เสมอแม้ origin เป็น LAN', async t => {
  let calls = 0;
  const f = await setup(t, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(options.headers.Referer, 'http://localhost:8792/');
    return new globalThis.Response('{"previewPlayabilityStatus":{"status":"OK"}}');
  } });
  assert.deepEqual(value(await get(f, '/api/embeddable?ids=k6ngeWkYjI8')), { k6ngeWkYjI8: true });
  assert.equal(calls, 1);
});
test('HTTP adapter อ่านเฉพาะ POST และถอด UTF-8 ที่แบ่งทีละไบต์ได้', async t => {
  const f = await setup(t), handler = createRequestHandler(f.app);
  const req = request('POST', '/api/command', f.headers), res = new Response();
  const pending = handler(req, res);
  for (const byte of Buffer.from(JSON.stringify({ type: 'enqueue', song }))) req.write(Buffer.from([byte]));
  req.end(); await pending;
  assert.equal(res.status, 200);
  const rooms = JSON.parse(await readFile(path.join(f.dataDir, 'rooms.json'), 'utf8'));
  assert.equal(JSON.parse(rooms.rooms[f.roomId].q).current.title, 'ลูกอม');
  for (const method of ['GET', 'HEAD', 'DELETE']) {
    const readReq = request(method, '/api/config'), readRes = new Response();
    await handler(readReq, readRes);
    assert.equal(readReq.listenerCount('data'), 0);
    if (method === 'HEAD') assert.equal(readRes.body, '');
    readReq.destroy();
  }
});
test('HTTP adapter รับ 16KB พอดี ปฏิเสธ overflow ก่อน end และเก็บกวาด listeners', async t => {
  const f = await setup(t), handler = createRequestHandler(f.app);
  const req = request('POST', '/api/command', f.headers), res = new Response();
  const pending = handler(req, res);
  req.end(JSON.stringify({ type: 'clearQueue' }).padEnd(16384, ' ')); await pending;
  assert.equal(res.status, 200);
  const large = request('POST', '/api/command', f.headers), rejected = new Response();
  const waiting = handler(large, rejected);
  large.write(Buffer.alloc(8192)); large.write(Buffer.alloc(8193));
  await waiting;
  assert.equal(rejected.status, 413);
  assert.equal(large.isPaused(), true);
  for (const event of ['data', 'end', 'error', 'aborted']) assert.equal(large.listenerCount(event), 0);
  large.destroy();
});
test('ช่องฟัง error เก็บกวาด timer/subscription และไม่สะสมช่อง', async t => {
  const f = await setup(t);
  let stopped = 0;
  const handler = createRequestHandler(f.app, { startInterval: () => 1, stopInterval: () => stopped++ });
  for (let i = 0; i < 60; i++) {
    const req = request('GET', streamUrl(f)), res = new Response();
    await handler(req, res);
    assert.equal(res.status, 200);
    res.emit('error', new Error('lost')); req.destroy();
  }
  assert.equal(stopped, 60);
});
test('HEAD รักษาสถานะและ headers โดยไม่มี body และ MIME เดิมครบ', async t => {
  const f = await setup(t);
  const types = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2' };
  for (const [ext, type] of Object.entries(types)) {
    await writeFile(path.join(f.publicDir, `file.${ext}`), 'content');
    const r = await get(f, `/file.${ext}`);
    assert.equal(r.headers['Content-Type'], type);
    assert.equal(r.headers['Cache-Control'], 'no-cache');
  }
  for (const url of ['/', '/remote', '/missing', '/api/config', '/api/room']) {
    const full = await get(f, url), head = await get(f, url, 'HEAD');
    assert.equal(head.status, full.status);
    assert.deepEqual(head.headers, full.headers);
    assert.equal(head.body, '');
  }
});
test('ไม่พบ LAN ใช้ localhost และ findLanAddress เลือก private IPv4', async t => {
  const f = await setup(t, { getLanAddress: () => null });
  assert.equal(value(await get(f, '/api/config')).origin, 'http://localhost:8792');
  const ip = address => ({ address, family: 'IPv4', internal: false });
  assert.equal(findLanAddress({ vpn: [ip('10.0.0.1')], en0: [ip('192.168.1.5')] }), '192.168.1.5');
  assert.equal(findLanAddress({ en0: [ip('8.8.8.8'), ip('172.32.0.1'), ip('10.999.0.1')] }), null);
});
test('HTTP adapter ตอบ JSON 500 และ HEAD ไม่ส่งเนื้อหาเมื่อเกิดข้อผิดพลาด', async () => {
  const handler = createRequestHandler({ handle: async () => { throw new Error('private'); } });
  for (const method of ['GET', 'HEAD']) {
    const req = request(method, '/'), res = new Response();
    await handler(req, res);
    assert.equal(res.status, 500);
    assert.equal(res.body, method === 'HEAD' ? '' : '{"error":"internal"}');
    secure(res.headers); req.destroy();
  }
});

test('local POST /api/rooms creates an owner session without authorization and stamps injected time', async t => {
  const f = await setup(t, { now: () => 123 });
  const handler = createRequestHandler(f.app);
  const req = request('POST', '/api/rooms', { 'content-type': 'application/json' }), res = new Response();
  const pending = handler(req, res);
  req.end(JSON.stringify({ name: ' บ้านใหม่ ' }));
  await pending;
  assert.equal(res.status, 200);
  const created = value(res);
  assert.equal(created.name, 'บ้านใหม่');
  assert.equal(created.ownerUrl, `http://192.168.1.23:8792/#o=${created.ownerToken}`);
  const room = await f.app.handle({ method: 'GET', url: '/api/room', headers: { authorization: `Bearer ${created.ownerToken}` } });
  assert.equal(room.status, 200);
  assert.equal(value(room).role, 'o');
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'rooms.json'), 'utf8'));
  assert.equal(JSON.parse(saved.rooms[created.roomId].q).createdAt, 123);
  assert.equal(JSON.parse(saved.meta.text).creates, 1);
  secure(res.headers);
});

test('local public route honors createDisabled and rejects both advertised and streamed oversized bodies', async t => {
  const f = await setup(t, { createDisabled: true });
  assert.equal(value(await get(f, '/api/config')).createEnabled, false);
  const handler = createRequestHandler(f.app);
  for (const [headers, body, status] of [
    [{ 'content-type': 'application/json' }, '{"name":"บ้าน"}', 403],
    [{ 'content-type': 'application/json', 'content-length': '20000' }, null, 413],
    [{ 'content-type': 'application/json' }, 'ก'.repeat(5500), 413],
  ]) {
    const req = request('POST', '/api/rooms', headers), res = new Response();
    const pending = handler(req, res);
    if (body !== null) req.end(body);
    await pending;
    assert.equal(res.status, status);
    assert.deepEqual(value(res), { error: status === 413 ? 'too_large' : 'create_disabled' });
    req.destroy();
  }
});
