import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore } from '../lib/store-file.mjs';

function tempFile(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'karaoke-file-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'rooms.json') };
}

test('เขียนด้วย etag เก่าไม่สำเร็จ และทุกการเขียนคิวเปลี่ยน etag แม้ข้อความเหมือนเดิม', async () => {
  const s = createFileStore();
  const a = await s.readQueue('R1');
  assert.deepEqual(a, { text: null, etag: 'null_etag' });
  assert.equal(await s.writeQueue('R1', 'x', a.etag), true);
  assert.equal(await s.writeQueue('R1', 'y', a.etag), false);
  const b = await s.readQueue('R1');
  assert.equal(b.text, 'x');
  assert.notEqual(b.etag, 'null_etag');
  assert.equal(await s.writeQueue('R1', 'x', b.etag), true);
  const c = await s.readQueue('R1');
  assert.notEqual(c.etag, b.etag);
  assert.equal(await s.writeQueue('absent', 'x', b.etag), false);
  assert.equal(s.readRoom('absent'), null);
});

test('simultaneous writes with the same etag have exactly one winner', async () => {
  const s = createFileStore();
  const results = await Promise.all(['a', 'b'].map(text => s.writeQueue('R1', text, 'null_etag')));
  assert.deepEqual(results, [true, false]);
  assert.equal((await s.readQueue('R1')).text, 'a');
});

test('rooms and player fields are isolated; listRooms includes only rooms with q', async () => {
  const s = createFileStore();
  await s.writeQueue('R1', 'one', 'null_etag');
  await s.writeQueue('R2', 'two', 'null_etag');
  const etag = (await s.readQueue('R1')).etag;
  await s.writePlayer('R1', 's', 'playing');
  await s.writePlayer('R1', 'c', { a: 'toggle', t: 123 });
  await s.writePlayer('player-only', 's', 'idle');
  assert.deepEqual(await s.listRooms(), ['R1', 'R2']);
  assert.equal((await s.readQueue('R1')).etag, etag);
  assert.deepEqual(await s.readQueue('player-only'), { text: null, etag: 'null_etag' });
  assert.deepEqual(s.readRoom('R1'), { q: 'one', p: { s: 'playing', c: { a: 'toggle', t: 123 } } });
  assert.deepEqual(s.readRoom('R2'), { q: 'two', p: {} });
  assert.equal(s.readRoom('missing'), null);
  // A queue update preserves independent player values.
  await s.writeQueue('R1', 'new', etag);
  assert.deepEqual(s.readRoom('R1').p, { s: 'playing', c: { a: 'toggle', t: 123 } });
});

test('listeners receive exact committed events per room and unsubscribe stops delivery', async () => {
  const s = createFileStore();
  const events = [];
  const stop = s.subscribe('R1', event => events.push(event));
  const other = [];
  s.subscribe('R2', event => other.push(event));
  assert.deepEqual(events, []);
  await s.writeQueue('R1', 'x', 'null_etag');
  await s.writeQueue('R1', 'stale', 'null_etag');
  await s.writePlayer('R1', 's', 'playing');
  await s.writePlayer('R1', 'c', { a: 'restart', t: 42 });
  await s.deleteRoom('R1');
  assert.deepEqual(events, [
    { path: '/q', data: 'x' }, { path: '/p/s', data: 'playing' },
    { path: '/p/c', data: { a: 'restart', t: 42 } }, { path: '/', data: null },
  ]);
  assert.deepEqual(other, []);
  stop();
  stop();
  await s.writeQueue('R1', 'again', 'null_etag');
  assert.equal(events.length, 4);
});

test('delete removes q and p, persists absence and rejects an old etag after recreation', async () => {
  const s = createFileStore();
  await s.writeQueue('R1', 'x', 'null_etag');
  await s.writePlayer('R1', 's', 'playing');
  const { etag } = await s.readQueue('R1');
  await s.deleteRoom('R1');
  assert.equal(s.readRoom('R1'), null);
  assert.deepEqual(await s.readQueue('R1'), { text: null, etag: 'null_etag' });
  assert.deepEqual(await s.listRooms(), []);
  await s.writeQueue('R1', 'x', 'null_etag');
  assert.notEqual((await s.readQueue('R1')).etag, etag);
  assert.equal(await s.writeQueue('R1', 'stale', etag), false);
});

test('readRoom snapshots, player inputs and listeners cannot mutate stored data or each other', async () => {
  const s = createFileStore();
  await s.writeQueue('R1', 'x', 'null_etag');
  s.subscribe('R1', () => { throw new Error('broken listener'); });
  s.subscribe('R1', event => { if (event.data && typeof event.data === 'object') event.data.a = 'changed'; });
  const events = [];
  s.subscribe('R1', event => events.push(event));
  const control = { a: 'toggle', t: 1 };
  await s.writePlayer('R1', 'c', control);
  control.a = 'changed';
  const snapshot = s.readRoom('R1');
  snapshot.q = 'changed';
  snapshot.p.c.a = 'changed';
  assert.deepEqual(s.readRoom('R1'), { q: 'x', p: { c: { a: 'toggle', t: 1 } } });
  assert.deepEqual(events, [{ path: '/p/c', data: { a: 'toggle', t: 1 } }]);
});

