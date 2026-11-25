import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequestHandler } from '../server.mjs';
import { createApp } from '../lib/app.mjs';

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
function request(method, url, options = {}) {
  return Object.assign(new PassThrough(), { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, options);
}
const song = { id: 'k6ngeWkYjI8', title: 'ลูกอม' };
const makeApp = () => createApp({ publicDir: '/private/tmp', makeKey: () => 'AB12CD', getLanAddress: () => null });
const command = (app, cmd) => app.handle({ method: 'POST', url: '/api/command', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cmd) });

test('SSE immediately sends state, streams state/control, pings at 25s, and cleans up on close', async () => {
  const app = makeApp();
  let tick, stopped = 0;
  const handler = createRequestHandler(app, {
    startInterval(callback, delay) { assert.equal(delay, 25_000); tick = callback; return 123; },
    stopInterval(timer) { assert.equal(timer, 123); stopped++; },
  });
  const res = new Response();
  const req = request('GET', '/api/events?k=AB12CD', { socket: { remoteAddress: '192.168.1.50' } });
  await handler(req, res);
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  assert.equal(res.body, `event: state\ndata: ${JSON.stringify(app.snapshot())}\n\n`);
  assert.equal(res.ended, false);
  await command(app, { type: 'enqueue', song });
  assert.equal(res.chunks[1], `event: state\ndata: ${JSON.stringify(app.snapshot())}\n\n`);
  await command(app, { type: 'control', action: 'toggle' });
  assert.equal(res.chunks[2], 'event: control\ndata: {"action":"toggle"}\n\n');
  await command(app, { type: 'remove', qid: 'missing' });
  assert.equal(res.chunks.length, 3);
  tick();
  assert.equal(res.chunks[3], ': ping\n\n');
  res.emit('close');
  res.emit('close');
  assert.equal(stopped, 1);
  await command(app, { type: 'enqueue', song });
  assert.equal(res.chunks.length, 4, 'unsubscribed after disconnect');
  assert.equal(res.listenerCount('close'), 0);
  assert.equal(res.listenerCount('error'), 0);
  req.destroy();
});

test('SSE authorization returns JSON 401 without subscribing or creating timers', async () => {
  const app = makeApp();
  const handler = createRequestHandler(app, { startInterval() { assert.fail('must not create timer'); } });
  for (const url of ['/api/events', '/api/events?k=wrong']) {
    const req = request('GET', url, { socket: { remoteAddress: '192.168.1.50' } });
    const res = new Response();
    await handler(req, res);
    assert.equal(res.status, 401);
    assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.deepEqual(JSON.parse(res.body), { error: 'bad_key' });
    assert.equal(res.ended, true);
    req.destroy();
  }
});

test('SSE response errors also stop timers and remove listeners', async () => {
  const app = makeApp();
  let stopped = false;
  const handler = createRequestHandler(app, { startInterval: () => 1, stopInterval: () => { stopped = true; } });
  const req = request('GET', '/api/events');
  const res = new Response();
  await handler(req, res);
  res.emit('error', new Error('connection lost'));
  assert.equal(stopped, true);
  await command(app, { type: 'enqueue', song });
  assert.equal(res.chunks.length, 1);
  req.destroy();
});

test('HTTP adapter reads only POST and forwards headers/address/body including split UTF-8', async () => {
  const seen = [];
  const handler = createRequestHandler({ handle: async req => {
    seen.push(req);
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' };
  } });
  const req = request('POST', '/api/command?k=AB12CD', {
    headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '192.168.1.50' },
  });
  const res = new Response();
  const pending = handler(req, res);
  const bytes = Buffer.from(JSON.stringify({ type: 'enqueue', song }));
  for (const byte of bytes) req.write(Buffer.from([byte]));
  req.end();
  await pending;
  assert.deepEqual(seen[0], { method: 'POST', url: '/api/command?k=AB12CD', headers: req.headers,
    body: bytes.toString('utf8'), remoteAddress: '192.168.1.50' });
  assert.equal(res.status, 200);
  assert.equal(res.body, '{"ok":true}');
  for (const method of ['GET', 'HEAD', 'DELETE']) {
    const req = request(method, '/');
    await handler(req, new Response());
    assert.equal(req.listenerCount('data'), 0);
    assert.equal(seen.at(-1).body, '');
    req.destroy();
  }
});

test('HTTP adapter accepts exactly 16KB, rejects overflow before end, pauses and removes body listeners', async () => {
  let calls = 0;
  const handler = createRequestHandler({ handle: async () => {
    calls++;
    return { status: 200, headers: {}, body: 'ok' };
  } });
  const exact = request('POST', '/api/command');
  const accepted = new Response();
  const pending = handler(exact, accepted);
  exact.end(Buffer.alloc(16 * 1024, 32));
  await pending;
  assert.equal(accepted.status, 200);
  assert.equal(calls, 1);
  const oversized = request('POST', '/api/command');
  const rejected = new Response();
  const waiting = handler(oversized, rejected);
  oversized.write(Buffer.alloc(8 * 1024));
  oversized.write(Buffer.alloc(9 * 1024));
  await waiting;
  assert.equal(rejected.status, 413);
  assert.equal(rejected.headers.Connection, 'close');
  assert.deepEqual(JSON.parse(rejected.body), { error: 'too_large' });
  assert.equal(rejected.ended, true);
  assert.equal(oversized.isPaused(), true);
  assert.equal(oversized.listenerCount('data'), 0);
  assert.equal(oversized.listenerCount('end'), 0);
  assert.equal(calls, 1);
  oversized.destroy();
});

test('HTTP adapter returns JSON on failures and omits error body for HEAD', async () => {
  const handler = createRequestHandler({ handle: async () => { throw new Error('failure'); } });
  for (const method of ['GET', 'HEAD']) {
    const req = request(method, '/');
    const res = new Response();
    await handler(req, res);
    assert.equal(res.status, 500);
    assert.equal(res.body, method === 'HEAD' ? '' : '{"error":"internal"}');
    req.destroy();
  }
});
