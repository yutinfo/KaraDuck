import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRooms, relativeTime, expiresSoon } from '../public/js/admin-view.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('sortRooms puts most recently updated first and legacy rooms last without mutating input', () => {
  const rooms = [{ updatedAt: 0 }, { updatedAt: 2 }, { updatedAt: 10 }, { updatedAt: 0 }];
  const original = [...rooms];
  assert.deepEqual(sortRooms(rooms), [rooms[2], rooms[1], rooms[0], rooms[3]]);
  assert.deepEqual(rooms, original);
  assert.deepEqual(sortRooms([]), []);
});

test('relativeTime covers unknown, just now, minute, hour and day boundaries', () => {
  const at = 1_800_000_000_000;
  for (const value of [0, -1, undefined, NaN, Infinity]) assert.equal(relativeTime(value, at), 'ไม่ทราบ');
  for (const [elapsed, expected] of [[-1000, 'เมื่อครู่'], [0, 'เมื่อครู่'], [59_999, 'เมื่อครู่'],
    [60_000, '1 นาทีที่แล้ว'], [3_599_999, '59 นาทีที่แล้ว'], [3_600_000, '1 ชั่วโมงที่แล้ว'],
    [86_399_999, '23 ชั่วโมงที่แล้ว'], [86_400_000, '1 วันที่แล้ว'], [3 * 86_400_000, '3 วันที่แล้ว']]) {
    assert.equal(relativeTime(at - elapsed, at), expected);
  }
});

test('expiresSoon uses idleHours, strictly less than two hours and ignores unknown timestamps', () => {
  const at = 1_800_000_000_000, hour = 3_600_000, limits = { idleHours: 24 };
  assert.equal(expiresSoon({ updatedAt: at - 22 * hour }, limits, at), false);
  assert.equal(expiresSoon({ updatedAt: at - 22 * hour - 1 }, limits, at), true);
  assert.equal(expiresSoon({ updatedAt: at - 25 * hour }, limits, at), true);
  assert.equal(expiresSoon({ updatedAt: at }, limits, at), false);
  assert.equal(expiresSoon({ updatedAt: at }, { idleHours: 1 }, at), true);
  for (const updatedAt of [0, undefined, -1, NaN]) assert.equal(expiresSoon({ updatedAt }, limits, at), false);
  assert.equal(expiresSoon({ updatedAt: at }, {}, at), false);
});

// Exercise the entry script with a small DOM, deterministic timers and SDK doubles.
// Only module loading is substituted; the event handlers and request code run as shipped.
class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.hidden = false; this.value = ''; this.className = ''; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this._text = ''; this.append(...children); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  insertBefore(child, next) { child.remove(); child.parent = this; this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, child); }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; }
  get classList() { return { add: name => { this.className += ` ${name}`; }, remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); } }; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
  dispatch(type) { if (this.disabled) return; for (const handler of this.listeners[type] ?? []) handler({ preventDefault() {} }); }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}
const source = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
const exampleRoom = { roomId: 'ABCDEFGHJKLMNPQR', name: '<img src=x onerror=alert(1)>', queueLength: 3,
  current: 'เพลงทดสอบ', createdAt: Date.now(), updatedAt: Date.now() };
const list = rooms => ({ createEnabled: true, limits: { maxRooms: 30, idleHours: 24 }, rooms });
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
async function page({ config = { mode: 'local', firebase: null }, saved = '', handle = () => list([exampleRoom]), currentUser = null, sdkError, popupError } = {}) {
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new Node(match[1]); node.hidden = /\bhidden\b/.test(match[2]); nodes.set(match[3], node);
  }
  const document = new Node();
  document.visibilityState = 'visible';
  document.getElementById = id => nodes.get(id);
  document.createElement = tag => new Node(tag);
  const timers = new Map(), intervals = new Map(), storage = new Map(saved ? [['karaoke.admin', saved]] : []);
  const calls = [], imports = [], copied = [];
  let timerId = 0, authChanged, tokenCalls = 0, signOutCalls = 0, popupCalls = 0;
  const sdk = {
    getAuth: () => ({}), GoogleAuthProvider: class { setCustomParameters() {} },
    onAuthStateChanged: (_, callback) => { authChanged = callback; queueMicrotask(() => callback(currentUser)); },
    getIdToken: async () => `firebase-${++tokenCalls}`,
    signOut: async () => { signOutCalls++; authChanged(null); },
    signInWithPopup: () => { popupCalls++; return popupError ? Promise.reject({ code: popupError }) : Promise.resolve(); },
  };
  const context = vm.createContext({ document, navigator: { clipboard: { writeText: async value => { copied.push(value); } } },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => { intervals.set(++timerId, { fn, ms }); return timerId; }, clearInterval: id => intervals.delete(id),
    sortRooms, relativeTime, expiresSoon,
    loadSdk: async url => { imports.push(url); if (sdkError) throw new Error('offline'); return url.endsWith('firebase-app.js') ? { initializeApp: () => ({}) } : sdk; },
    fetch: async (url, init) => {
      if (url === '/api/config') return { ok: true, status: 200, json: async () => config };
      const command = JSON.parse(init.body);
      calls.push({ command, headers: init.headers });
      const result = await handle(command, calls.length);
      const status = result.status || 200;
      return { ok: status === 200, status, json: async () => result };
    },
  });
  vm.runInContext(source.replace(/^import .*;\n/, '').replaceAll('import(', 'loadSdk('), context);
  await flush();
  return { $: id => nodes.get(id), document, calls, timers, intervals, storage, imports, copied,
    get tokenCalls() { return tokenCalls; }, get signOutCalls() { return signOutCalls; }, get popupCalls() { return popupCalls; },
    tick: async ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } await flush(); },
  };
}

