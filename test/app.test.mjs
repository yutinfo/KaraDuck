import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, findLanAddress } from '../lib/app.mjs';

const sample = JSON.parse(await readFile(new URL('./fixtures/search-sample.json', import.meta.url), 'utf8'));
async function setup(t, options = {}) {
  const temp = await mkdtemp(path.join(tmpdir(), 'karaoke-app-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const publicDir = path.join(temp, 'public');
  await mkdir(path.join(publicDir, 'js'), { recursive: true });
  await writeFile(path.join(publicDir, 'index.html'), '<h1>Karaoke</h1>');
  await writeFile(path.join(publicDir, 'remote.html'), '<h1>Remote</h1>');
  await writeFile(path.join(publicDir, 'js/a.js'), 'export const a = 1;');
  let calls = 0;
  const app = createApp({ publicDir, makeKey: () => 'AB12CD', getLanAddress: () => '192.168.1.23', fetchImpl: async () => {
    calls++;
    return { ok: true, json: async () => sample };
  }, ...options });
  return { ...app, publicDir, temp, calls: () => calls };
}
const search = '/api/search?q=%E0%B8%A5%E0%B8%B9%E0%B8%81%E0%B8%AD%E0%B8%A1';
const get = (app, url, method = 'GET') => app.handle({ method, url });

test('search API returns JSON and caches normalized queries for exactly ten minutes', async t => {
  let time = 0;
  const app = await setup(t, { now: () => time });
  const response = await get(app, search);
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(JSON.parse(response.body).query, 'คาราโอเกะ ลูกอม');
  assert.equal(JSON.parse(response.body).items.length, 19);
  await get(app, search);
  await get(app, '/api/search?q=' + encodeURIComponent('  คาราโอเกะ   ลูกอม  '));
  assert.equal(app.calls(), 1);
  time = 599_999;
  await get(app, search);
  assert.equal(app.calls(), 1);
  time = 601_000;
  await get(app, search);
  assert.equal(app.calls(), 2);
});

test('missing and blank queries yield 400 without fetching', async t => {
  const app = await setup(t);
  for (const url of ['/api/search', '/api/search?q=%20%20']) {
    const response = await get(app, url);
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { error: 'missing_query' });
  }
  assert.equal(app.calls(), 0);
});

test('upstream failure yields 502 and is retried rather than cached', async t => {
  let calls = 0;
  const app = await setup(t, { fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return { ok: true, json: async () => sample };
  } });
  const failed = await get(app, search);
  assert.equal(failed.status, 502);
  assert.deepEqual(JSON.parse(failed.body), { error: 'upstream_failed' });
  assert.equal((await get(app, search)).status, 200);
  assert.equal(calls, 2);
});

