import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeQuery, parseDuration, parseSearchResponse, searchYouTube,
  parseEmbedPlayability, checkEmbeddable } from '../lib/youtube.mjs';

const sample = JSON.parse(await readFile(new URL('./fixtures/search-sample.json', import.meta.url), 'utf8'));
const embeds = Object.fromEntries(await Promise.all(['ok', 'unplayable', 'owner-disabled'].map(async name =>
  [name, await readFile(new URL(`./fixtures/embed-${name}.html`, import.meta.url), 'utf8')])));
const responseWith = entries => ({ contents: { twoColumnSearchResultsRenderer: {
  primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: entries } }] } },
} } });

test('normalizeQuery follows all five design examples and truncates before prefixing', () => {
  for (const [input, expected] of [
    ['ลูกอม', 'คาราโอเกะ ลูกอม'],
    ['  รักแรกพบ   tattoo colour ', 'คาราโอเกะ รักแรกพบ tattoo colour'],
    ['Karaoke ลูกอม', 'Karaoke ลูกอม'],
    ['ลูกอม คาราโอเกะ', 'ลูกอม คาราโอเกะ'],
  ]) assert.equal(normalizeQuery(input), expected);
  assert.throws(() => normalizeQuery('   '), { code: 'missing_query' });
  assert.throws(() => normalizeQuery(undefined), { code: 'missing_query' });
  assert.equal(normalizeQuery('ก'.repeat(150)), `คาราโอเกะ ${'ก'.repeat(100)}`);
  assert.equal(normalizeQuery('ลูกอม\n\t KARAOKE'), 'ลูกอม KARAOKE');
});

test('parseDuration accepts minutes or hours and rejects invalid durations', () => {
  for (const [value, expected] of [['4:28', 268], ['1:02:03', 3723], ['', 0], [undefined, 0], ['abc', 0], ['1:60', 0], ['1:2', 0], ['0:00', 0]]) {
    assert.equal(parseDuration(value), expected);
  }
});

test('fixture yields 19 unique videos, excludes live and matches every field of the first song', () => {
  const items = parseSearchResponse(sample);
  assert.equal(items.length, 19);
  assert.equal(new Set(items.map(item => item.id)).size, 19);
  assert.ok(items.every(item => item.id !== 'LIVE0000001'));
  assert.deepEqual(items[0], {
    id: 'k6ngeWkYjI8', title: '[KARAOKE] ลูกอม - วัชราวลี', channel: 'SINGTHAI',
    duration: '4:28', durationSec: 268, views: 'การดู 831,115 ครั้ง',
    thumbnail: 'https://i.ytimg.com/vi/k6ngeWkYjI8/mqdefault.jpg',
  });
});

test('malformed response structures return an empty list', () => {
  for (const value of [null, {}, { contents: {} }, { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: {} } } } } }, responseWith([null, {}, { videoRenderer: {} }])]) {
    assert.deepEqual(parseSearchResponse(value), []);
  }
});

test('parser joins titles, falls back for channel/views, skips invalid entries and caps at 30', () => {
  const video = { videoId: 'one', title: { runs: [{ text: 'A' }, { text: 'B' }] }, longBylineText: { runs: [{ text: 'fallback' }] }, lengthText: { simpleText: '1:02' } };
  const entries = [{ videoRenderer: video }, { videoRenderer: video },
    { videoRenderer: { ...video, videoId: '' } },
    { videoRenderer: { ...video, videoId: 'zero', lengthText: { simpleText: '0:00' } } },
    ...Array.from({ length: 40 }, (_, i) => ({ videoRenderer: { ...video, videoId: `v${i}`, longBylineText: undefined } }))];
  const items = parseSearchResponse(responseWith(entries));
  assert.equal(items.length, 30);
  assert.equal(items[0].title, 'AB');
  assert.equal(items[0].channel, 'fallback');
  assert.equal(items[0].views, '');
  assert.equal(items[1].channel, '');
  assert.equal(items.at(-1).id, 'v28');
});

test('searchYouTube sends the contracted URL, headers, body and timeout signal', async () => {
  const result = await searchYouTube('ลูกอม', { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' });
    assert.deepEqual(JSON.parse(options.body), {
      context: { client: { clientName: 'WEB', clientVersion: '2.20241120.01.00', hl: 'th', gl: 'TH' } }, query: 'คาราโอเกะ ลูกอม',
    });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    return { ok: true, json: async () => sample };
  } });
  assert.equal(result.query, 'คาราโอเกะ ลูกอม');
  assert.equal(result.items.length, 19);
});