test('cloud without Firebase has no key field; SDK load failure shows the required message', async () => {
  const cloud = await page({ config: { mode: 'cloud', firebase: null } });
  assert.equal(cloud.$('key-form').hidden, true);
  assert.equal(cloud.$('google-login').hidden, true);
  assert.equal(cloud.$('auth-message').textContent, 'ยังไม่ได้ตั้งค่าการล็อกอินของผู้ดูแล');
  const failed = await page({ config: { firebase: {} }, sdkError: true });
  assert.equal(failed.$('auth-message').textContent, 'โหลดระบบล็อกอินไม่ได้ ลองรีเฟรช');
});

test('local login stores key, renders untrusted text, sorts rooms and polls only in visible tabs', async () => {
  let offline = false;
  const f = await page({ handle: () => { if (offline) throw new Error('offline'); return list([{ ...exampleRoom, roomId: 'LEGACY', updatedAt: 0 }, exampleRoom]); } });
  assert.equal(f.$('key-form').hidden, false);
  f.$('admin-key').value = 'local-secret'; f.$('key-form').dispatch('submit'); await flush();
  assert.equal(f.storage.get('karaoke.admin'), 'local-secret');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer local-secret');
  assert.equal(f.$('dashboard').hidden, false);
  assert.equal(f.$('room-count').textContent, '2 / 30 ห้อง');
  const room = f.$('rooms').firstElementChild;
  assert.ok(room.textContent.includes(exampleRoom.name));
  assert.ok(room.textContent.includes('ใช้ล่าสุด เมื่อครู่'));
  assert.equal(room.querySelectorAll('img').length, 0);
  offline = true;
  f.$('refresh').dispatch('click'); await flush();
  assert.equal(f.$('rooms').firstElementChild, room);
  assert.equal(f.$('load-error').textContent, 'โหลดรายการไม่ได้ จะลองใหม่');
  assert.equal([...f.intervals.values()][0].ms, 15_000);
  f.document.visibilityState = 'hidden'; f.document.dispatch('visibilitychange');
  assert.equal(f.intervals.size, 0);
  offline = false;
  f.document.visibilityState = 'visible'; f.document.dispatch('visibilitychange'); await flush();
  assert.equal(f.$('load-error').hidden, true);
  assert.equal(f.intervals.size, 1);
  f.$('logout').dispatch('click'); await flush();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.storage.has('karaoke.admin'), false);
  assert.equal(f.$('rooms').children.length, 0);
});