test('file store creates parents, reloads q/p/etags and writes private files without leftovers', async t => {
  const { dir } = tempFile(t);
  const file = path.join(dir, 'nested', 'rooms.json');
  let s = createFileStore({ file });
  await s.writeQueue('R1', 'บ้าน', 'null_etag');
  await s.writePlayer('R1', 's', 'paused');
  await s.writePlayer('R1', 'c', { a: 'restart', t: 99 });
  await s.writeQueue('R2', '', 'null_etag');
  const saved = await s.readQueue('R1');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(path.dirname(file)), ['rooms.json']);
  s = createFileStore({ file });
  assert.deepEqual(await s.readQueue('R1'), saved);
  assert.deepEqual(s.readRoom('R1'), { q: 'บ้าน', p: { s: 'paused', c: { a: 'restart', t: 99 } } });
  assert.deepEqual(await s.listRooms(), ['R1', 'R2']);
  assert.equal(await s.writeQueue('R1', 'next', 'null_etag'), false);
  assert.equal(await s.writeQueue('R1', 'next', saved.etag), true);
  await s.deleteRoom('R1');
  s = createFileStore({ file });
  assert.equal(s.readRoom('R1'), null);
  assert.deepEqual(await s.listRooms(), ['R2']);
  assert.equal((await s.readQueue('R2')).text, '');
});

test('corrupt or malformed files are preserved as .bad-<time> and start empty', async t => {
  for (const bad of ['{bad', '[]', 'null', '{}', '{"rooms":{"R1":{"q":42}}}']) {
    const { file } = tempFile(t);
    writeFileSync(file, bad);
    const s = createFileStore({ file, now: () => 123456 });
    assert.deepEqual(await s.listRooms(), []);
    assert.equal(s.readRoom('R1'), null);
    assert.equal(readFileSync(`${file}.bad-123456`, 'utf8'), bad);
    await s.writeQueue('R1', 'recovered', 'null_etag');
    assert.equal((await createFileStore({ file }).readQueue('R1')).text, 'recovered');
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
});

test('failed persistence rejects writes without changing memory, notifying or leaving temp files', async t => {
  const { dir, file } = tempFile(t);
  const s = createFileStore({ file });
  await s.writeQueue('R1', 'x', 'null_etag');
  const before = await s.readQueue('R1');
  const events = [];
  s.subscribe('R1', event => events.push(event));
  // A regular file cannot be used as the parent directory (works even as root).
  rmSync(dir, { recursive: true });
  writeFileSync(dir, 'blocked');
  await assert.rejects(s.writeQueue('R1', 'y', before.etag));
  await assert.rejects(s.writePlayer('R1', 's', 'playing'));
  await assert.rejects(s.deleteRoom('R1'));
  assert.deepEqual(await s.readQueue('R1'), before);
  assert.deepEqual(s.readRoom('R1'), { q: 'x', p: {} });
  assert.deepEqual(events, []);
});

test('legacy files open without meta/usage, and new fields survive room writes, deletion and reloads', async t => {
  const { file } = tempFile(t);
  writeFileSync(file, JSON.stringify({ rooms: { R1: { q: 'old room', etag: 'old-etag', p: {} } } }));
  let s = createFileStore({ file });
  assert.deepEqual(await s.readQueue('R1'), { text: 'old room', etag: 'old-etag' });
  assert.deepEqual(await s.readMeta(), { text: null, etag: 'null_etag' });
  assert.equal(await s.readUsage('R1'), null);
  const metaText = JSON.stringify({ createEnabled: false, hour: 1, creates: 5 });
  const usageText = JSON.stringify({ hour: 1, searches: 9 });
  assert.equal(await s.writeMeta(metaText, 'null_etag'), true);
  await s.writeUsage('R1', usageText);
  await s.writeUsage('R2', usageText);
  const meta = await s.readMeta();
  await s.writeQueue('R2', 'another', 'null_etag');
  await s.writePlayer('R1', 's', 'paused');
  s = createFileStore({ file });
  assert.deepEqual(await s.readMeta(), meta);
  assert.equal(await s.readUsage('R1'), usageText);
  assert.equal(await s.readUsage('R2'), usageText);
  assert.equal((await s.readQueue('R1')).text, 'old room');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.meta.text, metaText);
  assert.equal(saved.usage.R1, usageText);
  await s.deleteRoom('R1');
  s = createFileStore({ file });
  assert.equal(await s.readUsage('R1'), null);
  assert.equal(await s.readUsage('R2'), usageText);
  assert.deepEqual(await s.readMeta(), meta);
});

test('meta ETags have exactly one concurrent winner and reject stale writes after reload', async t => {
  const { file } = tempFile(t);
  const s = createFileStore({ file });
  assert.deepEqual(await Promise.all(['one', 'two'].map(text => s.writeMeta(text, 'null_etag'))), [true, false]);
  const before = await s.readMeta();
  assert.equal(await s.writeMeta('next', before.etag), true);
  const reopened = createFileStore({ file });
  assert.equal(await reopened.writeMeta('stale', before.etag), false);
  assert.equal((await reopened.readMeta()).text, 'next');
});

test('failed meta/usage persistence does not modify in-memory state', async t => {
  const { dir, file } = tempFile(t);
  const s = createFileStore({ file });
  await s.writeMeta('before', 'null_etag');
  await s.writeUsage('R1', 'before');
  const meta = await s.readMeta();
  rmSync(dir, { recursive: true });
  writeFileSync(dir, 'blocked');
  await assert.rejects(s.writeMeta('after', meta.etag));
  await assert.rejects(s.writeUsage('R1', 'after'));
  assert.deepEqual(await s.readMeta(), meta);
  assert.equal(await s.readUsage('R1'), 'before');
});