test('HTTP errors, fetch throws and invalid JSON all become upstream_failed', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 500 }),
    async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }),
  ]) await assert.rejects(searchYouTube('ลูกอม', { fetchImpl }), { code: 'upstream_failed' });
});

test('embed parser reads all three real escaped fixtures and ordinary JSON statuses', () => {
  assert.equal(parseEmbedPlayability(embeds.ok), true);
  assert.equal(parseEmbedPlayability(embeds.unplayable), false);
  assert.equal(parseEmbedPlayability(embeds['owner-disabled']), false);
  assert.equal(parseEmbedPlayability('{"previewPlayabilityStatus":{"status":"OK","playableInEmbed":true}}'), true);
  for (const status of ['ERROR', 'UNPLAYABLE', '']) {
    assert.equal(parseEmbedPlayability(JSON.stringify({ previewPlayabilityStatus: { status } })), false);
  }
});

test('a sign-in demand aimed at the server leaves the song unknown, in plain and escaped pages', () => {
  const plain = JSON.stringify({
    previewPlayabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' },
  });
  assert.equal(parseEmbedPlayability(plain), null);
  assert.equal(parseEmbedPlayability(JSON.stringify(plain)), null);
});

test('embed parser reads only the first status in the preview object, ignoring other objects and nested statuses', () => {
  const html = '{"status":"ERROR","previewPlayabilityStatus":{"reason":"status","nested":{"status":"ERROR"},"status":"OK","status":"ERROR"}}';
  assert.equal(parseEmbedPlayability(html), true);
  assert.equal(parseEmbedPlayability(JSON.stringify(html)), true);
  for (const input of ['', null, undefined, 123, {}, '{"status":"OK"}',
    '{"previewPlayabilityStatus":{},"status":"OK"}',
    '{"previewPlayabilityStatus":{"nested":{"status":"OK"}},"status":"OK"}',
    '{"previewPlayabilityStatus":{"status":true}}',
    '{"previewPlayabilityStatus":{"status":',
  ]) assert.equal(parseEmbedPlayability(input), null);
});

test('embed check sends the embed URL, desktop headers, referer and a five-second timeout', async t => {
  const timeout = AbortSignal.timeout;
  const durations = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    durations.push(milliseconds);
    return timeout(milliseconds);
  });
  const result = await checkEmbeddable('k6ngeWkYjI8', { referer: 'http://localhost:8888/', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://www.youtube.com/embed/k6ngeWkYjI8');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Referer, 'http://localhost:8888/');
    assert.match(options.headers['User-Agent'], /^Mozilla\/5\.0 .*Windows NT.*AppleWebKit.*Chrome.*Safari/);
    assert.equal(options.headers['Accept-Language'], 'en');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    return new Response(embeds.ok);
  } });
  assert.equal(result, true);
  assert.deepEqual(durations, [5000]);
});

test('embed check returns unknown for HTTP/network/body/timeout failures and never fetches invalid ids', async () => {
  for (const fetchImpl of [
    async () => new Response('', { status: 404 }),
    async () => { throw new Error('offline'); },
    async () => { throw new DOMException('timeout', 'TimeoutError'); },
    async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('read failed')); } })),
    async () => new Response('{"status":"OK"}'),
  ]) assert.equal(await checkEmbeddable('k6ngeWkYjI8', { fetchImpl }), null);
  for (const id of ['bad', '', null, undefined, 123, 'a'.repeat(12)]) {
    assert.equal(await checkEmbeddable(id, { fetchImpl: () => assert.fail('must not fetch') }), null);
  }
});

test('embed check parses an early status in a 2 MB body and cancels at the 1 MB byte limit', async () => {
  const limit = 1024 * 1024;
  const html = embeds.ok.padEnd(2 * limit, 'x');
  assert.equal(await checkEmbeddable('k6ngeWkYjI8', { fetchImpl: async () => new Response(html) }), true);
  for (const early of [true, false]) {
    let reads = 0;
    let cancelled = false;
    const prefix = early ? embeds.ok : 'ก'.repeat(limit / 2);
    const bytes = Buffer.from(prefix.padEnd(2 * limit, 'x') + embeds.ok);
    const body = new ReadableStream({
      pull(controller) {
        reads++;
        const start = (reads - 1) * 64 * 1024;
        controller.enqueue(bytes.subarray(start, start + 64 * 1024));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const result = await checkEmbeddable('k6ngeWkYjI8', { fetchImpl: async () => new Response(body) });
    assert.equal(result, early ? true : null);
    assert.equal(reads, 16);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  }
});
