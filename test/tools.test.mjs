import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { run } from '../tools/room.mjs';
import { run as setup } from '../tools/setup.mjs';

const roomId = 'ABCDEFGHJKLMNPQR', key = 'admin-key-test';
const ownerUrl = `https://karaoke.test/#o=${roomId}.o1.test`;
function harness({ env = {}, response = {}, status = 200, fetchError = false, fileError = false } = {}) {
  const calls = [], logs = [], reads = [];
  return { calls, logs, reads, options: {
    env: { KARAOKE_ADMIN_KEY: key, ...env }, log: value => logs.push(value),
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init, headers: new Headers(init.headers) });
      if (fetchError) throw new Error(key);
      return new Response(JSON.stringify(response), { status });
    },
    readFile: async (path, encoding) => {
      reads.push({ path, encoding });
      if (fileError) throw new Error(key);
      return JSON.stringify({ adminKey: 'local-key' });
    },
  } };
}

test('ทั้งสี่คำสั่งส่ง authorization และ JSON ถูกต้อง; create/rotate พิมพ์ลิงก์เต็มและเตือนส่วนตัว', async () => {
  for (const [argv, expected, response] of [
    [['create', 'บ้าน หนึ่ง'], { action: 'create', name: 'บ้าน หนึ่ง' }, { roomId, ownerUrl }],
    [['list'], { action: 'list' }, { rooms: [{ roomId, name: 'บ้าน', rev: 3, queueLength: 2 }] }],
    [['delete', roomId], { action: 'delete', roomId }, { ok: true }],
    [['rotate-owner', roomId], { action: 'rotateOwner', roomId }, { roomId, ownerUrl }],
  ]) {
    const h = harness({ response });
    assert.equal(await run([...argv, '--url', 'https://karaoke.test/'], h.options), 0);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, 'https://karaoke.test/api/admin');
    assert.equal(h.calls[0].method, 'POST');
    assert.equal(h.calls[0].headers.get('authorization'), `Bearer ${key}`);
    assert.equal(h.calls[0].headers.get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(h.calls[0].body), expected);
    const output = h.logs.join('\n');
    assert.equal(output.includes(key), false);
    if (response.ownerUrl) { assert.ok(output.includes(ownerUrl)); assert.match(output, /ช่องทางส่วนตัว/); }
    if (response.rooms) { assert.ok(output.includes(roomId)); assert.match(output, /บ้าน/); assert.match(output, /2/); }
    assert.equal(h.reads.length, 0);
  }
});

test('--local อ่าน data/secrets.json ใช้ localhost และ PORT; --url มีลำดับเหนือฐาน local', async () => {
  for (const [env, extra, expected] of [[{}, [], 'http://localhost:8791'], [{ PORT: '8792' }, [], 'http://localhost:8792'], [{ PORT: '8792' }, ['--url', 'http://localhost:9999'], 'http://localhost:9999']]) {
    const h = harness({ env, response: { rooms: [] } });
    assert.equal(await run(['--local', 'list', ...extra], h.options), 0);
    assert.deepEqual(h.reads, [{ path: 'data/secrets.json', encoding: 'utf8' }]);
    assert.equal(h.calls[0].url, `${expected}/api/admin`);
    assert.equal(h.calls[0].headers.get('authorization'), 'Bearer local-key');
  }
});

test('ไม่มี --url ใช้ KARAOKE_URL หรือ PUBLIC_ORIGIN และแสดงรายการว่างได้', async () => {
  for (const env of [{ KARAOKE_URL: 'https://karaoke.test' }, { PUBLIC_ORIGIN: 'https://karaoke.test/' }]) {
    const h = harness({ env, response: { rooms: [] } });
    assert.equal(await run(['list'], h.options), 0);
    assert.equal(h.calls[0].url, 'https://karaoke.test/api/admin');
    assert.match(h.logs.join('\n'), /ไม่มีห้อง/);
  }
});