test('create and rotate show private copyable links; two-step delete resets after four seconds', async () => {
  let deleted = false;
  const f = await page({ saved: 'key', handle: command => {
    if (command.action === 'list') return list(deleted ? [] : [exampleRoom]);
    if (command.action === 'delete') { deleted = true; return { ok: true }; }
    return { ownerUrl: 'https://karaoke.test/#o=private' };
  } });
  f.$('room-name').value = 'สร้างใหม่'; f.$('create-form').dispatch('submit'); await flush();
  assert.equal(f.$('created-link').hidden, false);
  assert.ok(f.$('created-link').textContent.includes('ส่งลิงก์นี้ทางช่องทางส่วนตัวเท่านั้น'));
  f.$('created-link').querySelectorAll('button')[0].dispatch('click'); await flush();
  assert.deepEqual(f.copied, ['https://karaoke.test/#o=private']);
  const room = f.$('rooms').firstElementChild;
  const [rotate, close] = room.querySelectorAll('button');
  rotate.dispatch('click'); assert.equal(f.calls.filter(c => c.command.action === 'rotateOwner').length, 0);
  rotate.dispatch('click'); await flush();
  assert.ok(room.textContent.includes('ลิงก์เดิมใช้ไม่ได้แล้ว'));
  close.dispatch('click'); assert.ok(close.textContent.includes('ยืนยันปิดห้อง'));
  await f.tick(4000); assert.equal(close.textContent, 'ปิดห้อง');
  close.dispatch('click'); assert.equal(f.calls.filter(c => c.command.action === 'delete').length, 0);
  close.dispatch('click'); await flush();
  assert.equal(f.calls.filter(c => c.command.action === 'delete').length, 1);
  assert.equal(f.$('empty').hidden, false);
});

test('switch prevents repeated mutation and preserves prior value when the request fails', async () => {
  let finish;
  const f = await page({ saved: 'key', handle: command => command.action === 'list' ? list([])
    : new Promise(resolve => { finish = resolve; }) });
  f.$('create-switch').dispatch('click'); await flush();
  assert.equal(f.$('create-switch').disabled, true);
  f.$('create-switch').dispatch('click');
  assert.equal(f.calls.filter(c => c.command.action === 'setCreate').length, 1);
  finish({ status: 502, error: 'store_failed' }); await flush();
  assert.equal(f.$('create-switch').getAttribute('aria-checked'), 'true');
  assert.equal(f.$('create-switch').disabled, false);
  assert.equal(f.$('toast').textContent, 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
});

test('an in-flight list cannot restore rooms after logout', async () => {
  let finish;
  const f = await page({ saved: 'key', handle: () => new Promise(resolve => { finish = resolve; }) });
  f.$('logout').dispatch('click'); await flush();
  finish(list([exampleRoom])); await flush();
  assert.equal(f.$('dashboard').hidden, true);
  assert.equal(f.$('rooms').children.length, 0);
  assert.equal(f.intervals.size, 0);
});

test('Google requests obtain fresh SDK tokens; 403 offers account change and 401 signs out', async () => {
  let status = 200;
  const f = await page({ config: { firebase: {} }, currentUser: { email: 'owner@example.test' },
    handle: () => status === 200 ? list([]) : { status, error: status === 403 ? 'not_admin' : 'bad_admin_key' } });
  assert.deepEqual(f.imports, ['https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js', 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js']);
  assert.equal(f.$('email').textContent, 'owner@example.test');
  f.$('refresh').dispatch('click'); await flush();
  assert.equal(f.tokenCalls, 2);
  assert.equal(f.calls[1].headers.Authorization, 'Bearer firebase-2');
  assert.equal(f.storage.size, 0);
  status = 403; f.$('refresh').dispatch('click'); await flush();
  assert.equal(f.$('auth-message').textContent, 'บัญชี owner@example.test ไม่มีสิทธิ์ผู้ดูแล');
  assert.equal(f.$('change-account').hidden, false);
  f.$('change-account').dispatch('click'); await flush();
  assert.equal(f.signOutCalls, 1);
  assert.equal(f.$('google-login').hidden, false);
  const expired = await page({ config: { firebase: {} }, currentUser: { email: 'owner@example.test' },
    handle: () => ({ status: 401, error: 'bad_admin_key' }) });
  assert.equal(expired.signOutCalls, 1);
  assert.equal(expired.$('google-login').hidden, false);
});

test('popup errors use the required recovery messages and cancellations stay silent', async () => {
  for (const [code, expected] of [
    ['auth/popup-blocked', 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน อนุญาตป๊อปอัปแล้วลองใหม่'],
    ['auth/unauthorized-domain', 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase'], ['auth/unknown', 'เข้าสู่ระบบไม่สำเร็จ'],
    ['auth/popup-closed-by-user', 'ใช้บัญชี Google ที่ได้รับสิทธิ์ผู้ดูแล'],
    ['auth/cancelled-popup-request', 'ใช้บัญชี Google ที่ได้รับสิทธิ์ผู้ดูแล'],
  ]) {
    const f = await page({ config: { firebase: {} }, popupError: code });
    f.$('google-login').dispatch('click');
    assert.equal(f.popupCalls, 1, 'popup is called directly in the click handler');
    await flush();
    assert.equal(f.$('auth-message').textContent, expected);
    assert.equal(f.$('google-login').disabled, false);
  }
});
