import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createYouTubeCache } from '../lib/yt-cache.mjs';

const sample = JSON.parse(await readFile(new URL('./fixtures/search-sample.json', import.meta.url), 'utf8'));
const html = Object.fromEntries(await Promise.all(['ok', 'unplayable', 'owner-disabled'].map(async name => [name, await readFile(new URL(`./fixtures/embed-${name}.html`, import.meta.url), 'utf8')])));
const ids = n => Array.from({ length: n }, (_, i) => String(i).padStart(11, '0'));

test('search แคช normalized query ครบ 10 นาทีพอดี', async () => {
  let time = 0, calls = 0;
  const cache = createYouTubeCache({ now: () => time, fetchImpl: async () => { calls++; return { ok: true, json: async () => sample }; } });
  const result = await cache.search('ลูกอม');
  assert.equal(result.query, 'คาราโอเกะ ลูกอม');
  assert.equal(result.items.length, 19);
  await cache.search('  คาราโอเกะ   ลูกอม  ');
  time = 599999;
  await cache.search('ลูกอม');
  assert.equal(calls, 1);
  time++;
  await cache.search('ลูกอม');
  assert.equal(calls, 2);
});
test('search จำกัด 200 keys และอ่านไม่เปลี่ยนลำดับ eviction', async () => {
  let calls = 0;
  const cache = createYouTubeCache({ fetchImpl: async () => { calls++; return { ok: true, json: async () => sample }; } });
  for (let i = 0; i < 200; i++) await cache.search(`song${i}`);
  await cache.search('song0');
  assert.equal(calls, 200);
  await cache.search('song200');
  await cache.search('song1');
  assert.equal(calls, 201);
  await cache.search('song0');
  assert.equal(calls, 202);
});
test('query ยาวยังส่งครบ 100 ตัวอักษร', async () => {
  const cache = createYouTubeCache({ fetchImpl: async (_, options) => {
    assert.equal(JSON.parse(options.body).query, 'คาราโอเกะ ' + 'ก'.repeat(100));
    return { ok: true, json: async () => sample };
  } });
  assert.equal((await cache.search('ก'.repeat(150))).query, 'คาราโอเกะ ' + 'ก'.repeat(100));
});
test('embeddable แคช boolean ครบ 6 ชั่วโมงพอดีและส่ง referer', async () => {
  let time = 0, calls = 0;
  const cache = createYouTubeCache({ now: () => time, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(options.headers.Referer, 'http://localhost:8888/');
    return new Response(url.endsWith('k6ngeWkYjI8') ? html.ok : html.unplayable);
  } });
  const list = ['k6ngeWkYjI8', '8oWgHgf_c_w'];
  assert.deepEqual(await cache.embeddable(list, 'http://localhost:8888/'), { k6ngeWkYjI8: true, '8oWgHgf_c_w': false });
  time = 6 * 60 * 60 * 1000 - 1;
  await cache.embeddable(list, 'http://localhost:8888/');
  assert.equal(calls, 2);
  time++;
  await cache.embeddable(list, 'http://localhost:8888/');
  assert.equal(calls, 4);
});
test('embeddable คืนทุก key และไม่แคช null/ข้อผิดพลาด', async () => {
  const calls = new Map();
  const list = ['k6ngeWkYjI8', '8oWgHgf_c_w', 'abcdefghijk'];
  const cache = createYouTubeCache({ fetchImpl: async url => {
    const id = url.split('/').at(-1);
    calls.set(id, (calls.get(id) ?? 0) + 1);
    if (id === list[2]) {
      if (calls.get(id) === 1) throw new Error('offline');
      if (calls.get(id) === 2) return new Response('{"status":"OK"}');
    }
    return new Response(id === list[1] ? html['owner-disabled'] : html.ok);
  } });
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await cache.embeddable(list, 'http://localhost/'), { k6ngeWkYjI8: true, '8oWgHgf_c_w': false, abcdefghijk: i === 2 ? true : null });
  }
  await cache.embeddable(list, 'http://localhost/');
  assert.deepEqual([...calls.values()], [1, 1, 3]);
});
test('embeddable รวม id ซ้ำทั้งในและระหว่างคำขอพร้อมกัน', async () => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const cache = createYouTubeCache({ fetchImpl: async () => { calls++; await gate; return new Response(html.ok); } });
  const a = cache.embeddable(['k6ngeWkYjI8', 'k6ngeWkYjI8'], 'http://localhost/');
  const b = cache.embeddable(['k6ngeWkYjI8'], 'http://localhost/');
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await a, await b);
  assert.equal(calls, 1);
});
test('embeddable จำกัด concurrent upstream ไม่เกิน 6', async () => {
  let active = 0, max = 0;
  const cache = createYouTubeCache({ fetchImpl: async () => {
    max = Math.max(max, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return new Response(html.ok);
  } });
  assert.equal(Object.keys(await cache.embeddable(ids(30), 'http://localhost/')).length, 30);
  assert.equal(max, 6);
});
test('embeddable จำกัด 2000 ids และอ่านไม่เปลี่ยนลำดับ eviction', async () => {
  let calls = 0;
  const cache = createYouTubeCache({ fetchImpl: async () => { calls++; return new Response(html.ok); } });
  const list = ids(2001);
  await cache.embeddable(list.slice(0, 2000), 'http://localhost/');
  await cache.embeddable([list[0]], 'http://localhost/');
  assert.equal(calls, 2000);
  await cache.embeddable([list[2000], list[1]], 'http://localhost/');
  assert.equal(calls, 2001);
  await cache.embeddable([list[0]], 'http://localhost/');
  assert.equal(calls, 2002);
});