test('static files, missing paths, traversal and unsupported methods', async t => {
  const app = await setup(t);
  const index = await get(app, '/');
  assert.equal(index.status, 200);
  assert.equal(index.body.toString(), '<h1>Karaoke</h1>');
  assert.equal(index.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(index.headers['Cache-Control'], 'no-cache');
  const js = await get(app, '/js/a.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers['Content-Type'], 'text/javascript; charset=utf-8');
  assert.equal(js.body.toString(), 'export const a = 1;');
  for (const url of ['/nope.css', '/../server.mjs', '/%2e%2e/%2e%2e/etc/passwd', '/%ZZ', '/%00', '/..%5cserver.mjs']) {
    assert.equal((await get(app, url)).status, 404, url);
  }
  const post = await get(app, '/api/search', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET, HEAD');
});

test('HEAD preserves status and headers and sends no body', async t => {
  const app = await setup(t);
  for (const url of ['/', '/js/a.js', '/nope.css', search, '/api/search']) {
    const head = await get(app, url, 'HEAD');
    const full = await get(app, url);
    assert.equal(head.status, full.status);
    assert.deepEqual(head.headers, full.headers);
    assert.equal(head.body, '');
  }
});

test('all required static MIME types include appropriate charset and no-cache', async t => {
  const app = await setup(t);
  const types = { css: 'text/css; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2' };
  for (const [extension, type] of Object.entries(types)) {
    await writeFile(path.join(app.publicDir, `file.${extension}`), 'content');
    const response = await get(app, `/file.${extension}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], type);
    assert.equal(response.headers['Cache-Control'], 'no-cache');
  }
});

test('static serving rejects symlinks that escape publicDir', async t => {
  const app = await setup(t);
  await writeFile(path.join(app.temp, 'secret.txt'), 'secret');
  await symlink(path.join(app.temp, 'secret.txt'), path.join(app.publicDir, 'link.txt'));
  assert.equal((await get(app, '/link.txt')).status, 404);
});

test('cache caps at 200 keys and evicts oldest insertion even if recently read', async t => {
  const app = await setup(t);
  for (let i = 0; i < 200; i++) await get(app, `/api/search?q=song${i}`);
  assert.equal(app.calls(), 200);
  await get(app, '/api/search?q=song0');
  assert.equal(app.calls(), 200);
  await get(app, '/api/search?q=song200');
  assert.equal(app.calls(), 201);
  await get(app, '/api/search?q=song1');
  assert.equal(app.calls(), 201);
  await get(app, '/api/search?q=song0');
  assert.equal(app.calls(), 202);
});

test('long queries keep all 100 characters when sent upstream', async t => {
  const raw = 'ก'.repeat(150);
  const app = await setup(t);
  const response = await get(app, '/api/search?q=' + encodeURIComponent(raw));
  assert.equal(JSON.parse(response.body).query, 'คาราโอเกะ ' + 'ก'.repeat(100));
});

const remoteAddress = '192.168.1.50';
const remoteGet = (app, url) => app.handle({ method: 'GET', url, remoteAddress });
const song = (id = 'k6ngeWkYjI8') => ({ id, title: 'ลูกอม', durationSec: 268, by: '  คนขอ  ' });
const post = (app, cmd, options = {}) => app.handle({ method: 'POST', url: '/api/command',
  headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(cmd), ...options });
const value = response => JSON.parse(response.body);

test('remote clients need the room key for all APIs including search/events', async t => {
  const app = await setup(t);
  for (const endpoint of ['/api/state', '/api/search?q=test', '/api/events']) {
    const separator = endpoint.includes('?') ? '&' : '?';
    for (const suffix of ['', `${separator}k=wrong`]) {
      const response = await remoteGet(app, endpoint + suffix);
      assert.equal(response.status, 401);
      assert.deepEqual(value(response), { error: 'bad_key' });
      assert.deepEqual(app.authorize({ url: endpoint + suffix, remoteAddress }), { ok: false, status: 401, error: 'bad_key' });
    }
  }
  const response = await remoteGet(app, '/api/state?k=AB12CD');
  assert.equal(response.status, 200);
  assert.deepEqual(value(response), { rev: 0, current: null, queue: [], history: [], playerState: 'idle' });
  assert.equal((await remoteGet(app, '/api/search?k=AB12CD&q=test')).status, 200);
  assert.equal(app.calls(), 1);
  assert.deepEqual(app.authorize({ url: '/api/events?k=AB12CD', remoteAddress }), { ok: true, local: false });
});

test('remote pages are public, main pages redirect preserving query and local APIs stay private', async t => {
  const app = await setup(t);
  for (const base of ['/', '/index.html']) for (const query of ['', '?k=AB12CD', '?k=AB12CD&x=1']) {
    const response = await remoteGet(app, base + query);
    assert.equal(response.status, 302);
    assert.equal(response.headers.Location, '/remote' + query);
  }
  for (const url of ['/remote', '/remote.html', '/js/a.js']) assert.equal((await remoteGet(app, url)).status, 200);
  assert.equal((await remoteGet(app, '/remote')).body.toString(), '<h1>Remote</h1>');
  for (const url of ['/api/remote-info', '/api/qr.svg', '/api/%72emote-info', '/api/qr%2esvg']) {
    for (const suffix of ['', '?k=AB12CD']) {
      const response = await remoteGet(app, url + suffix);
      assert.equal(response.status, 403, url);
      assert.deepEqual(value(response), { error: 'local_only' });
    }
  }
});

test('all three loopback forms bypass keys and return the LAN URL/QR; no LAN yields 404 QR', async t => {
  const app = await setup(t);
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const get = url => app.handle({ method: 'GET', url, remoteAddress });
    assert.equal((await get('/api/state')).status, 200);
    assert.deepEqual(app.authorize({ url: '/api/events', remoteAddress }), { ok: true, local: true });
    assert.deepEqual(value(await get('/api/remote-info')), { available: true, url: 'http://192.168.1.23:8791/remote?k=AB12CD' });
    const qr = await get('/api/qr.svg');
    assert.equal(qr.status, 200);
    assert.match(qr.headers['Content-Type'], /^image\/svg\+xml/);
    assert.match(qr.body, /<svg/);
    assert.match(qr.body, /fill="#fff"/);
  }
  const noLan = await setup(t, { getLanAddress: () => null });
  assert.deepEqual(value(await get(noLan, '/api/remote-info')), { available: false, url: null });
  assert.equal((await get(noLan, '/api/qr.svg')).status, 404);
  const customPort = await setup(t, { port: 8888 });
  assert.equal(value(await get(customPort, '/api/remote-info')).url, 'http://192.168.1.23:8888/remote?k=AB12CD');
});

test('remote enqueue publishes exactly one state and subscription can be cancelled', async t => {
  const app = await setup(t);
  const events = [];
  const unsubscribe = app.subscribe(event => events.push(event));
  assert.equal(events.length, 0);
  const response = await post(app, { type: 'enqueue', song: song() }, { remoteAddress, url: '/api/command?k=AB12CD' });
  assert.equal(response.status, 200);
  assert.deepEqual(value(response), { ok: true, rev: 1 });
  assert.equal(app.snapshot().current.id, song().id);
  assert.equal(app.snapshot().current.by, 'คนขอ');
  assert.deepEqual(events, [{ event: 'state', data: app.snapshot() }]);
  const snapshot = app.snapshot();
  assert.throws(() => { snapshot.current.title = 'forged'; }, TypeError);
  unsubscribe();
  unsubscribe();
  await post(app, { type: 'enqueue', song: song() });
  assert.equal(events.length, 1);
  assert.equal(app.snapshot().rev, 2);
});

test('command input errors return 415/400/413 without changing state or notifying', async t => {
  const app = await setup(t);
  const events = [];
  app.subscribe(event => events.push(event));
  for (const headers of [{}, { 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/jsonp' }]) {
    const response = await post(app, { type: 'advance' }, { headers });
    assert.equal(response.status, 415);
    assert.deepEqual(value(response), { error: 'bad_content_type' });
  }
  for (const body of ['{bad', 'null', '[]', '{}', '{"type":"oops"}', '{"type":"move","qid":"q","delta":0}', '{"type":"enqueue","song":{}}', '{"type":"report","playerState":"oops"}', '{"type":"control","action":"oops"}']) {
    const response = await post(app, null, { body });
    assert.equal(response.status, 400, body);
    assert.deepEqual(value(response), { error: 'bad_command' });
  }
  const tooLarge = await post(app, null, { body: ' '.repeat(17 * 1024) });
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(value(tooLarge), { error: 'too_large' });
  assert.equal((await post(app, null, { body: 'ก'.repeat(6000) })).status, 413); // UTF-8 bytes, not string length.
  const exactLimit = JSON.stringify({ type: 'advance' }).padEnd(16 * 1024, ' ');
  assert.equal((await post(app, null, { body: exactLimit, headers: { 'content-type': 'Application/JSON' } })).status, 200);
  assert.equal(app.snapshot().rev, 0);
  assert.deepEqual(events, []);
});

test('remote clear/report are forbidden; controls broadcast without changing revision', async t => {
  const app = await setup(t);
  const events = [];
  app.subscribe(event => events.push(event));
  for (const type of ['clearQueue', 'clearHistory', 'report']) {
    const response = await post(app, { type, playerState: 'playing' }, { remoteAddress, url: '/api/command?k=AB12CD' });
    assert.equal(response.status, 403);
    assert.deepEqual(value(response), { error: 'local_only' });
  }
  assert.equal((await post(app, { type: 'enqueue', song: song() }, { remoteAddress })).status, 401);
  for (const action of ['toggle', 'restart']) {
    const response = await post(app, { type: 'control', action }, { remoteAddress, url: '/api/command?k=AB12CD' });
    assert.equal(response.status, 200);
    assert.deepEqual(value(response), { ok: true, rev: 0 });
  }
  assert.deepEqual(events, ['toggle', 'restart'].map(action => ({ event: 'control', data: { action } })));
  assert.equal(app.snapshot().rev, 0);
});

test('reports, stale advance and empty commands keep revisions/events exact; draining forces idle', async t => {
  const app = await setup(t);
  const events = [];
  app.subscribe(event => events.push(event));
  const noop = async cmd => {
    const before = app.snapshot();
    const count = events.length;
    assert.deepEqual(value(await post(app, cmd)), { ok: true, rev: before.rev });
    assert.equal(app.snapshot(), before);
    assert.equal(events.length, count);
  };
  for (const cmd of [{ type: 'advance' }, { type: 'clearQueue' }, { type: 'clearHistory' },
    { type: 'report', playerState: 'playing' }, { type: 'report', playerState: 'idle' }]) await noop(cmd);
  await post(app, { type: 'enqueue', song: song() });
  await post(app, { type: 'enqueue', song: song('ZNRypr6GRZE') });
  assert.equal(app.snapshot().rev, 2);
  for (const playerState of ['playing', 'paused', 'buffering']) {
    const before = app.snapshot().rev;
    await post(app, { type: 'report', playerState });
    assert.equal(app.snapshot().playerState, playerState);
    assert.equal(app.snapshot().rev, before + 1);
    await noop({ type: 'report', playerState });
  }
  for (const cmd of [{ type: 'advance', qid: 'stale' }, { type: 'remove', qid: 'absent' },
    { type: 'move', qid: 'absent', delta: 1 }, { type: 'moveToTop', qid: app.snapshot().queue[0].qid },
    { type: 'playFromQueue', qid: 'absent' }]) await noop(cmd);
  const oldQid = app.snapshot().current.qid;
  await post(app, { type: 'advance', qid: oldQid });
  assert.equal(app.snapshot().current.id, 'ZNRypr6GRZE');
  await noop({ type: 'advance', qid: oldQid });
  await post(app, { type: 'advance', qid: app.snapshot().current.qid, skipHistory: true });
  assert.equal(app.snapshot().current, null);
  assert.equal(app.snapshot().playerState, 'idle');
  assert.equal(app.snapshot().history.length, 1);
  assert.equal(app.snapshot().rev, 7);
  assert.equal(events.length, 7);
  assert.deepEqual(events.map(event => event.data.rev), [1, 2, 3, 4, 5, 6, 7]);
  await noop({ type: 'advance' });
});

test('persistence creates directories and restores key, queue, history, by and snapshot revision', async t => {
  const fixture = await setup(t);
  const dataFile = path.join(fixture.temp, 'nested', 'data', 'state.json');
  const options = { publicDir: fixture.publicDir, dataFile, makeKey: () => 'AB12CD', getLanAddress: () => '192.168.1.23' };
  const app = createApp(options);
  assert.equal(JSON.parse(await readFile(dataFile, 'utf8')).key, 'AB12CD');
  await post(app, { type: 'enqueue', song: song() });
  await post(app, { type: 'enqueue', song: song('ZNRypr6GRZE') });
  let restored = createApp({ ...options, makeKey: () => { throw new Error('must reuse saved key'); } });
  assert.deepEqual(restored.snapshot(), app.snapshot());
  await post(restored, { type: 'advance' });
  await post(restored, { type: 'report', playerState: 'paused' });
  const expected = restored.snapshot();
  restored = createApp(options);
  assert.deepEqual(restored.snapshot(), expected);
  assert.equal(restored.snapshot().history[0].by, 'คนขอ');
  assert.equal(restored.authorize({ url: '/api/state?k=AB12CD', remoteAddress }).ok, true);
  assert.deepEqual(JSON.parse(await readFile(dataFile, 'utf8')), { key: 'AB12CD', state: expected });
});

test('corrupt/malformed saved data starts safely and deserialize cleans restored state', async t => {
  const fixture = await setup(t);
  const dataFile = path.join(fixture.temp, 'state.json');
  const options = { publicDir: fixture.publicDir, dataFile, makeKey: () => 'AB12CD' };
  for (const contents of ['{bad', 'null', '[]', '{"state":42}']) {
    await writeFile(dataFile, contents);
    const app = createApp(options);
    assert.deepEqual(app.snapshot(), { rev: 0, current: null, queue: [], history: [], playerState: 'idle' });
    assert.equal(JSON.parse(await readFile(dataFile, 'utf8')).key, 'AB12CD');
  }
  await writeFile(dataFile, JSON.stringify({ key: 'AB12CD', state: { current: { id: 'bad', title: 'Bad' }, queue: [{ ...song(), qid: 'valid' }], history: [], rev: -1, playerState: 'playing' } }));
  const cleaned = createApp(options);
  assert.equal(cleaned.snapshot().current, null);
  assert.equal(cleaned.snapshot().queue[0].qid, 'valid');
  assert.equal(cleaned.snapshot().playerState, 'idle');
  assert.equal(cleaned.snapshot().rev, 0);
});

test('unwritable persistence and throwing listeners do not fail commands or other subscribers', async t => {
  const fixture = await setup(t);
  const blocker = path.join(fixture.temp, 'file');
  await writeFile(blocker, 'not a directory');
  const app = createApp({ publicDir: fixture.publicDir, dataFile: path.join(blocker, 'state.json'), makeKey: () => 'AB12CD' });
  const events = [];
  app.subscribe(() => { throw new Error('disconnected'); });
  app.subscribe(event => events.push(event));
  assert.equal((await post(app, { type: 'enqueue', song: song() })).status, 200);
  assert.equal(app.snapshot().rev, 1);
  assert.equal(events.length, 1);
});

test('LAN selection accepts only private IPv4 and prefers en/wl/eth over other interfaces', () => {
  const ip = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });
  assert.equal(findLanAddress({ lo: [ip('127.0.0.1', { internal: true })], vpn: [ip('10.0.0.1')], en0: [ip('192.168.1.23')] }), '192.168.1.23');
  assert.equal(findLanAddress({ other: [ip('172.31.2.3')], wlan0: [ip('10.2.3.4')] }), '10.2.3.4');
  assert.equal(findLanAddress({ eth0: [ip('172.16.0.1', { family: 4 })] }), '172.16.0.1');
  assert.equal(findLanAddress({ tunnel: [ip('10.0.0.1')], other: [ip('192.168.9.1')] }), '10.0.0.1');
  assert.equal(findLanAddress({ en0: [ip('8.8.8.8'), ip('172.15.0.1'), ip('172.32.0.1'), ip('192.169.0.1'), ip('10.999.0.1'), ip('::1', { family: 'IPv6' }), ip('10.0.0.2', { internal: true })], empty: null }), null);
  assert.equal(findLanAddress({}), null);
});

test('default room keys are six characters from the specified alphabet', async t => {
  const fixture = await setup(t);
  for (let i = 0; i < 10; i++) {
    const app = createApp({ publicDir: fixture.publicDir, getLanAddress: () => '192.168.1.23' });
    const url = value(await get(app, '/api/remote-info')).url;
    assert.match(new URL(url).searchParams.get('k'), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

const embedHtml = Object.fromEntries(await Promise.all(['ok', 'unplayable', 'owner-disabled'].map(async name =>
  [name, await readFile(new URL(`./fixtures/embed-${name}.html`, import.meta.url), 'utf8')])));
const embedUrl = ids => `/api/embeddable?ids=${ids.join(',')}`;
const embedIds = count => Array.from({ length: count }, (_, i) => String(i).padStart(11, '0'));
function fakeYouTube(onEmbed) {
  return async (url, options) => {
    if (url.startsWith('https://www.youtube.com/embed/')) return onEmbed(url.split('/').at(-1), options);
    assert.equal(url, 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false');
    return { ok: true, json: async () => sample };
  };
}

test('embeddable API returns boolean flags, shares search authorization and caches for six hours', async t => {
  let time = 0;
  const calls = [];
  const ids = ['k6ngeWkYjI8', '8oWgHgf_c_w'];
  const app = await setup(t, { now: () => time, port: 8888, fetchImpl: fakeYouTube((id, options) => {
    calls.push(id);
    assert.equal(options.headers.Referer, 'http://localhost:8888/');
    return new Response(id === ids[0] ? embedHtml.ok : embedHtml.unplayable);
  }) });
  const response = await get(app, embedUrl(ids));
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(value(response), { k6ngeWkYjI8: true, '8oWgHgf_c_w': false });
  assert.equal((await get(app, search)).status, 200);
  await get(app, embedUrl(ids));
  time = 6 * 60 * 60 * 1000 - 1;
  await get(app, embedUrl(ids));
  assert.equal(calls.length, 2);
  time++;
  await get(app, embedUrl(ids));
  assert.equal(calls.length, 4, 'expires at exactly six hours');
  time += 6 * 60 * 60 * 1000 + 1000;
  await get(app, embedUrl(ids));
  assert.equal(calls.length, 6);
  for (const suffix of ['', '&k=wrong']) {
    const denied = await remoteGet(app, embedUrl(ids) + suffix);
    assert.equal(denied.status, 401);
    assert.deepEqual(value(denied), { error: 'bad_key' });
  }
  assert.equal(calls.length, 6);
  assert.equal((await remoteGet(app, embedUrl(ids) + '&k=AB12CD')).status, 200);
  const head = await get(app, embedUrl(ids), 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.deepEqual(head.headers, response.headers);
});

test('embeddable API keeps every requested key and retries unknown results without refetching known flags', async t => {
  const calls = new Map();
  const ids = ['k6ngeWkYjI8', '8oWgHgf_c_w', 'abcdefghijk'];
  const app = await setup(t, { fetchImpl: fakeYouTube(id => {
    calls.set(id, (calls.get(id) ?? 0) + 1);
    if (id === ids[2]) {
      if (calls.get(id) === 1) throw new Error('offline');
      if (calls.get(id) === 2) return new Response('{"status":"OK"}');
      return new Response(embedHtml.ok);
    }
    return new Response(id === ids[0] ? embedHtml.ok : embedHtml['owner-disabled']);
  }) });
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(value(await get(app, embedUrl(ids))), {
      k6ngeWkYjI8: true, '8oWgHgf_c_w': false, abcdefghijk: i === 2 ? true : null,
    });
  }
  await get(app, embedUrl(ids));
  assert.deepEqual([...calls.values()], [1, 1, 3]);
});

test('embeddable API deduplicates within and across concurrent requests', async t => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = await setup(t, { fetchImpl: fakeYouTube(async id => {
    calls.push(id);
    await gate;
    return new Response(embedHtml.ok);
  }) });
  const first = get(app, embedUrl(['k6ngeWkYjI8', 'k6ngeWkYjI8']));
  const second = get(app, embedUrl(['k6ngeWkYjI8']));
  assert.deepEqual(calls, ['k6ngeWkYjI8']);
  release();
  for (const response of await Promise.all([first, second])) {
    assert.equal(response.status, 200);
    assert.deepEqual(value(response), { k6ngeWkYjI8: true });
  }
  assert.equal(calls.length, 1);
});

test('embeddable API validates ids before fetching and counts duplicates once', async t => {
  let calls = 0;
  const app = await setup(t, { fetchImpl: fakeYouTube(() => {
    calls++;
    return new Response(embedHtml.ok);
  }) });
  for (const url of ['/api/embeddable', '/api/embeddable?ids=', '/api/embeddable?ids=bad',
    '/api/embeddable?ids=k6ngeWkYjI8,', '/api/embeddable?ids=%20k6ngeWkYjI8', embedUrl(embedIds(31))]) {
    const response = await get(app, url);
    assert.equal(response.status, 400, url);
    assert.deepEqual(value(response), { error: 'bad_ids' });
    assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
  }
  assert.equal(calls, 0);
  assert.equal((await get(app, embedUrl(Array(31).fill('k6ngeWkYjI8')))).status, 200);
  assert.equal(calls, 1);
});

test('embeddable API limits all requests together to six active checks and shares queued ids', async t => {
  let active = 0;
  let maximum = 0;
  const calls = [];
  const app = await setup(t, { fetchImpl: fakeYouTube(async id => {
    calls.push(id);
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return new Response(embedHtml.ok);
  }) });
  const ids = embedIds(60);
  const responses = await Promise.all([
    get(app, embedUrl(ids.slice(0, 30))),
    get(app, embedUrl(ids.slice(30))),
    get(app, embedUrl([ids[29], ids[59]])),
  ]);
  assert.equal(maximum, 6);
  assert.equal(active, 0);
  assert.equal(calls.length, 60);
  assert.equal(new Set(calls).size, 60);
  for (let i = 0; i < 2; i++) {
    assert.equal(responses[i].status, 200);
    assert.deepEqual(value(responses[i]), Object.fromEntries(ids.slice(i * 30, (i + 1) * 30).map(id => [id, true])));
  }
  assert.deepEqual(value(responses[2]), { [ids[29]]: true, [ids[59]]: true });
});

test('embeddable cache caps at 2000 ids and evicts the oldest insertion even after reading it', async t => {
  let calls = 0;
  const app = await setup(t, { fetchImpl: fakeYouTube(() => {
    calls++;
    return new Response(embedHtml.ok);
  }) });
  const ids = embedIds(2001);
  for (let i = 0; i < 2000; i += 30) await get(app, embedUrl(ids.slice(i, Math.min(i + 30, 2000))));
  assert.equal(calls, 2000);
  await get(app, embedUrl([ids[0]]));
  assert.equal(calls, 2000);
  await get(app, embedUrl([ids[2000]]));
  assert.equal(calls, 2001);
  await get(app, embedUrl([ids[1]]));
  assert.equal(calls, 2001);
  await get(app, embedUrl([ids[0]]));
  assert.equal(calls, 2002);
});