test('arguments/config ผิดคืน 1 โดยไม่ fetch และไม่เผยกุญแจ', async () => {
  for (const argv of [[], ['unknown'], ['create'], ['delete'], ['rotate-owner', 'bad'], ['list', 'extra'], ['list', '--oops'],
    ['list', '--url'], ['list', '--url', 'ftp://karaoke.test'], ['list', '--url', `https://user:${key}@karaoke.test`],
    ['list', '--url', `https://karaoke.test/?key=${key}`]]) {
    const h = harness();
    assert.equal(await run(argv, h.options), 1, JSON.stringify(argv));
    assert.equal(h.calls.length, 0);
    assert.equal(h.logs.join('\n').includes(key), false);
  }
  for (const env of [{}, { KARAOKE_URL: 'https://karaoke.test', KARAOKE_ADMIN_KEY: '' }]) {
    const h = harness({ env });
    assert.equal(await run(['list'], h.options), 1);
    assert.equal(h.calls.length, 0);
  }
});

test('HTTP/network/local secret/JSON เสีย คืน 1 และไม่พิมพ์ ADMIN_KEY แม้ upstream ส่งกลับ', async () => {
  for (const args of [{ status: 401, response: { error: key } }, { status: 500, response: { error: 'store_failed' } }, { fetchError: true }, { fileError: true }]) {
    const h = harness(args);
    assert.equal(await run(['list', ...(args.fileError ? ['--local'] : ['--url', 'https://karaoke.test'])], h.options), 1);
    assert.equal(h.logs.join('\n').includes(key), false);
  }
  const h = harness();
  h.options.fetchImpl = async () => new Response('{');
  assert.equal(await run(['list', '--url', 'https://karaoke.test'], h.options), 1);
});

test('setup สุ่ม 32/24 bytes base64url พร้อมคำสั่งครบและแหล่งค่า Firebase โดยไม่ใช้ file/network', async () => {
  const logs = [];
  assert.equal(setup({ log: line => logs.push(line) }), 0);
  const text = logs.join('\n');
  const room = text.match(/^ROOM_SECRET=([\w-]+)$/m)?.[1];
  const admin = text.match(/^ADMIN_KEY=([\w-]+)$/m)?.[1];
  assert.equal(Buffer.from(room, 'base64url').length, 32);
  assert.equal(Buffer.from(admin, 'base64url').length, 24);
  assert.equal(room.length, 43);
  assert.equal(admin.length, 32);
  const adapter = await readFile(new URL('../lib/vercel.mjs', import.meta.url), 'utf8');
  const required = ['FIREBASE_DB_URL', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'ROOM_SECRET'];
  const names = [...new Set([...adapter.matchAll(/env\.([A-Z_]+)/g)].map(match => match[1]).concat(required))].sort();
  assert.deepEqual([...text.matchAll(/^vercel env add ([A-Z_]+) production$/gm)].map(match => match[1]).sort(), names);
  for (const name of required) assert.ok(text.includes(`${name} (บังคับ)`), name);
  for (const name of names.filter(name => !required.includes(name))) {
    assert.match(text.split('\n').find(line => line.startsWith(`${name} `) || line.startsWith(`${name}=1 `)), /ไม่บังคับ|จำเป็นสำหรับ/);
  }
  assert.match(text, /client_email/);
  assert.match(text, /private_key/);
  const second = [];
  setup({ log: line => second.push(line) });
  assert.notEqual(second.join('\n'), text);
});

test('CLI preserves untrimmed room names and rejects room IDs with trailing newlines', async () => {
  for (const name of [' บ้าน ', 'ก'.repeat(40), ` ${'ก'.repeat(40)} `]) {
    const h = harness({ response: { roomId, ownerUrl } });
    assert.equal(await run(['create', name, '--url', 'https://karaoke.test'], h.options), 0);
    assert.deepEqual(JSON.parse(h.calls[0].body), { action: 'create', name });
  }
  for (const name of ['', '  ', 'ก'.repeat(41)]) {
    const h = harness();
    assert.equal(await run(['create', name, '--url', 'https://karaoke.test'], h.options), 1);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ response: { ok: true } });
  assert.equal(await run(['delete', `${roomId}\n`, '--url', 'https://karaoke.test'], h.options), 1);
  assert.equal(h.calls.length, 0);
});

test('gitignore ไม่ให้ env ที่มี secrets ถูกติดตาม', async () => {
  const text = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.ok(text.split('\n').includes('.env*'));
});
